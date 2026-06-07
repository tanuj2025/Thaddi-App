#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");
const I18N_FILE = join(SRC, "lib", "i18n.tsx");

// Proper nouns / brand names that are intentionally identical across languages.
// A translation check should NOT demand these be wrapped in t().
const BRAND_ALLOW = new Set(
  ["THADDI", "Instagram", "TikTok", "WhatsApp", "PlayStation", "FAQ"].map((w) => w.toLowerCase()),
);

// Returns the user-facing English "words" that remain after removing brand
// proper nouns and non-prose tokens (format masks like "XXXX", single letters).
// A non-empty result means the string contains genuine untranslated English.
function untranslatedWords(text) {
  const stripped = text.replace(/&[a-zA-Z]+;/g, " ");
  const tokens = stripped.match(/[A-Za-z]{2,}/g);
  if (!tokens) return [];
  return tokens.filter((tok) => {
    if (BRAND_ALLOW.has(tok.toLowerCase())) return false;
    if (/^[Xx]+$/.test(tok)) return false; // input masks e.g. 05XXXXXXXX
    return true;
  });
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
function extractDictKeys() {
  const source = readFileSync(I18N_FILE, "utf8");
  const sf = ts.createSourceFile(I18N_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const blocks = {};

  function readBlock(objLiteral) {
    const keys = [];
    for (const prop of objLiteral.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const name = prop.name;
        if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) keys.push(name.text);
        else if (ts.isIdentifier(name)) keys.push(name.text);
      }
    }
    return keys;
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

function checkKeyParity(errors) {
  const { ar, en } = extractDictKeys();
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
function shouldSkip(file) {
  return resolve(file) === resolve(I18N_FILE);
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

function scanHardcodedEnglish(errors) {
  const files = walk(SRC, []).filter((f) => !shouldSkip(f));
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = relative(ROOT, file);

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
        if (UI_TEXT_ATTRS.has(attrName)) {
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
            report(node, `attr:${attrName}`, value);
          }
        }
      }

      // Hardcoded English passed to a user-facing toast/sonner call.
      // Handles both: toast('msg') / toast.success('msg') (sonner-style)
      // and toast({ title: 'msg', description: 'msg' }) (options object).
      if (ts.isCallExpression(node)) {
        let calleeRoot = null;
        if (ts.isIdentifier(node.expression)) {
          calleeRoot = node.expression.text;
        } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
          calleeRoot = node.expression.expression.text;
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
const errors = [];
checkKeyParity(errors);
scanHardcodedEnglish(errors);

if (errors.length) {
  fail(errors);
}

console.log("\u2714 i18n guardrail passed: ar/en keys in parity, no hardcoded user-facing English found.");
