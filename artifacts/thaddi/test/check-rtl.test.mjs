import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyToken,
  normalizeIconName,
  iconHandled,
  scan,
  DIRECTIONAL_ICONS,
  ALLOW_TOKENS,
  scanBidiScramble,
  containsIsolate,
} from "@workspace/scripts/rtl-guard.mjs";

// These tests lock in the subtle heuristics inside the RTL guardrail (shared by
// every artifact's check-rtl.mjs wrapper) so a future edit cannot silently
// weaken detection (letting a backwards Arabic layout or a fixed-direction icon
// slip through) or introduce false positives (flagging legitimate logical/
// rtl-aware classes). They exercise the exported detection helpers directly,
// plus run the AST `scan` end-to-end against on-disk fixtures.

// --------------------------------------------------------------------------
// classifyToken — physical directional Tailwind class detection
// --------------------------------------------------------------------------
test("classifyToken flags physical padding/margin directional utilities", () => {
  assert.ok(classifyToken("pl-4"));
  assert.ok(classifyToken("pr-2"));
  assert.ok(classifyToken("ml-1"));
  assert.ok(classifyToken("mr-3"));
});

test("classifyToken flags physical inset utilities", () => {
  assert.ok(classifyToken("left-0"));
  assert.ok(classifyToken("right-4"));
});

test("classifyToken flags text-left / text-right alignment", () => {
  assert.ok(classifyToken("text-left"));
  assert.ok(classifyToken("text-right"));
});

test("classifyToken sees through the negative sign and important marker", () => {
  // Negative utilities (-ml-2, -left-4) and `!`-important must still be caught.
  assert.ok(classifyToken("-ml-2"));
  assert.ok(classifyToken("-left-4"));
  assert.ok(classifyToken("!pr-2"));
});

test("classifyToken returns a human-readable logical-property suggestion", () => {
  assert.match(classifyToken("pl-4"), /ps-/);
  assert.match(classifyToken("pr-4"), /pe-/);
  assert.match(classifyToken("ml-4"), /ms-/);
  assert.match(classifyToken("mr-4"), /me-/);
  assert.match(classifyToken("left-0"), /start-/);
  assert.match(classifyToken("right-0"), /end-/);
  assert.match(classifyToken("text-left"), /text-start/);
  assert.match(classifyToken("text-right"), /text-end/);
});

// --- Negative cases: these must stay clean (return null) ---
test("classifyToken leaves logical properties clean", () => {
  for (const tok of [
    "ps-4", "pe-4", "ms-2", "me-2", "start-0", "end-0", "text-start", "text-end",
  ]) {
    assert.equal(classifyToken(tok), null, `expected "${tok}" to be clean`);
  }
});

test("classifyToken treats explicit rtl:/ltr: variants as intentional", () => {
  // Direction-aware variants are the sanctioned escape hatch.
  assert.equal(classifyToken("rtl:pl-4"), null);
  assert.equal(classifyToken("ltr:text-left"), null);
  assert.equal(classifyToken("md:rtl:ml-2"), null);
});

test("classifyToken allowlists centering transforms", () => {
  // left-1/2 and right-1/2 are direction-neutral 50% offsets.
  assert.equal(classifyToken("left-1/2"), null);
  assert.equal(classifyToken("right-1/2"), null);
  assert.ok(ALLOW_TOKENS.has("left-1/2"));
  assert.ok(ALLOW_TOKENS.has("right-1/2"));
});

test("classifyToken ignores unrelated and empty tokens", () => {
  for (const tok of ["", "flex", "h-4", "w-full", "items-center", "gap-2"]) {
    assert.equal(classifyToken(tok), null, `expected "${tok}" to be clean`);
  }
});

test("classifyToken is not confused by arbitrary-value brackets containing ':'", () => {
  // The ':' inside [url(...)] / media queries must not read as a variant prefix.
  assert.equal(classifyToken("bg-[url(http://x)]"), null);
  // A real physical class with an arbitrary value is still flagged.
  assert.ok(classifyToken("pl-[10px]"));
});

// --------------------------------------------------------------------------
// normalizeIconName — strips the lucide `Icon` alias suffix
// --------------------------------------------------------------------------
test("normalizeIconName strips a trailing Icon suffix", () => {
  assert.equal(normalizeIconName("ChevronLeftIcon"), "ChevronLeft");
  assert.equal(normalizeIconName("PanelLeftIcon"), "PanelLeft");
});

test("normalizeIconName leaves bare names untouched", () => {
  assert.equal(normalizeIconName("ChevronLeft"), "ChevronLeft");
  assert.equal(normalizeIconName("ArrowRight"), "ArrowRight");
});

test("DIRECTIONAL_ICONS covers horizontal glyphs (incl. aliases) but not vertical ones", () => {
  // Horizontal arrows/chevrons/panels are directional.
  for (const name of ["ArrowLeft", "ChevronRight", "ChevronsLeft", "PanelLeft", "CornerDownLeft"]) {
    assert.ok(DIRECTIONAL_ICONS.has(name), `${name} should be directional`);
  }
  // The `Icon` alias resolves into the set after normalisation.
  assert.ok(DIRECTIONAL_ICONS.has(normalizeIconName("ChevronLeftIcon")));
  // Vertical-only glyphs read the same in either direction.
  for (const name of ["ChevronUp", "ChevronDown", "ArrowUp", "ArrowDown"]) {
    assert.ok(!DIRECTIONAL_ICONS.has(name), `${name} should NOT be directional`);
  }
});

// --------------------------------------------------------------------------
// iconHandled — a directional icon is safe when it flips or points vertically
// --------------------------------------------------------------------------
test("iconHandled accepts an explicit RTL flip", () => {
  assert.equal(iconHandled("h-4 w-4 rtl:rotate-180"), true);
  assert.equal(iconHandled("rtl:-rotate-180"), true);
  assert.equal(iconHandled("ms-auto rtl:-scale-x-100"), true);
});

test("iconHandled accepts a vertical rotation (direction-neutral)", () => {
  assert.equal(iconHandled("rotate-90"), true);
  assert.equal(iconHandled("-rotate-90 h-4"), true);
});

test("iconHandled rejects a bare directional icon with no flip", () => {
  assert.equal(iconHandled(""), false);
  assert.equal(iconHandled("h-4 w-4"), false);
  // A non-rtl rotate-180 does NOT flip per-direction, so it is not a safe flip.
  assert.equal(iconHandled("rotate-180"), false);
});

// --------------------------------------------------------------------------
// scan — the end-to-end AST pass over real .tsx files (fixtures on disk).
// scan() collects into the `errors` array and never exits, so it is test-safe.
// --------------------------------------------------------------------------
function runScan(files) {
  const root = mkdtempSync(join(tmpdir(), "rtl-guard-"));
  const srcDir = join(root, "src");
  mkdirSync(srcDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(srcDir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  const errors = [];
  try {
    scan({ rootDir: root, srcDir }, errors);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return errors.join("\n");
}

test("scan flags a physical directional class in JSX className", () => {
  const out = runScan({
    "Bad.tsx": `export const Bad = () => <div className="pl-4 text-left">hi</div>;`,
  });
  assert.match(out, /Physical directional Tailwind classes/);
  assert.match(out, /Bad\.tsx/);
});

test("scan flags an aliased directional icon missing an RTL flip", () => {
  // The JSX tag is the `Icon`-suffixed alias; it must still be caught.
  const out = runScan({
    "Cal.tsx": `import { ChevronLeftIcon } from "lucide-react";
export const Cal = () => <ChevronLeftIcon className="h-4 w-4" />;`,
  });
  assert.match(out, /Fixed-direction icons without an RTL flip/);
  assert.match(out, /ChevronLeftIcon/);
});

test("scan keeps rtl:/ltr: variants, centering and logical classes clean", () => {
  const out = runScan({
    "Good.tsx": `export const Good = () => (
  <div className="ps-4 text-start left-1/2 rtl:pl-4 ltr:text-right">ok</div>
);`,
  });
  assert.equal(out, "");
});

test("scan keeps a properly-flipped (vendored-style) directional icon clean", () => {
  // Mirrors how the vendored components/ui primitives stay clean: the icon
  // carries an explicit rtl flip, so it is not a hazard regardless of path.
  const out = runScan({
    "components/ui/pagination.tsx": `import { ChevronLeft, ChevronRight } from "lucide-react";
export const Prev = () => <ChevronLeft className="h-4 w-4 rtl:rotate-180" />;
export const Next = () => <ChevronRight className="rtl:rotate-180" />;
export const Toggle = () => <PanelLeftIcon className="rtl:-scale-x-100" />;`,
  });
  assert.equal(out, "");
});

test("scan flags physical classes inside cn()/cva() helper calls (not just JSX)", () => {
  const out = runScan({
    "variants.ts": `import { cva } from "class-variance-authority";
export const v = cva("base", { variants: { side: { x: "ml-2 right-0" } } });`,
  });
  assert.match(out, /Physical directional Tailwind classes/);
});

// --------------------------------------------------------------------------
// containsIsolate — recognises the Unicode isolate fix characters.
// --------------------------------------------------------------------------
test("containsIsolate detects FSI/PDI/LRI/RLI isolate characters", () => {
  assert.equal(containsIsolate("\u2068x\u2069"), true); // FSI…PDI (the fix)
  assert.equal(containsIsolate("\u2066x\u2069"), true); // LRI…PDI
  assert.equal(containsIsolate("\u2067x\u2069"), true); // RLI…PDI
  assert.equal(containsIsolate("4\u064a\u0648\u0645"), false); // plain "٤يوم"
  assert.equal(containsIsolate(""), false);
});

// --------------------------------------------------------------------------
// scanBidiScramble — the AST pass for un-isolated number+label runs.
// --------------------------------------------------------------------------
function runBidiScan(files) {
  const root = mkdtempSync(join(tmpdir(), "rtl-bidi-"));
  const srcDir = join(root, "src");
  mkdirSync(srcDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(srcDir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  const errors = [];
  try {
    scanBidiScramble({ rootDir: root, srcDir }, errors);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return errors.join("\n");
}

test("scanBidiScramble flags the ORIGINAL countdown scramble (regression)", () => {
  // The exact shape of the bug fixed in task #150: a formatNum alias glued
  // directly to a translated label in a template literal, with no isolate.
  const out = runBidiScan({
    "matchUtils.tsx": `import { formatNum } from "./fmt";
export function formatCountdown(cd, lang, labels) {
  const n = (v) => formatNum(v, lang);
  const parts = [];
  if (cd.days > 0) parts.push(\`\${n(cd.days)}\${labels.days}\`);
  parts.push(\`\${n(cd.minutes)}\${labels.minutes}\`);
  return parts.join(' ');
}`,
  });
  assert.match(out, /Un-isolated number\+label runs/);
  assert.match(out, /matchUtils\.tsx/);
});

test("scanBidiScramble passes the FIXED isolate-wrapped countdown", () => {
  // The current code: each number+label unit is wrapped in FSI…PDI, so the
  // glued ${value}${label} is protected from reordering.
  const out = runBidiScan({
    "matchUtils.tsx": `import { formatNum } from "./fmt";
export function formatCountdown(cd, lang, labels) {
  const n = (v) => formatNum(v, lang);
  const unit = (value, label) => \`\\u2068\${value}\${label}\\u2069\`;
  const parts = [];
  if (cd.days > 0) parts.push(unit(n(cd.days), labels.days));
  parts.push(unit(n(cd.minutes), labels.minutes));
  return parts.join(' ');
}`,
  });
  assert.equal(out, "");
});

test("scanBidiScramble flags a number glued to a t() label in a template", () => {
  const out = runBidiScan({
    "Bad.tsx": `import { formatNum } from "./fmt";
export const s = (n, t) => \`\${formatNum(n, lang)}\${t('match.days')}\`;`,
  });
  assert.match(out, /Un-isolated number\+label runs/);
});

test("scanBidiScramble allows whitespace-separated single number + label", () => {
  // "١٢ صحيحة" — a single number and single word with a space between reads
  // fine and is the allowlisted case.
  const out = runBidiScan({
    "Ok.tsx": `import { formatNum } from "./fmt";
export const s = (n, t) => \`\${formatNum(n, lang)} \${t('stats.correct')}\`;`,
  });
  assert.equal(out, "");
});

test("scanBidiScramble allows a pure scoreline (number/number)", () => {
  const out = runBidiScan({
    "Score.tsx": `import { formatNum } from "./fmt";
export const s = (a, b) => \`\${formatNum(a, lang)}/\${formatNum(b, lang)}\`;`,
  });
  assert.equal(out, "");
});

test("scanBidiScramble allows number + punctuation/text (no label expr)", () => {
  const out = runBidiScan({
    "Pct.tsx": `import { formatNum } from "./fmt";
export const a = (n) => \`\${formatNum(n, lang)}%\`;
export const b = (n) => \`+\${formatNum(n, lang)}\`;
export const c = (n) => \`#\${formatNum(n, lang)}\`;`,
  });
  assert.equal(out, "");
});

test("scanBidiScramble flags a `+` concatenation of number and label", () => {
  const out = runBidiScan({
    "Plus.tsx": `import { formatNum } from "./fmt";
export const s = (n, t) => formatNum(n, lang) + t('match.days');`,
  });
  assert.match(out, /Un-isolated number\+label runs/);
});

test("scanBidiScramble allows a `+` concatenation that includes an isolate", () => {
  const out = runBidiScan({
    "Plus.tsx": `import { formatNum } from "./fmt";
export const s = (n, t) => "\\u2068" + formatNum(n, lang) + t('match.days') + "\\u2069";`,
  });
  assert.equal(out, "");
});

test("scanBidiScramble flags a force-directioned JSX multi-unit run", () => {
  // A countdown built directly in a dir="ltr" element: two numbers + a label.
  const out = runBidiScan({
    "Cd.tsx": `import { formatNum } from "./fmt";
export const Cd = ({ d, h, t }) => (
  <span dir="ltr">{formatNum(d, lang)}{t('match.days')}{formatNum(h, lang)}{t('match.hours')}</span>
);`,
  });
  assert.match(out, /Un-isolated number\+label runs/);
});

test("scanBidiScramble flags a force-directioned JSX glued number+label pair", () => {
  const out = runBidiScan({
    "Cd.tsx": `import { formatNum } from "./fmt";
export const Cd = ({ d, t }) => (
  <span dir="ltr">{formatNum(d, lang)}{t('match.days')}</span>
);`,
  });
  assert.match(out, /Un-isolated number\+label runs/);
});

test("scanBidiScramble leaves a single number + label (whitespace) JSX clean", () => {
  // dir="ltr" with one number and one label separated by a space is the
  // allowlisted single-unit case (e.g. "{accuracy} {t('accuracy')}").
  const out = runBidiScan({
    "Ok.tsx": `import { formatNum } from "./fmt";
export const Ok = ({ n, t }) => (
  <span dir="ltr">{formatNum(n, lang)} {t('rankings.accuracy')}</span>
);`,
  });
  assert.equal(out, "");
});

test("scanBidiScramble ignores dynamic dir={dir} containers and number-only spans", () => {
  // dir={dir} is the language-driven container direction, not a forced run;
  // a number-only dir="ltr" span has no label and is fine.
  const out = runBidiScan({
    "Ok.tsx": `import { formatNum } from "./fmt";
export const A = ({ d, h, t, dir }) => (
  <div dir={dir}>{formatNum(d, lang)}{t('match.days')}{formatNum(h, lang)}{t('match.hours')}</div>
);
export const B = ({ n }) => <span dir="ltr">{formatNum(n, lang)}</span>;`,
  });
  assert.equal(out, "");
});
