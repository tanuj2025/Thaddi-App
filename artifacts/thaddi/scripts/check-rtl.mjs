#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");

// --------------------------------------------------------------------------
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

// The vendored shadcn primitives in components/ui/ were converted to logical
// directional properties (ps-/pe-/ms-/me-/start-/end-/text-start/text-end) so
// they read natively in RTL, so they are now covered by this guard like the
// rest of the app. Nothing is skipped.
const SKIP_REL_PREFIXES = [];

// Class-name helper functions whose string arguments are Tailwind classes.
const CLASS_FNS = new Set(["cn", "cva", "clsx", "cx", "twMerge", "tw", "classNames"]);

// Centering transforms are direction-neutral (50% offset) and intentional;
// they are not an RTL hazard.
const ALLOW_TOKENS = new Set(["left-1/2", "right-1/2"]);

// Horizontally-fixed lucide icons that must be flipped in RTL.
const DIRECTIONAL_ICONS = new Set(["ArrowLeft", "ArrowRight", "ChevronLeft", "ChevronRight"]);

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

function fail(messages) {
  console.error("\n\u2716 RTL guardrail FAILED\n");
  for (const m of messages) console.error(m);
  console.error(
    "\nFix: replace physical directional classes with logical ones:\n" +
      "  pl-/pr- -> ps-/pe-   ml-/mr- -> ms-/me-   left-/right- -> start-/end-\n" +
      "  text-left/text-right -> text-start/text-end\n" +
      "If a class must be direction-specific on purpose, use an `rtl:`/`ltr:` variant.\n" +
      "Centering transforms (left-1/2, right-1/2) are allowlisted.\n" +
      "\nFor fixed-direction icons (ArrowLeft/ArrowRight/ChevronLeft/ChevronRight):\n" +
      "  add `rtl:rotate-180` (or `rtl:-scale-x-100`) so they mirror in Arabic,\n" +
      "  or swap the icon behind a direction-aware alias.\n" +
      "  Vertically-rotated arrows (rotate-90 / -rotate-90) are direction-neutral.\n",
  );
  process.exit(1);
}

function shouldSkip(file) {
  const rel = relative(SRC, file);
  return SKIP_REL_PREFIXES.some((p) => rel.startsWith(p));
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

function scan(errors) {
  const files = walk(SRC, []).filter((f) => !shouldSkip(f));
  const violations = [];
  const iconViolations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = relative(ROOT, file);

    // Collect the unique set of string nodes that live in a class context.
    const classStringNodes = new Map(); // node -> text

    function addFromSubtree(node) {
      const found = [];
      collectStringNodes(node, found);
      for (const { node: n, text } of found) classStringNodes.set(n, text);
    }

    function checkIcon(node) {
      const tagName = node.tagName.getText(sf);
      if (!DIRECTIONAL_ICONS.has(tagName)) return;
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

const errors = [];
scan(errors);

if (errors.length) {
  fail(errors);
}

console.log("\u2714 RTL guardrail passed: no physical directional Tailwind classes in app code.");
