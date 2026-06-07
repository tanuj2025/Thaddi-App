import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// --------------------------------------------------------------------------
// Shared RTL guardrail logic
//
// This module holds the single source of truth for the RTL scan used by every
// artifact. Each artifact ships a thin `scripts/check-rtl.mjs` wrapper that
// only supplies its scan root and calls runRtlGuard(); all the detection logic
// (directional-icon list, `Icon`-suffix normalisation, physical-class
// detection, allowlist) lives here so the two copies can never drift apart.
//
// What this guard does
//
// Arabic (RTL) was made to read natively by replacing physical, direction-
// specific Tailwind classes (left/right padding, fixed icon sides, etc.) with
// logical equivalents (ps-/pe-/ms-/me-/start-/end-/text-start/text-end). This
// guard flags any newly-introduced *physical* directional classes so they
// don't silently break RTL again.
//
// Steering: use logical properties or an explicit `rtl:`/`ltr:` variant.
//
// It also flags fixed-direction *icons* (ArrowLeft/ArrowRight/ChevronLeft/
// ChevronRight from lucide-react). These point a hard-coded way and do NOT
// mirror in RTL, so a "back" arrow keeps pointing left in Arabic unless it is
// explicitly flipped. They must carry an RTL flip class (rtl:rotate-180 /
// rtl:-scale-x-100) — or be rotated to point vertically (rotate-90), which is
// direction-neutral. Icons swapped behind a non-directional alias (e.g.
// `const Icon = dir === 'rtl' ? ArrowRight : ArrowLeft`) sidestep this check
// because the JSX tag is the alias, not the raw icon name.
// --------------------------------------------------------------------------

// Class-name helper functions whose string arguments are Tailwind classes.
const CLASS_FNS = new Set(["cn", "cva", "clsx", "cx", "twMerge", "tw", "classNames"]);

// Centering transforms are direction-neutral (50% offset) and intentional;
// they are not an RTL hazard.
const ALLOW_TOKENS = new Set(["left-1/2", "right-1/2"]);

// Horizontally-fixed lucide icons that must be flipped in RTL. lucide exports
// each of these under both the bare name and an `Icon`-suffixed alias (e.g.
// `ChevronLeft` and `ChevronLeftIcon`) — the alias is stripped before lookup so
// both spellings are caught (the vendored calendar/sidebar primitives use the
// alias). The list covers every lucide glyph that points or leans left/right:
// cardinal + diagonal arrows, chevrons (single & double), corner arrows, and
// side panels. Vertical-only glyphs (ChevronUp/Down, ArrowUp/Down) are NOT
// listed — they read the same in either direction. This set is shared by every
// artifact's wrapper, so extending it here covers them all at once.
const DIRECTIONAL_ICONS = new Set([
  // Cardinal horizontal arrows.
  "ArrowLeft", "ArrowRight",
  // Diagonal arrows (they carry a left/right component).
  "ArrowUpLeft", "ArrowUpRight", "ArrowDownLeft", "ArrowDownRight",
  // Chevrons — single and double.
  "ChevronLeft", "ChevronRight", "ChevronsLeft", "ChevronsRight",
  // Corner / elbow arrows.
  "CornerDownLeft", "CornerDownRight", "CornerUpLeft", "CornerUpRight",
  "CornerLeftDown", "CornerLeftUp", "CornerRightDown", "CornerRightUp",
  // Side panels / sidebars (the vendored sidebar toggle uses PanelLeft).
  "PanelLeft", "PanelRight",
  "PanelLeftOpen", "PanelLeftClose", "PanelRightOpen", "PanelRightClose",
]);

// lucide aliases the same glyph as `<Name>` and `<Name>Icon`; normalise the
// trailing `Icon` so an aliased import can't sidestep the directional check.
function normalizeIconName(tagName) {
  return tagName.endsWith("Icon") ? tagName.slice(0, -"Icon".length) : tagName;
}

// A directional icon is considered safe when its className either flips it in
// RTL, or rotates it to point vertically (up/down), which is direction-neutral.
const ICON_OK_PATTERNS = [
  /(^|\s|:)rtl:-?rotate-180(\s|$)/, // rtl:rotate-180 / rtl:-rotate-180
  /(^|\s|:)rtl:-?scale-x-100(\s|$)/, // rtl:-scale-x-100
  /(^|\s|:)-?rotate-90(\s|$)/, // rotate-90 / -rotate-90 -> points up/down
];

function iconHandled(classText) {
  return ICON_OK_PATTERNS.some((re) => re.test(classText));
}

// Pull the combined className string of a JSX element (covers ternaries,
// template strings and cn()-style nesting via collectStringNodes).
function classNameTextOf(jsxElement, sf) {
  for (const attr of jsxElement.attributes.properties) {
    if (ts.isJsxAttribute(attr) && attr.initializer && attr.name.getText(sf) === "className") {
      const found = [];
      collectStringNodes(attr.initializer, found);
      return found.map((f) => f.text).join(" ");
    }
  }
  return "";
}

function suggestionFor(signless) {
  if (/^pl-/.test(signless)) return "padding-left (pl-) — use ps-";
  if (/^pr-/.test(signless)) return "padding-right (pr-) — use pe-";
  if (/^ml-/.test(signless)) return "margin-left (ml-) — use ms-";
  if (/^mr-/.test(signless)) return "margin-right (mr-) — use me-";
  if (/^left-/.test(signless)) return "left inset (left-) — use start-";
  if (/^right-/.test(signless)) return "right inset (right-) — use end-";
  if (signless === "text-left") return "text-left — use text-start";
  if (signless === "text-right") return "text-right — use text-end";
  return null;
}

// Classify a single whitespace-separated class token. Returns a human-readable
// suggestion string if the token is a physical directional class, else null.
function classifyToken(raw) {
  if (!raw) return null;

  // Drop arbitrary-value brackets first so ':' inside e.g. url() or media
  // queries doesn't confuse variant-prefix detection.
  const noBrackets = raw.replace(/\[[^\]]*\]/g, "");

  const segments = noBrackets.split(":");
  const prefixes = segments.slice(0, -1);
  // Explicit rtl:/ltr: variants are intentional direction-aware usage.
  if (prefixes.includes("rtl") || prefixes.includes("ltr")) return null;

  let core = segments[segments.length - 1];
  core = core.replace(/^!/, ""); // important marker

  const signless = core.replace(/^-/, ""); // negative utilities (-ml-2, -left-4)

  if (ALLOW_TOKENS.has(signless)) return null;

  if (/^(pl|pr|ml|mr)-/.test(signless)) return suggestionFor(signless);
  if (/^(left|right)-/.test(signless)) return suggestionFor(signless);
  if (signless === "text-left" || signless === "text-right") return suggestionFor(signless);

  return null;
}

// Recursively collect string-bearing nodes (string literals + template parts)
// within a subtree. Used to pull class strings out of className attributes and
// cn()/cva() calls, including ternaries and nested helpers.
function collectStringNodes(node, out) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push({ node, text: node.text });
  } else if (ts.isTemplateExpression(node)) {
    out.push({ node: node.head, text: node.head.text });
    for (const span of node.templateSpans) {
      out.push({ node: span.literal, text: span.literal.text });
    }
  }
  ts.forEachChild(node, (child) => collectStringNodes(child, out));
}

// --------------------------------------------------------------------------
// Bidi number+label scramble detection
//
// The physical-class scan above cannot see bidirectional *text-ordering* bugs.
// The real RTL bug this guards against: a "number + Arabic unit label" run
// (e.g. the match countdown "٤يوم ٥س ٣د") built by gluing a locale-formatted
// number directly to a translated label and rendering it inside a force-
// directioned element. Bidi reordering then scrambles it (e.g. "٤يوم اس ٥ا د").
//
// The fix is to wrap each number+label unit in a Unicode isolate (FSI…PDI /
// LRI…PDI / RLI…PDI, U+2066–U+2069) so it renders self-contained. This check
// flags the two shapes that produce the bug WITHOUT an isolate:
//
//   1. String building (template literal or `+` concat) that glues a number
//      producer (formatNum(...) or a local alias of it, .toLocaleString()) to a
//      translated/Arabic label (t(...), an Arabic string literal, or a property
//      access label) with no separator and no isolate. This is exactly the
//      original countdown shape: `${n(cd.days)}${labels.days}`.
//   2. A force-directioned JSX element (dir="ltr"/"rtl") whose children build a
//      multi-unit run — two or more number producers alongside a t() label, or
//      a number producer glued directly to a t() label — with no isolate.
//
// Known-safe single number+single-word runs ("١٢ صحيحة"), pure scorelines
// (number/number), and number+punctuation ("78'", "+5") are NOT flagged: they
// either separate the number from the label with whitespace, glue two numbers
// (not a label), or have no label at all.
// --------------------------------------------------------------------------

// Bidi isolate characters: LRI, RLI, FSI, PDI. Their presence means the author
// has already protected the run from reordering, so it is not a hazard.
const ISOLATE_RE = /[\u2066\u2067\u2068\u2069]/;
function containsIsolate(text) {
  return ISOLATE_RE.test(text);
}

// Arabic script + Arabic-Indic digit ranges (mirrors the i18n guard). A label
// string literal containing any of these is an Arabic label.
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// The number-formatting helper whose output is locale digits (Arabic-Indic in
// `ar`). Gluing its result to an Arabic label is what scrambles.
const NUMBER_FN = "formatNum";

function calleeNameOf(callExpr) {
  const callee = callExpr.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return "";
}

function unwrapParens(node) {
  let n = node;
  while (n && ts.isParenthesizedExpression(n)) n = n.expression;
  return n;
}

// Collect, per source file, the names of local arrow/function consts that are
// thin aliases of formatNum (e.g. `const n = (v) => formatNum(v, lang)`). The
// original countdown built its numbers through such an alias, so number-
// producer detection must see through it.
function collectNumberAliases(sf) {
  const aliases = new Set();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const fn = node.initializer;
      let returned = null;
      if (ts.isArrowFunction(fn) && fn.body && ts.isCallExpression(fn.body)) {
        returned = fn.body;
      } else if (fn.body && ts.isBlock(fn.body)) {
        for (const st of fn.body.statements) {
          if (ts.isReturnStatement(st) && st.expression && ts.isCallExpression(st.expression)) {
            returned = st.expression;
            break;
          }
        }
      }
      if (returned && calleeNameOf(returned) === NUMBER_FN) {
        aliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return aliases;
}

// True when `expr` produces a locale-formatted number: a formatNum(...) call, a
// call to a local formatNum alias, or a `.toLocaleString()` call.
function isNumberProducer(expr, aliases) {
  const n = unwrapParens(expr);
  if (!n || !ts.isCallExpression(n)) return false;
  const name = calleeNameOf(n);
  if (name === NUMBER_FN || aliases.has(name)) return true;
  if (
    ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "toLocaleString"
  ) {
    return true;
  }
  return false;
}

// True when `expr` is a translatable/Arabic label that would scramble if glued
// to a number: a t(...) call, an Arabic string literal, or a property-access
// label (e.g. `labels.days`). Bare identifiers and plain Latin string literals
// are intentionally excluded to keep the check non-noisy.
function isBidiLabel(expr, aliases) {
  const n = unwrapParens(expr);
  if (!n) return false;
  if (ts.isCallExpression(n) && calleeNameOf(n) === "t") return true;
  if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && ARABIC_RE.test(n.text)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(n) && !isNumberProducer(n, aliases)) return true;
  return false;
}

// A number+label pairing is a scramble hazard when one side is a number
// producer and the other is a translatable/Arabic label.
function isScramblePair(a, b, aliases) {
  return (
    (isNumberProducer(a, aliases) && isBidiLabel(b, aliases)) ||
    (isNumberProducer(b, aliases) && isBidiLabel(a, aliases))
  );
}

function fail(messages) {
  console.error("\n\u2716 RTL guardrail FAILED\n");
  for (const m of messages) console.error(m);
  console.error(
    "\nFix: replace physical directional classes with logical ones:\n" +
      "  pl-/pr- -> ps-/pe-   ml-/mr- -> ms-/me-   left-/right- -> start-/end-\n" +
      "  text-left/text-right -> text-start/text-end\n" +
      "If a class must be direction-specific on purpose, use an `rtl:`/`ltr:` variant.\n" +
      "Centering transforms (left-1/2, right-1/2) are allowlisted.\n" +
      "\nFor fixed-direction icons (left/right arrows, chevrons, double chevrons,\n" +
      "corner/elbow arrows, side panels — see DIRECTIONAL_ICONS):\n" +
      "  add `rtl:rotate-180` (or `rtl:-scale-x-100`) so they mirror in Arabic,\n" +
      "  or swap the icon behind a direction-aware alias.\n" +
      "  Vertically-rotated arrows (rotate-90 / -rotate-90) are direction-neutral.\n" +
      "\nFor garbled number+label runs (a formatted number glued to an Arabic\n" +
      "label, e.g. the countdown ${n(days)}${t('match.days')}):\n" +
      "  wrap each number+label unit in a Unicode isolate — `\\u2068${value}${label}\\u2069`\n" +
      "  (FSI…PDI) — so it renders self-contained and never reorders in RTL.\n",
  );
  process.exit(1);
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

function scan({ rootDir, srcDir }, errors) {
  const files = walk(srcDir, []);
  const violations = [];
  const iconViolations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = relative(rootDir, file);

    // Collect the unique set of string nodes that live in a class context.
    const classStringNodes = new Map(); // node -> text

    function addFromSubtree(node) {
      const found = [];
      collectStringNodes(node, found);
      for (const { node: n, text } of found) classStringNodes.set(n, text);
    }

    function checkIcon(node) {
      const tagName = node.tagName.getText(sf);
      if (!DIRECTIONAL_ICONS.has(normalizeIconName(tagName))) return;
      const classText = classNameTextOf(node, sf);
      if (iconHandled(classText)) return;
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      iconViolations.push(`  ${rel}:${line + 1}  <${tagName}>  ->  add rtl:rotate-180 (or rtl:-scale-x-100)`);
    }

    function visit(node) {
      // Fixed-direction lucide icons must flip in RTL.
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        checkIcon(node);
      }

      // className / class JSX attributes
      if (ts.isJsxAttribute(node) && node.initializer) {
        const attrName = node.name.getText(sf);
        if (attrName === "className" || attrName === "class") {
          addFromSubtree(node.initializer);
        }
      }

      // cn()/cva()/clsx() etc. — covers variant definitions outside JSX too
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : "";
        if (CLASS_FNS.has(name)) {
          for (const arg of node.arguments) addFromSubtree(arg);
        }
      }

      ts.forEachChild(node, visit);
    }
    visit(sf);

    for (const [node, text] of classStringNodes) {
      const tokens = text.split(/\s+/);
      const hits = [];
      for (const tok of tokens) {
        const suggestion = classifyToken(tok);
        if (suggestion) hits.push({ tok, suggestion });
      }
      if (hits.length) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        for (const { tok, suggestion } of hits) {
          violations.push(`  ${rel}:${line + 1}  "${tok}"  ->  ${suggestion}`);
        }
      }
    }
  }

  if (violations.length) {
    errors.push(`Physical directional Tailwind classes found (${violations.length}):`);
    errors.push(...violations);
  }

  if (iconViolations.length) {
    errors.push(`Fixed-direction icons without an RTL flip found (${iconViolations.length}):`);
    errors.push(...iconViolations);
  }
}

// --------------------------------------------------------------------------
// scanBidiScramble — the AST pass for un-isolated number+label runs.
// Collects into `errors`; never exits, so it is test-safe (mirrors scan()).
// --------------------------------------------------------------------------
function scanBidiScramble({ rootDir, srcDir }, errors) {
  const files = walk(srcDir, []);
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = relative(rootDir, file);
    const aliases = collectNumberAliases(sf);

    const report = (node, detail) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push(`  ${rel}:${line + 1}  ${detail}`);
    };

    // --- Shape 1a: template literals `${num}${label}` (no separator/isolate) ---
    function checkTemplate(node) {
      // A literal-level isolate anywhere in the template means the author has
      // already protected the unit (e.g. the `\u2068${value}${label}\u2069` fix).
      const literals = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      if (literals.some(containsIsolate)) return;

      const spans = node.templateSpans;
      for (let i = 0; i < spans.length - 1; i++) {
        const between = spans[i].literal.text; // text separating expr[i] and expr[i+1]
        // Whitespace separates the digits from the label, so it reads fine
        // ("١٢ صحيحة"). Only a glued (separator-less) interleave scrambles.
        if (/\s/.test(between)) continue;
        if (isScramblePair(spans[i].expression, spans[i + 1].expression, aliases)) {
          report(node, "number glued to an Arabic/translated label in a template literal — wrap the unit in a Unicode isolate (\\u2068…\\u2069)");
          return; // one report per template is enough
        }
      }
    }

    // --- Shape 1b: `+` concatenation num + label (no isolate operand) ---
    function checkPlus(node) {
      if (node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return;
      // An isolate string literal anywhere in this concatenation means the
      // unit is already protected.
      let isolated = false;
      const findIsolate = (n) => {
        if (isolated) return;
        if (
          (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
          containsIsolate(n.text)
        ) {
          isolated = true;
          return;
        }
        ts.forEachChild(n, findIsolate);
      };
      findIsolate(node);
      if (isolated) return;

      if (isScramblePair(node.left, node.right, aliases)) {
        report(node, "number concatenated to an Arabic/translated label with `+` — wrap the unit in a Unicode isolate (\\u2068…\\u2069)");
      }
    }

    // --- Shape 2: force-directioned JSX building a multi-unit number+label run ---
    function checkJsxElement(node) {
      const opening = node.openingElement;
      if (!hasForcedDir(opening, sf)) return;

      // If any child literal already carries an isolate, the run is protected.
      for (const child of node.children) {
        if (ts.isJsxText(child) && containsIsolate(child.text)) return;
      }

      const meaningful = []; // ordered: { kind: 'num'|'label'|'other', node }
      for (const child of node.children) {
        if (ts.isJsxExpression(child) && child.expression) {
          const e = child.expression;
          if (isNumberProducer(e, aliases)) meaningful.push({ kind: "num", node: child });
          else if (isBidiLabel(e, aliases)) meaningful.push({ kind: "label", node: child });
          else meaningful.push({ kind: "other", node: child });
        } else if (ts.isJsxText(child)) {
          // Whitespace-only text between expressions is a separator and reads
          // fine; non-whitespace text is its own segment.
          if (child.text.trim() === "") {
            if (/\s/.test(child.text)) meaningful.push({ kind: "sep", node: child });
          } else {
            meaningful.push({ kind: "other", node: child });
          }
        }
      }

      const numCount = meaningful.filter((m) => m.kind === "num").length;
      const labelCount = meaningful.filter((m) => m.kind === "label").length;

      // Directly glued `{num}{label}` (array-adjacent, nothing between them).
      let glued = false;
      for (let i = 0; i < meaningful.length - 1; i++) {
        const a = meaningful[i].kind;
        const b = meaningful[i + 1].kind;
        if ((a === "num" && b === "label") || (a === "label" && b === "num")) {
          glued = true;
          break;
        }
      }

      // A multi-unit run (2+ numbers with a label) or a glued number+label pair
      // is the countdown shape. A single number + single label separated by
      // whitespace is the allowlisted "١٢ صحيحة" case and is left clean.
      if (glued || (numCount >= 2 && labelCount >= 1)) {
        report(
          opening,
          `<${opening.tagName.getText(sf)} dir="…"> builds a number+label run — wrap each unit in a Unicode isolate (\\u2068…\\u2069)`,
        );
      }
    }

    function visit(node) {
      if (ts.isTemplateExpression(node)) checkTemplate(node);
      if (ts.isBinaryExpression(node)) checkPlus(node);
      if (ts.isJsxElement(node)) checkJsxElement(node);
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  if (violations.length) {
    errors.push(`Un-isolated number+label runs (bidi scramble risk) found (${violations.length}):`);
    errors.push(...violations);
  }
}

// True when a JSX opening element has a literal `dir="ltr"`/`dir="rtl"` attribute
// (a hard-coded forced direction). `dir={dir}` (the dynamic, language-driven
// container direction) is intentionally NOT a forced direction and is ignored.
function hasForcedDir(opening, sf) {
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== "dir" || !attr.initializer) continue;
    const init = attr.initializer;
    let value = null;
    if (ts.isStringLiteral(init)) value = init.text;
    else if (
      ts.isJsxExpression(init) &&
      init.expression &&
      (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
    ) {
      value = init.expression.text;
    }
    if (value === "ltr" || value === "rtl") return true;
  }
  return false;
}

// Run the RTL guard over `srcDir`, reporting paths relative to `rootDir`.
// Exits the process with code 1 (via fail()) when violations are found.
export function runRtlGuard({ rootDir, srcDir }) {
  const errors = [];
  scan({ rootDir, srcDir }, errors);
  scanBidiScramble({ rootDir, srcDir }, errors);

  if (errors.length) {
    fail(errors);
  }

  console.log(
    "\u2714 RTL guardrail passed: no physical directional Tailwind classes or un-isolated number+label runs in app code.",
  );
}

// Exported for testing — these are the subtle detection helpers the guard relies
// on. Tests exercise them directly (and run `scan` end-to-end against fixtures)
// so a future edit cannot silently weaken detection or add false positives.
export {
  classifyToken,
  normalizeIconName,
  iconHandled,
  scan,
  DIRECTIONAL_ICONS,
  ALLOW_TOKENS,
  // Bidi number+label scramble detection.
  scanBidiScramble,
  containsIsolate,
  collectNumberAliases,
  isNumberProducer,
  isBidiLabel,
};
