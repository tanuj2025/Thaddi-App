import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// --------------------------------------------------------------------------
// Shared i18n (Arabic translation) guardrail logic
//
// This module holds the single source of truth for the i18n scan. Each artifact
// that needs it ships a thin `scripts/check-i18n.mjs` wrapper that only supplies
// its scan root and dictionary location and calls runI18nGuard(); all the
// detection logic (ar/en key parity, forgotten-translation classification,
// hardcoded-English scan, brand/mask allowlists) lives here so any future copy
// can never drift apart — mirroring scripts/rtl-guard.mjs.
//
// What this guard does
//
//   1. ar/en key parity in the translations dictionary (no key in one block
//      missing from the other, no duplicates).
//   2. `ar` values left as plain English (forgotten translations), including
//      partly-translated values with an untranslated English clause inside.
//   3. Hardcoded user-facing English literals in app source that were never
//      routed through t() (JSX text, aria/title/placeholder/alt attrs, toast/
//      notify/confirm/dialog helpers, console.* sinks, thrown Errors).
// --------------------------------------------------------------------------

// Proper nouns / brand names that are intentionally identical across languages.
// A translation check should NOT demand these be wrapped in t().
const BRAND_ALLOW = new Set(
  ["THADDI", "thaddi", "App", "Instagram", "TikTok", "WhatsApp", "PlayStation", "FAQ"].map((w) => w.toLowerCase()),
);

// A single English token counts as genuine "prose" only if it is not a brand
// proper noun and not a format mask (e.g. "XXXX" in 05XXXXXXXX).
function isProseWord(tok) {
  if (BRAND_ALLOW.has(tok.toLowerCase())) return false;
  if (/^[Xx]+$/.test(tok)) return false; // input masks e.g. 05XXXXXXXX
  return true;
}

// Returns the user-facing English "words" that remain after removing brand
// proper nouns and non-prose tokens (format masks like "XXXX", single letters).
// A non-empty result means the string contains genuine untranslated English.
function untranslatedWords(text) {
  const stripped = text.replace(/&[a-zA-Z]+;/g, " ");
  const tokens = stripped.match(/[A-Za-z]{2,}/g);
  if (!tokens) return [];
  return tokens.filter(isProseWord);
}

function fail(messages) {
  console.error("\n\u2716 i18n guardrail FAILED\n");
  for (const m of messages) console.error(m);
  console.error(
    "\nFix: wrap user-facing English in t('some.key') and add the key to BOTH the `ar` and `en` blocks of src/lib/i18n.tsx.\n",
  );
  process.exit(1);
}

// --------------------------------------------------------------------------
// Part 1: ar/en key parity in src/lib/i18n.tsx
// --------------------------------------------------------------------------
// Returns { ar: [{key, value}], en: [{key, value}] } where `value` is the
// static string for plain string / no-substitution template literals and null
// otherwise (e.g. computed values), so callers can check both keys and values.
function extractDict(i18nFile) {
  const source = readFileSync(i18nFile, "utf8");
  const sf = ts.createSourceFile(i18nFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const blocks = {};

  function readBlock(objLiteral) {
    const entries = [];
    for (const prop of objLiteral.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = prop.name;
        let key = null;
        if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) key = name.text;
        else if (ts.isIdentifier(name)) key = name.text;
        if (key === null) continue;
        let value = null;
        if (
          ts.isStringLiteral(prop.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(prop.initializer)
        ) {
          value = prop.initializer.text;
        }
        entries.push({ key, value });
      }
    }
    return entries;
  }

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === "translations" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          (prop.name.text === "ar" || prop.name.text === "en") &&
          ts.isObjectLiteralExpression(prop.initializer)
        ) {
          blocks[prop.name.text] = readBlock(prop.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (!blocks.ar || !blocks.en) {
    fail(["Could not locate both `ar` and `en` blocks in the `translations` object in src/lib/i18n.tsx."]);
  }
  return blocks;
}

function checkKeyParity(dict, errors) {
  const ar = dict.ar.map((e) => e.key);
  const en = dict.en.map((e) => e.key);
  const arSet = new Set(ar);
  const enSet = new Set(en);

  const missingInEn = ar.filter((k) => !enSet.has(k));
  const missingInAr = en.filter((k) => !arSet.has(k));

  const dupes = (arr) => {
    const seen = new Set();
    const out = new Set();
    for (const k of arr) {
      if (seen.has(k)) out.add(k);
      seen.add(k);
    }
    return [...out];
  };
  const arDupes = dupes(ar);
  const enDupes = dupes(en);

  if (missingInEn.length) {
    errors.push(`Keys present in \`ar\` but missing in \`en\` (${missingInEn.length}):`);
    for (const k of missingInEn) errors.push(`  - ${k}`);
  }
  if (missingInAr.length) {
    errors.push(`Keys present in \`en\` but missing in \`ar\` (${missingInAr.length}):`);
    for (const k of missingInAr) errors.push(`  - ${k}`);
  }
  if (arDupes.length) {
    errors.push(`Duplicate keys in \`ar\` block: ${arDupes.join(", ")}`);
  }
  if (enDupes.length) {
    errors.push(`Duplicate keys in \`en\` block: ${enDupes.join(", ")}`);
  }
}

// --------------------------------------------------------------------------
// Part 1b: ar/en VALUE check — flag `ar` values left as plain English.
// Key parity passes when an entry exists in BOTH blocks, but a forgotten
// translation can be added to both with the same English text, slipping past
// the key check while showing English to Arabic users. A genuine Arabic
// translation contains Arabic script; a value that is pure English prose (after
// stripping brand names and input masks) is a forgotten translation.
// --------------------------------------------------------------------------

// Arabic script + Arabic-Indic digits. A value containing any of these has been
// (at least partly) translated, so it is not a forgotten English value.
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function containsArabic(text) {
  return ARABIC_RE.test(text);
}

// A value that contains *some* Arabic is partly translated, but a meaningful run
// of consecutive untranslated English prose left inside it (a forgotten clause)
// still shows English to Arabic users. We flag a mixed value when its longest
// run of consecutive English prose words reaches this threshold. Legitimate
// mixed values only ever carry isolated single technical terms (e.g. "slug",
// "IP"), so a run of 3+ consecutive words reliably signals a forgotten clause
// without tripping on those one-off terms, brand names, or placeholder tokens.
const MIXED_RUN_THRESHOLD = 3;

// Returns the length of the longest run of consecutive English prose words in
// `text`, ignoring non-prose content so partial translations can be measured:
//   - placeholder tokens like {team}/{rank} are removed (transparent),
//   - emails, URLs, and dotted/snake identifiers (e.g. user.update,
//     hello@thaddi.app) are replaced with an Arabic marker so they break runs
//     and their internal words are never counted,
//   - Arabic characters (incl. Arabic-Indic digits) break runs,
//   - brand names (THADDI, …) and input masks (XXXX) are transparent — they
//     neither count toward nor break a run.
// A genuine forgotten English clause yields a long run; an isolated technical
// term like "slug" or "IP" yields a run of 1.
const NON_PROSE_MARKER = "\u0600"; // an Arabic-range char, so it acts as a break
function longestEnglishRun(text) {
  let s = text.replace(/&[a-zA-Z]+;/g, " "); // html entities
  s = s.replace(/\{[^}]*\}/g, " "); // placeholder tokens {team}
  s = s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, NON_PROSE_MARKER); // emails
  s = s.replace(/(?:https?:\/\/|www\.)\S+/gi, NON_PROSE_MARKER); // urls
  s = s.replace(/\b[A-Za-z0-9]+(?:[._][A-Za-z0-9]+)+\b/g, NON_PROSE_MARKER); // dotted/snake identifiers

  // Arabic chars (and the inserted markers) split the text into Latin segments.
  const segments = s.split(ARABIC_RE);
  let max = 0;
  for (const segment of segments) {
    const tokens = segment.match(/[A-Za-z]{2,}/g);
    if (!tokens) continue;
    let run = 0;
    for (const tok of tokens) {
      // Brand names and masks are transparent: skip without counting/breaking.
      if (BRAND_ALLOW.has(tok.toLowerCase()) || /^[Xx]+$/.test(tok)) continue;
      run += 1;
      if (run > max) max = run;
    }
  }
  return max;
}

// Values that are identical-by-design across languages and are NOT prose:
// example emails (hello@thaddi.app), URLs, and identifier samples
// (ali_q, user.update). These have no spaces and an identifier/email/URL shape,
// so they should not be treated as untranslated English. Multi-word strings
// (containing whitespace) are potential prose and never skipped here.
function isNonProseSample(text) {
  const t = text.trim();
  if (!t) return true;
  if (/\s/.test(t)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true; // email
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) return true; // url
  if (/_/.test(t)) return true; // snake_case identifier sample
  if (/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/.test(t)) return true; // dotted identifier
  return false;
}

// Classifies a single `ar` value for the forgotten-translation checks. Returns
// one of:
//   - "ok"      — translated, or legitimately non-prose (brand/mask/email/url/
//                 identifier sample), so it is not flagged;
//   - "english" — pure English prose with no Arabic at all (forgotten entirely);
//   - "mixed"   — partly Arabic but with an untranslated English clause left
//                 inside (longest English prose run >= MIXED_RUN_THRESHOLD).
// `null` values (computed/non-static) are reported as "ok" since they are not
// checkable here. This is the single source of truth for the per-value decision
// so the script and its tests stay in lockstep.
function classifyArabicValue(value) {
  if (value == null) return "ok"; // computed/non-static value — not checkable here
  if (containsArabic(value)) {
    // Partly translated: Arabic is present, but a meaningful run of consecutive
    // untranslated English prose left inside is still English shown to Arabic
    // users. Isolated technical terms ("slug", "IP"), brand names, and
    // placeholder tokens stay below the threshold and are not flagged.
    return longestEnglishRun(value) >= MIXED_RUN_THRESHOLD ? "mixed" : "ok";
  }
  if (isNonProseSample(value)) return "ok"; // email/url/identifier sample
  // Numeric/punctuation/format-only and brand-only/mask-only values yield no
  // untranslated words; a non-empty result is genuine English prose.
  if (untranslatedWords(value).length === 0) return "ok";
  return "english";
}

function checkArabicValuesTranslated(dict, errors) {
  const offenders = [];
  const mixedOffenders = [];
  for (const { key, value } of dict.ar) {
    const verdict = classifyArabicValue(value);
    if (verdict === "english") offenders.push({ key, value });
    else if (verdict === "mixed") mixedOffenders.push({ key, value });
  }

  const snippetOf = (value) => value.trim().replace(/\s+/g, " ").slice(0, 60);

  if (offenders.length) {
    errors.push(
      `\`ar\` values still in English (forgotten translations) (${offenders.length}):`,
    );
    for (const o of offenders) {
      errors.push(`  - ${o.key}: "${snippetOf(o.value)}"`);
    }
  }

  if (mixedOffenders.length) {
    errors.push(
      `\`ar\` values with an untranslated English clause left inside Arabic (${mixedOffenders.length}):`,
    );
    for (const o of mixedOffenders) {
      errors.push(`  - ${o.key}: "${snippetOf(o.value)}"`);
    }
  }
}

// --------------------------------------------------------------------------
// Part 2: scan src for hardcoded user-facing English literals
// --------------------------------------------------------------------------
const UI_TEXT_ATTRS = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
  "label",
]);

// Calls that surface their string arguments to end users. We treat the toast
// helper (from @/hooks/use-toast) and sonner's toast.success/error/... the same.
const TOAST_CALLEES = new Set(["toast", "sonner"]);
// Object-property keys on a toast(...) options object that render as UI text.
const TOAST_MESSAGE_PROPS = new Set(["title", "description", "message"]);

// Project-specific notification/toast wrapper helpers built on top of the toast
// system (e.g. a notify()/useNotify()/showNotification()/pushToast() helper).
// Like the raw toast() call, these surface their title/message/description to the
// user, so static English passed to them — either a direct string or an options
// object — must go through t() too. Detection keys off the callee/method name
// (like CONFIRM_HELPER_CALLEES) so namespaced wrappers (helpers.notify(...)) and
// chained variants (notify.success(...)) are both matched. The raw `toast`/
// `sonner` calls are handled separately above and are intentionally NOT listed
// here to avoid double-reporting.
const NOTIFY_HELPER_CALLEES = new Set([
  "notify",
  "useNotify",
  "showNotification",
  "showNotify",
  "pushNotification",
  "pushToast",
  "showToast",
  "addNotification",
  "addToast",
  "notifySuccess",
  "notifyError",
  "notifyInfo",
  "notifyWarning",
]);
// Object-property keys on a notify(...) options object that render as UI text.
// Mirrors TOAST_MESSAGE_PROPS (title/message/description) since these wrappers
// are toast-based.
const NOTIFY_MESSAGE_PROPS = new Set(["title", "description", "message"]);

// Native browser dialogs that render their string argument directly to the
// user: window.confirm/alert/prompt(...) and the bare confirm/alert/prompt(...).
const DIALOG_CALLEES = new Set(["confirm", "alert", "prompt"]);

// Project-specific confirmation/dialog helper hooks & functions (e.g. a
// useConfirm() hook or showConfirm()/confirmDialog() helper). Like the native
// dialogs, these surface their title/message/description to the user, so static
// English passed to them — either a direct string or an options object — must go
// through t() too. Native confirm/alert/prompt are handled separately above and
// are intentionally NOT listed here to avoid double-reporting.
const CONFIRM_HELPER_CALLEES = new Set([
  "useConfirm",
  "showConfirm",
  "openConfirm",
  "askConfirm",
  "confirmDialog",
  "showConfirmDialog",
  "openConfirmDialog",
  "useAlertDialog",
  "showAlertDialog",
]);

// Option-object property keys (on a confirm-helper call) and component props
// (on a confirmation/dialog component) that render as user-facing text. "title"
// is intentionally omitted — it is already covered by UI_TEXT_ATTRS so listing
// it here would double-report.
const DIALOG_MESSAGE_PROPS = new Set([
  "message",
  "description",
  "confirmText",
  "cancelText",
  "confirmLabel",
  "cancelLabel",
]);

// JSX components that render confirmation/dialog text via props (rather than
// children). Matched by name so wrappers like <ConfirmDialog .../> or
// <DeleteConfirmation .../> are covered as the UI grows. Components whose name
// contains "Confirm"/"Confirmation" or ends in "Dialog" qualify.
function isConfirmDialogComponent(tagName) {
  return /Confirm(?:ation)?/.test(tagName) || /Dialog$/.test(tagName);
}

// console.*(...) sinks. These print untranslated English that, while primarily
// developer-facing, can still leak into user-visible surfaces (custom error
// overlays, log viewers) — flag static English so it goes through t() like the
// rest of the user-facing copy.
const CONSOLE_METHODS = new Set(["log", "info", "warn", "error", "debug", "trace"]);

// Errors thrown purely as developer guards (using a hook outside its provider,
// or a missing build-time env var) crash with a dev message and never reach end
// users as translated UI text, so they are not i18n violations.
const DEV_ERROR_PATTERNS = [
  /\bmust be used within\b/i,
  /\bshould be used within\b/i,
  /^Missing\b.*\.env\b/i,
];
function isDevGuardError(text) {
  return DEV_ERROR_PATTERNS.some((re) => re.test(text));
}

// Returns the literal string value of an expression when it is a plain string
// literal or a template literal with no interpolations, otherwise null.
function staticStringValue(expr) {
  if (!expr) return null;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return null;
}

// Files we intentionally skip: the dictionary itself.
function shouldSkip(file, i18nFile) {
  return resolve(file) === resolve(i18nFile);
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function looksLikeEnglish(text) {
  return untranslatedWords(text).length > 0;
}

function scanHardcodedEnglish({ rootDir, srcDir, i18nFile }, errors) {
  const files = walk(srcDir, []).filter((f) => !shouldSkip(f, i18nFile));
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = relative(rootDir, file);

    const report = (node, kind, text) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const snippet = text.trim().replace(/\s+/g, " ").slice(0, 60);
      violations.push(`  ${rel}:${line + 1}  [${kind}] "${snippet}"`);
    };

    function visit(node) {
      // JSX literal text content between tags: <Tag>English text</Tag>
      if (ts.isJsxText(node)) {
        if (looksLikeEnglish(node.text)) report(node, "jsx-text", node.text);
      }

      // JSX attribute string literals for user-facing attributes
      if (ts.isJsxAttribute(node) && node.initializer) {
        const attrName = node.name.getText(sf);
        const init = node.initializer;
        let value = null;
        if (ts.isStringLiteral(init)) value = init.text;
        else if (
          ts.isJsxExpression(init) &&
          init.expression &&
          (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
        ) {
          value = init.expression.text;
        }
        if (value !== null && looksLikeEnglish(value)) {
          // Globally-flagged user-facing attributes (aria-label, title, …).
          if (UI_TEXT_ATTRS.has(attrName)) {
            report(node, `attr:${attrName}`, value);
          } else if (DIALOG_MESSAGE_PROPS.has(attrName)) {
            // Message-bearing props (message, description, confirmText, …) are
            // only user-facing when the owning element is a confirmation/dialog
            // component — otherwise they could be arbitrary data props.
            const owner = node.parent && node.parent.parent;
            const tagName =
              owner && (ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner))
                ? owner.tagName.getText(sf)
                : null;
            if (tagName && isConfirmDialogComponent(tagName)) {
              report(node, `dialog-prop:${attrName}`, value);
            }
          }
        }
      }

      // Hardcoded English passed to a user-facing toast/sonner call.
      // Handles both: toast('msg') / toast.success('msg') (sonner-style)
      // and toast({ title: 'msg', description: 'msg' }) (options object).
      if (ts.isCallExpression(node)) {
        // `calleeRoot` is the object/receiver for `obj.method()` (so `toast.success`
        // → `toast`), and `calleeName` is the actual callee/method name (so
        // `helpers.confirmDialog()` → `confirmDialog`). Bare identifiers populate
        // both. Toast detection keys off the receiver; confirm-helper detection
        // keys off the callee name so namespaced helpers are matched too.
        let calleeRoot = null;
        let calleeName = null;
        if (ts.isIdentifier(node.expression)) {
          calleeRoot = node.expression.text;
          calleeName = node.expression.text;
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          if (ts.isIdentifier(node.expression.expression)) {
            calleeRoot = node.expression.expression.text;
          }
          if (ts.isIdentifier(node.expression.name)) {
            calleeName = node.expression.name.text;
          }
        }
        // Native browser dialogs: confirm('msg') / window.confirm('msg')
        // (and alert/prompt). The first argument is the user-facing message.
        let dialogName = null;
        if (ts.isIdentifier(node.expression)) {
          if (DIALOG_CALLEES.has(node.expression.text)) dialogName = node.expression.text;
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "window" &&
          DIALOG_CALLEES.has(node.expression.name.text)
        ) {
          dialogName = node.expression.name.text;
        }
        if (dialogName) {
          const msg = staticStringValue(node.arguments[0]);
          if (msg !== null && looksLikeEnglish(msg)) {
            report(node, `dialog:${dialogName}`, msg);
          }
        }

        // Project-specific confirmation/dialog helpers: useConfirm(...),
        // showConfirm(...), confirmDialog(...), and namespaced forms like
        // helpers.confirmDialog(...) (matched via calleeName). The user-facing
        // copy can be a direct string first argument or an options object with
        // message props.
        if (calleeName && CONFIRM_HELPER_CALLEES.has(calleeName)) {
          const first = node.arguments[0];
          const direct = staticStringValue(first);
          if (direct !== null && looksLikeEnglish(direct)) {
            report(node, `confirm:${calleeName}`, direct);
          } else if (first && ts.isObjectLiteralExpression(first)) {
            for (const prop of first.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
                (DIALOG_MESSAGE_PROPS.has(prop.name.text) || prop.name.text === "title")
              ) {
                const val = staticStringValue(prop.initializer);
                if (val !== null && looksLikeEnglish(val)) {
                  report(prop, `confirm:${calleeName}.${prop.name.text}`, val);
                }
              }
            }
          }
        }

        // Project-specific notification/toast wrappers: notify(...),
        // useNotify(...), showNotification(...), pushToast(...), and namespaced
        // forms like helpers.notify(...) (matched via the callee name) as well as
        // chained, toast-style variants like notify.success(...) (matched via the
        // receiver). The user-facing copy can be a direct string first argument
        // or an options object with title/message/description.
        const notifyMatch =
          (calleeName && NOTIFY_HELPER_CALLEES.has(calleeName) && calleeName) ||
          (calleeRoot && NOTIFY_HELPER_CALLEES.has(calleeRoot) && calleeRoot) ||
          null;
        if (notifyMatch) {
          const first = node.arguments[0];
          const direct = staticStringValue(first);
          if (direct !== null && looksLikeEnglish(direct)) {
            report(node, `notify:${notifyMatch}`, direct);
          } else if (first && ts.isObjectLiteralExpression(first)) {
            for (const prop of first.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
                NOTIFY_MESSAGE_PROPS.has(prop.name.text)
              ) {
                const val = staticStringValue(prop.initializer);
                if (val !== null && looksLikeEnglish(val)) {
                  report(prop, `notify:${notifyMatch}.${prop.name.text}`, val);
                }
              }
            }
          }
        }

        // console.log/info/warn/error/debug/trace('msg'): flag static English
        // in any of the string arguments so log copy goes through t() as well.
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "console" &&
          CONSOLE_METHODS.has(node.expression.name.text)
        ) {
          for (const arg of node.arguments) {
            const msg = staticStringValue(arg);
            if (msg !== null && looksLikeEnglish(msg)) {
              report(node, `console:${node.expression.name.text}`, msg);
            }
          }
        }

        if (calleeRoot && TOAST_CALLEES.has(calleeRoot)) {
          const first = node.arguments[0];
          const direct = staticStringValue(first);
          if (direct !== null && looksLikeEnglish(direct)) {
            report(node, "toast", direct);
          } else if (first && ts.isObjectLiteralExpression(first)) {
            for (const prop of first.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
                TOAST_MESSAGE_PROPS.has(prop.name.text)
              ) {
                const val = staticStringValue(prop.initializer);
                if (val !== null && looksLikeEnglish(val)) {
                  report(prop, `toast:${prop.name.text}`, val);
                }
              }
            }
          }
        }
      }

      // Hardcoded English in user-facing thrown errors: new Error('msg').
      // Developer-guard errors (wrong provider usage, missing env) are excluded.
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Error") {
        const first = node.arguments && node.arguments[0];
        const val = staticStringValue(first);
        if (val !== null && !isDevGuardError(val) && looksLikeEnglish(val)) {
          report(node, "error", val);
        }
      }

      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  if (violations.length) {
    errors.push(`Hardcoded user-facing English literals not wrapped in t() (${violations.length}):`);
    errors.push(...violations);
  }
}

// --------------------------------------------------------------------------
// Run the full i18n guard over `srcDir`, reading the translation dictionary at
// `i18nFile` and reporting paths relative to `rootDir`. Exits the process with
// code 1 (via fail()) when violations are found.
export function runI18nGuard({ rootDir, srcDir, i18nFile }) {
  const errors = [];
  const dict = extractDict(i18nFile);
  checkKeyParity(dict, errors);
  checkArabicValuesTranslated(dict, errors);
  scanHardcodedEnglish({ rootDir, srcDir, i18nFile }, errors);

  if (errors.length) {
    fail(errors);
  }

  console.log(
    "\u2714 i18n guardrail passed: ar/en keys in parity, no `ar` values left in English, no hardcoded user-facing English found.",
  );
}

export {
  isProseWord,
  untranslatedWords,
  looksLikeEnglish,
  containsArabic,
  longestEnglishRun,
  isNonProseSample,
  classifyArabicValue,
  MIXED_RUN_THRESHOLD,
  BRAND_ALLOW,
};
