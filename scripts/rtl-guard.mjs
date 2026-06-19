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

// Directories that never hold first-party source and would only add noise (and
// crippling slowness) if walked: dependency trees, VCS, build output. Mirrors
// the i18n guard so the two share the same traversal semantics.
const SKIP_DIRS = new Set(["node_modules", ".git", ".expo", "dist", "build", ".next"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
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

// Normalise the `srcDir` option (string or string[]) into the flat list of
// `.ts`/`.tsx` files to scan. Lets an artifact whose source spans several
// top-level dirs (e.g. the Expo app: app/ components/ hooks/ lib/ constants/)
// pass an array, while the single-`src/` web/mockup artifacts keep passing a
// string. Mirrors collectSourceFiles in the i18n guard.
function collectSourceFiles(srcDir) {
  const dirs = Array.isArray(srcDir) ? srcDir : [srcDir];
  const out = [];
  for (const d of dirs) walk(d, out);
  return out;
}

// Build a predicate that drops files matched by any `ignore` entry (substring
// or RegExp), mirroring the i18n guard's ignore semantics. Used so an artifact
// can exclude files that legitimately cannot follow the rule (e.g. a crash
// screen that renders above the direction context and must stay static).
function notIgnored(ignore) {
  return (f) => !ignore.some((p) => (p instanceof RegExp ? p.test(f) : f.includes(p)));
}

function scan({ rootDir, srcDir, ignore = [] }, errors) {
  const files = collectSourceFiles(srcDir).filter(notIgnored(ignore));
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
function scanBidiScramble({ rootDir, srcDir, ignore = [] }, errors) {
  const files = collectSourceFiles(srcDir).filter(notIgnored(ignore));
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

// --------------------------------------------------------------------------
// scanInlineStyles — flags inline `style={{ }}` props that use physical
// direction CSS property names. Physical layout properties (left/right margins,
// padding, insets, text-align, float) break RTL because they are direction-
// fixed. Use logical CSS equivalents (insetInlineStart, marginInlineStart,
// paddingInlineEnd, textAlign:'start'/'end') or isolate intentional
// direction-fixed elements with an explicit `dir="ltr"` wrapper.
//
// Skips vendored Radix/shadcn primitives in `components/ui/` — those own
// their layout and cannot be changed without forking the component.
// --------------------------------------------------------------------------
const PHYSICAL_STYLE_PROPS = new Set([
  "left", "right",
  "marginLeft", "marginRight",
  "paddingLeft", "paddingRight",
  "borderLeft", "borderRight",
  "borderLeftColor", "borderRightColor",
  "borderLeftWidth", "borderRightWidth",
  "borderLeftStyle", "borderRightStyle",
  "float",
]);
const TEXT_ALIGN_BANNED = new Set(["left", "right"]);
const SKIP_UI_RE = /[/\\]components[/\\]ui[/\\]/;

// Collect all module-level `const name = { ... }` declarations in a source
// file whose initializer is a static object literal. Used to resolve
// `style={styleVar}` to the object literal it refers to.
// Note: resolveIdentifierInScope handles both module-level and function-local
// declarations via parent-chain walking; this function is kept for tests.
function collectStaticStyleObjects(sf) {
  const map = new Map(); // identifier name -> ObjectLiteralExpression node
  function visit(node) {
    if (ts.isVariableStatement(node) && node.parent === sf) {
      for (const decl of node.declarationList.declarations) {
        if (
          decl.name &&
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isObjectLiteralExpression(decl.initializer)
        ) {
          map.set(decl.name.text, decl.initializer);
        }
      }
    }
    if (node === sf) ts.forEachChild(node, visit);
  }
  visit(sf);
  return map;
}

// Resolve a JSX `style={identNode}` identifier to its static object-literal
// initializer by walking up the AST parent chain. Handles both module-level
// and function-local static declarations:
//
//   // module-level — caught
//   const styleObj = { marginLeft: 8 };
//   export const C = () => <div style={styleObj} />;
//
//   // function-local — also caught
//   export const C = () => {
//     const s = { marginLeft: 8 };
//     return <div style={s} />;
//   };
//
// Works because createSourceFile is called with setParentNodes = true, so
// every node has a `.parent` back-reference through the full tree.
function resolveIdentifierInScope(identNode) {
  const name = identNode.text;
  // Walk up the ancestor chain, searching each Block/SourceFile's statements.
  let scope = identNode.parent;
  while (scope) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      for (const stmt of scope.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (
            decl.name &&
            ts.isIdentifier(decl.name) &&
            decl.name.text === name &&
            decl.initializer &&
            ts.isObjectLiteralExpression(decl.initializer)
          ) {
            return decl.initializer;
          }
        }
      }
    }
    scope = scope.parent;
  }
  return null;
}

function scanInlineStyles({ rootDir, srcDir, ignore = [] }, errors) {
  const files = collectSourceFiles(srcDir).filter(notIgnored(ignore));
  const violations = [];

  for (const file of files) {
    if (SKIP_UI_RE.test(file)) continue;

    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = relative(rootDir, file);

    function reportAt(node, msg) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push(`  ${rel}:${line + 1}  ${msg}`);
    }

    function checkStyleObject(objLit) {
      for (const prop of objLit.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = prop.name;
        let propName = "";
        if (ts.isIdentifier(key)) propName = key.text;
        else if (ts.isStringLiteral(key)) propName = key.text;
        else continue;

        if (PHYSICAL_STYLE_PROPS.has(propName)) {
          reportAt(prop,
            `style with '${propName}' — physical direction property; ` +
            `use logical CSS (insetInlineStart/End, marginInlineStart/End, ` +
            `paddingInlineStart/End) or wrap the element in dir="ltr" when the ` +
            `physical direction is intentional (e.g. sports score display)`
          );
          continue;
        }

        if (propName === "textAlign") {
          const val = prop.initializer;
          let valText = "";
          if (ts.isStringLiteral(val) || ts.isNoSubstitutionTemplateLiteral(val)) {
            valText = val.text;
          } else if (
            ts.isJsxExpression(val) &&
            val.expression &&
            (ts.isStringLiteral(val.expression) ||
              ts.isNoSubstitutionTemplateLiteral(val.expression))
          ) {
            valText = val.expression.text;
          }
          if (TEXT_ALIGN_BANNED.has(valText)) {
            reportAt(prop,
              `style with textAlign:'${valText}' — use textAlign:'start' or 'end' for RTL-safe alignment`
            );
          }
        }
      }
    }

    function visit(node) {
      if (
        ts.isJsxAttribute(node) &&
        node.name &&
        node.name.getText(sf) === "style" &&
        node.initializer
      ) {
        let expr = node.initializer;
        // Unwrap JSX expression container: style={...}
        if (ts.isJsxExpression(expr) && expr.expression) expr = expr.expression;

        if (ts.isObjectLiteralExpression(expr)) {
          // Direct object literal: style={{ left: ... }}
          checkStyleObject(expr);
        } else if (ts.isIdentifier(expr)) {
          // Variable reference: style={styleObj} — resolve via scope walk.
          // Handles both module-level and function-local static declarations.
          const resolved = resolveIdentifierInScope(expr);
          if (resolved) checkStyleObject(resolved);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  if (violations.length) {
    errors.push(
      `Inline style with physical direction CSS properties found (${violations.length}):`
    );
    errors.push(...violations);
  }
}

// --------------------------------------------------------------------------
// scanInlineStylesMobile — the React Native variant of the inline `style={{ }}`
// physical-direction check.
//
// The web `scanInlineStyles` pass flags a physical box-model property name
// (marginLeft, paddingRight, left/right, …) the moment it appears, regardless
// of its value. That is correct for the web (CSS logical properties + the
// `dir` attribute do the mirroring), but it would drown the Expo app in false
// positives: React Native does almost all of its layout with *inline* styles
// and legitimately mirrors them by computing the value (or the property key)
// from `dir` — e.g.
//
//   style={{ ...(dir === "rtl" ? { left: 2 } : { right: 2 }) }}   // dir-aware
//   style={{ [dir === "rtl" ? "marginRight" : "marginLeft"]: 8 }} // dir-aware
//   style={{ textAlign: dir === "rtl" ? "right" : "left" }}       // dir-aware
//
// This mobile variant therefore flags only a *static* physical direction
// property — one whose value, key, and enclosing context never read `dir`:
//
//   style={{ marginLeft: 8 }}        // FLAGGED — never mirrors for RTL
//   style={{ textAlign: "left" }}    // FLAGGED — never mirrors for RTL
//
// Because the app does NOT call I18nManager.forceRTL (see lib/i18n.tsx), even
// RN's logical props (marginStart/start) would not mirror, so the sanctioned
// fix is always a dir-aware value/key (or a computed key) reading `dir`.
//
// Unlike the web pass it descends through the RN style shapes — arrays
// (`style={[a, { … }]}`), ternaries, `&&`/`||` spreads, parenthesised exprs,
// and `style={() => ({ … })}` callbacks — and through `...spread` properties,
// because RN style props are routinely composed that way. Identifiers are
// resolved to their static object literal via resolveIdentifierInScope.
// Vendored `components/ui/` is skipped (same as the web pass).
// --------------------------------------------------------------------------

// True when any identifier named `dir` appears anywhere in the subtree. Used to
// decide whether a physical property is dir-aware (its value, computed key, or
// an enclosing ternary/`&&` condition reads `dir`) and therefore sanctioned.
function referencesDir(node) {
  if (!node) return false;
  let found = false;
  (function walk(n) {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === "dir") {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  })(node);
  return found;
}

function scanInlineStylesMobile({ rootDir, srcDir, ignore = [] }, errors) {
  const files = collectSourceFiles(srcDir).filter(notIgnored(ignore));
  const violations = [];

  for (const file of files) {
    if (SKIP_UI_RE.test(file)) continue;

    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = relative(rootDir, file);

    const reportAt = (node, msg) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push(`  ${rel}:${line + 1}  ${msg}`);
    };

    // `dirAware` is true once we have descended through a ternary/`&&` whose
    // condition reads `dir` (so the branch is a per-direction value) — every
    // physical property inside it is sanctioned.
    function checkObject(objLit, dirAware) {
      for (const prop of objLit.properties) {
        // `...(dir === "rtl" ? { left } : { right })` and `...base` — recurse so
        // physical props composed via spread are checked in their own context.
        if (ts.isSpreadAssignment(prop)) {
          checkExpr(prop.expression, dirAware);
          continue;
        }
        if (!ts.isPropertyAssignment(prop)) continue;

        const key = prop.name;
        // A computed key reading `dir` — `[dir === "rtl" ? "marginRight" :
        // "marginLeft"]` — is the sanctioned dir-aware pattern, so it is never a
        // static physical prop. Skip computed keys entirely.
        if (ts.isComputedPropertyName(key)) continue;

        let propName = "";
        if (ts.isIdentifier(key)) propName = key.text;
        else if (ts.isStringLiteral(key)) propName = key.text;
        else continue;

        if (PHYSICAL_STYLE_PROPS.has(propName)) {
          // dir-aware (value reads `dir`, or an enclosing ternary did) -> allow.
          if (dirAware || referencesDir(prop.initializer)) continue;
          reportAt(prop,
            `inline style '${propName}' — static physical direction property won't ` +
            `mirror for RTL (this app does not use I18nManager.forceRTL). Use a ` +
            `dir-aware value or computed key, e.g. ` +
            `{ [dir === "rtl" ? "marginRight" : "marginLeft"]: x }, or read dir from useI18n()`
          );
          continue;
        }

        if (propName === "textAlign") {
          if (dirAware || referencesDir(prop.initializer)) continue;
          const val = styleStringValue(prop.initializer);
          if (val && TEXT_ALIGN_BANNED.has(val)) {
            reportAt(prop,
              `inline style textAlign:'${val}' — use a dir-aware value ` +
              `(textAlign(dir) from lib/i18n) so it flips for RTL`
            );
          }
        }
      }
    }

    // Recurse the RN style shapes, threading the dir-aware context through.
    function checkExpr(expr, dirAware) {
      if (!expr) return;
      let n = expr;
      while (ts.isParenthesizedExpression(n)) n = n.expression;

      if (ts.isObjectLiteralExpression(n)) {
        checkObject(n, dirAware);
        return;
      }
      if (ts.isArrayLiteralExpression(n)) {
        for (const el of n.elements) checkExpr(el, dirAware);
        return;
      }
      if (ts.isConditionalExpression(n)) {
        const da = dirAware || referencesDir(n.condition);
        checkExpr(n.whenTrue, da);
        checkExpr(n.whenFalse, da);
        return;
      }
      if (
        ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
      ) {
        // `dir === "rtl" && { left: 2 }` — the left operand is the dir guard.
        const da = dirAware || referencesDir(n.left);
        checkExpr(n.right, da);
        // `base ?? { … }` / `cond || { … }` — the left can also carry a style.
        checkExpr(n.left, dirAware);
        return;
      }
      if (ts.isArrowFunction(n)) {
        // `style={({ pressed }) => ({ … })}` and block-bodied callbacks.
        if (ts.isBlock(n.body)) {
          for (const st of n.body.statements) {
            if (ts.isReturnStatement(st) && st.expression) checkExpr(st.expression, dirAware);
          }
        } else {
          checkExpr(n.body, dirAware);
        }
        return;
      }
      if (ts.isIdentifier(n)) {
        const resolved = resolveIdentifierInScope(n);
        if (resolved) checkExpr(resolved, dirAware);
      }
    }

    function visit(node) {
      if (
        ts.isJsxAttribute(node) &&
        node.name &&
        node.name.getText(sf) === "style" &&
        node.initializer
      ) {
        let expr = node.initializer;
        if (ts.isJsxExpression(expr) && expr.expression) expr = expr.expression;
        checkExpr(expr, false);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  if (violations.length) {
    errors.push(
      `Inline style with static physical direction properties (React Native) found (${violations.length}):`
    );
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

// --------------------------------------------------------------------------
// scanStyleSheet — the React Native pass for physical direction properties in
// `StyleSheet.create({ ... })` objects.
//
// The web passes above cover Tailwind classes and inline `style={{ }}` props.
// React Native's static styles instead live in `StyleSheet.create({...})`
// objects, where the property names (marginLeft, paddingRight, left/right,
// textAlign, flexDirection) are camelCase identifiers rather than CSS strings
// or class tokens — so neither web pass sees them.
//
// The Expo app deliberately does NOT call `I18nManager.forceRTL` (it requires a
// native reload and fights Expo Go / runtime language switching — see
// lib/i18n.tsx). Because of that, even React Native's *logical* style props
// (`marginStart`/`marginEnd`, `start`/`end`) would NOT mirror: they resolve off
// `I18nManager.isRTL`, which stays false without forceRTL. The app instead
// mirrors every layout by reading `dir` from useI18n() and computing the value
// dynamically (`flexDirection: rowDirection(dir)`, `textAlign(dir)`, etc.).
//
// Therefore any *static* physical direction property baked into a
// StyleSheet.create object is a latent RTL bug: it can never mirror. This pass
// flags those so the dir-aware helpers in lib/i18n.tsx are used instead (or the
// property moved to a dir-aware inline style). Files that legitimately render
// outside the direction context (e.g. the crash screen above I18nProvider) are
// excluded via the wrapper's `ignore` list.
// --------------------------------------------------------------------------

// Box-model / inset / border properties that are direction-fixed in a static
// RN StyleSheet (no logical equivalent works without forceRTL — see above).
const STYLESHEET_PHYSICAL_PROPS = new Set([
  "left", "right",
  "marginLeft", "marginRight",
  "paddingLeft", "paddingRight",
  "borderLeftWidth", "borderRightWidth",
  "borderLeftColor", "borderRightColor",
  "borderTopLeftRadius", "borderTopRightRadius",
  "borderBottomLeftRadius", "borderBottomRightRadius",
]);
// textAlign / flexDirection are flagged only for their direction-specific
// literal values; 'center'/'auto'/'justify' and 'column'/'column-reverse' read
// the same in either direction and are left clean.
const STYLESHEET_TEXT_ALIGN_BANNED = new Set(["left", "right"]);
const STYLESHEET_FLEX_DIR_BANNED = new Set(["row", "row-reverse"]);

// True when `node` is a `StyleSheet.create(...)` call expression.
function isStyleSheetCreateCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "create" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "StyleSheet"
  );
}

// Pull the static string value of a style property initializer (string literal
// or no-substitution template). Computed/conditional values return null and are
// not flagged — a value computed from `dir` is exactly the sanctioned fix and
// cannot appear in a static StyleSheet anyway.
function styleStringValue(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function scanStyleSheet({ rootDir, srcDir, ignore = [] }, errors) {
  const files = collectSourceFiles(srcDir).filter(notIgnored(ignore));
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = relative(rootDir, file);

    const report = (node, msg) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push(`  ${rel}:${line + 1}  ${msg}`);
    };

    function checkProp(prop) {
      if (!ts.isPropertyAssignment(prop)) return;
      const key = prop.name;
      let propName = "";
      if (ts.isIdentifier(key)) propName = key.text;
      else if (ts.isStringLiteral(key)) propName = key.text;
      else return;

      if (STYLESHEET_PHYSICAL_PROPS.has(propName)) {
        report(prop,
          `StyleSheet '${propName}' — physical direction property won't mirror for RTL ` +
          `(this app does not use I18nManager.forceRTL). Move it to a dir-aware inline ` +
          `style, e.g. { [dir === "rtl" ? "marginRight" : "marginLeft"]: x }`
        );
        return;
      }

      if (propName === "textAlign") {
        const val = styleStringValue(prop.initializer);
        if (val && STYLESHEET_TEXT_ALIGN_BANNED.has(val)) {
          report(prop,
            `StyleSheet textAlign:'${val}' — use a dir-aware value (textAlign(dir) from ` +
            `lib/i18n) so it flips for RTL`
          );
        }
        return;
      }

      if (propName === "flexDirection") {
        const val = styleStringValue(prop.initializer);
        if (val && STYLESHEET_FLEX_DIR_BANNED.has(val)) {
          report(prop,
            `StyleSheet flexDirection:'${val}' — a static row won't mirror for RTL; use a ` +
            `dir-aware value (rowDirection(dir) from lib/i18n)`
          );
        }
        return;
      }
    }

    // Within a StyleSheet.create argument every object literal is a style (or a
    // nested style sub-object like shadowOffset), so it is safe to check every
    // PropertyAssignment in the subtree.
    function walkStyleSubtree(node) {
      if (ts.isPropertyAssignment(node)) checkProp(node);
      ts.forEachChild(node, walkStyleSubtree);
    }

    function visit(node) {
      if (isStyleSheetCreateCall(node) && node.arguments.length > 0) {
        const arg = node.arguments[0];
        if (ts.isObjectLiteralExpression(arg)) walkStyleSubtree(arg);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  if (violations.length) {
    errors.push(
      `StyleSheet physical direction properties (React Native) found (${violations.length}):`
    );
    errors.push(...violations);
  }
}

// Run the RTL guard over `srcDir`, reporting paths relative to `rootDir`.
// Exits the process with code 1 (via fail()) when violations are found.
//
// `srcDir` may be a string or an array of dirs (the Expo app spans several
// top-level dirs). `ignore` drops files that legitimately can't follow the rule
// (substring or RegExp, mirroring the i18n guard). `scans` selects which passes
// run: web artifacts use the default Tailwind/bidi/inline-style passes, while
// the React Native app runs only the `styleSheet` pass (its className/lucide and
// literal-isolate-based bidi heuristics don't apply to RN — countdowns there use
// the ltrIsolate() helper, which the literal-based bidi pass cannot see).
export function runRtlGuard({ rootDir, srcDir, ignore = [], scans } = {}) {
  const enabled = new Set(scans ?? ["tailwind", "bidi", "inlineStyles"]);
  const errors = [];
  if (enabled.has("tailwind")) scan({ rootDir, srcDir, ignore }, errors);
  if (enabled.has("bidi")) scanBidiScramble({ rootDir, srcDir, ignore }, errors);
  if (enabled.has("inlineStyles")) scanInlineStyles({ rootDir, srcDir, ignore }, errors);
  if (enabled.has("mobileInlineStyles")) scanInlineStylesMobile({ rootDir, srcDir, ignore }, errors);
  if (enabled.has("styleSheet")) scanStyleSheet({ rootDir, srcDir, ignore }, errors);

  if (errors.length) {
    fail(errors);
  }

  console.log(
    `\u2714 RTL guardrail passed (${[...enabled].join(", ")}): no physical directional ` +
    "classes, un-isolated number+label runs, or physical inline/StyleSheet properties in app code.",
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
  // Inline style physical property detection.
  scanInlineStyles,
  PHYSICAL_STYLE_PROPS,
  collectStaticStyleObjects,
  resolveIdentifierInScope,
  // React Native inline-style (mobile) physical property detection.
  scanInlineStylesMobile,
  referencesDir,
  // React Native StyleSheet physical property detection.
  scanStyleSheet,
  STYLESHEET_PHYSICAL_PROPS,
  isStyleSheetCreateCall,
};
