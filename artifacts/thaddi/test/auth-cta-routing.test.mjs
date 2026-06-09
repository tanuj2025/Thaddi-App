import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// --------------------------------------------------------------------------
// Auth call-to-action routing guardrail.
//
// The product rule: generic "create / start a challenge" CTAs send signed-out
// visitors to the *sign-in* page, while only controls that explicitly say
// "sign up" (the join page's primary button) go to the *sign-up* page.
//
// A stray edit could quietly re-point a CTA at the wrong page and nobody would
// notice. These tests lock the rule down by statically reading the actual page
// source (via the TypeScript AST) and pairing every CTA with the route it
// navigates to. Crucially the CTAs are identified by their i18n *key* — i.e.
// their meaning — and each key is resolved against the real Arabic AND English
// dictionaries, so the guarantee holds by label meaning, not by an English
// string literal that would silently stop matching once translated.
// --------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "src");
const PAGES = join(SRC, "pages");

function parse(file) {
  const text = readFileSync(file, "utf8");
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

function propKey(prop) {
  return ts.isStringLiteralLike(prop.name) ? prop.name.text : prop.name.getText();
}

// Read the ar/en translation blocks straight out of src/lib/i18n.tsx so the
// tests resolve the exact strings shown to users in each language.
function extractDict() {
  const sf = parse(join(SRC, "lib", "i18n.tsx"));
  const dict = { ar: {}, en: {} };

  function readBlock(objLiteral) {
    const out = {};
    for (const prop of objLiteral.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isStringLiteralLike(prop.initializer)) {
        out[propKey(prop)] = prop.initializer.text;
      }
    }
    return out;
  }

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === "translations" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
          const lang = propKey(prop);
          if (lang === "ar" || lang === "en") dict[lang] = readBlock(prop.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return dict;
}

// All `t('some.key')` keys found anywhere inside a node's subtree.
function tKeysIn(node) {
  const keys = [];
  function walk(n) {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "t" &&
      n.arguments.length &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      keys.push(n.arguments[0].text);
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return keys;
}

// The single `t('key')` directly wrapped by a node (no deeper search).
function directTKey(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "t" &&
    node.arguments.length &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0].text;
  }
  return null;
}

function jsxAttr(openingElement, name) {
  for (const a of openingElement.attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText() === name && a.initializer) {
      if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
      if (
        ts.isJsxExpression(a.initializer) &&
        a.initializer.expression &&
        ts.isStringLiteralLike(a.initializer.expression)
      ) {
        return a.initializer.expression.text;
      }
    }
  }
  return undefined;
}

// Map each i18n label key to the set of wouter <Link href="..."> destinations
// it is rendered inside. A correctly-wired CTA resolves to exactly one route.
function linkLabelMap(sf) {
  const map = new Map();
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "Link") {
      const href = jsxAttr(node.openingElement, "href");
      for (const key of tKeysIn(node)) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(href);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return map;
}

// Every string passed to setLocation('...') anywhere in the file.
function setLocationTargets(sf) {
  const targets = [];
  function walk(n) {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "setLocation" &&
      n.arguments.length
    ) {
      const arg = n.arguments[0];
      if (ts.isStringLiteralLike(arg)) {
        targets.push(arg.text.split("?")[0]);
      } else if (ts.isBinaryExpression(arg) && ts.isStringLiteralLike(arg.left)) {
        targets.push(arg.left.text.split("?")[0]);
      } else if (ts.isTemplateExpression(arg)) {
        targets.push(arg.head.text.split("?")[0]);
      }
    }
    ts.forEachChild(n, walk);
  }
  walk(sf);
  return targets;
}

const dict = extractDict();

function assertTranslated(key) {
  for (const lang of ["ar", "en"]) {
    const label = dict[lang][key];
    assert.ok(
      typeof label === "string" && label.trim().length > 0,
      `expected a non-empty ${lang} translation for "${key}"`,
    );
  }
}

// Assert a CTA (identified by its i18n key) links only to `expectedHref`, and
// report the failure using the human-readable label in both languages so the
// check is anchored to meaning rather than an English string literal.
function assertCtaRoute(links, key, expectedHref) {
  assertTranslated(key);
  const hrefs = links.get(key);
  assert.ok(
    hrefs,
    `CTA "${key}" (ar: "${dict.ar[key]}", en: "${dict.en[key]}") was not found inside any <Link>`,
  );
  assert.deepEqual(
    [...hrefs].sort(),
    [expectedHref],
    `CTA "${key}" (ar: "${dict.ar[key]}", en: "${dict.en[key]}") must link only to ${expectedHref}, but found: ${[...hrefs].join(", ")}`,
  );
}

// --------------------------------------------------------------------------
// Landing page — generic create CTAs go to /sign-in
// --------------------------------------------------------------------------
test("landing page create CTAs (hero, navbar, countdown, sticky footer) link to /sign-in", () => {
  const links = linkLabelMap(parse(join(PAGES, "landing.tsx")));

  // hero CtaButtons + sticky mobile footer both render landing.hero.ctaCreate
  assertCtaRoute(links, "landing.hero.ctaCreate", "/sign-in");
  // navbar "create free" button (desktop + mobile label variants)
  assertCtaRoute(links, "landing.nav.createFree", "/sign-in");
  assertCtaRoute(links, "challenges.create", "/sign-in");
  // World Cup countdown CTA
  assertCtaRoute(links, "landing.countdown.cta", "/sign-in");
});

// --------------------------------------------------------------------------
// Landing page — the generic "Join a challenge" CTA opens the public
// challenges discover page, NOT an auth page. This is the complement of the
// create-CTA rule above: browsing challenges must never get re-pointed at
// /sign-in or /sign-up by a stray edit.
// --------------------------------------------------------------------------
test("landing page 'Join a challenge' CTA links to /challenges", () => {
  const links = linkLabelMap(parse(join(PAGES, "landing.tsx")));

  // hero CtaButtons renders landing.hero.ctaJoin; it must open the public
  // discover page in both Arabic and English (anchored to the i18n key).
  assertCtaRoute(links, "landing.hero.ctaJoin", "/challenges");
});

// --------------------------------------------------------------------------
// Schedule page — its CTAs go to /sign-in
// --------------------------------------------------------------------------
test("schedule page CTAs link to /sign-in", () => {
  const links = linkLabelMap(parse(join(PAGES, "schedule.tsx")));

  // empty-state CTA + bottom CTA both render schedule.cta
  assertCtaRoute(links, "schedule.cta", "/sign-in");
  // navbar "create free" button
  assertCtaRoute(links, "landing.nav.createFree", "/sign-in");
});

// --------------------------------------------------------------------------
// Join page — the "Sign up to join" control still goes to /sign-up
// --------------------------------------------------------------------------
test("join page 'Sign up to join' control routes signed-out visitors to /sign-up", () => {
  const sf = parse(join(PAGES, "join.tsx"));

  // The signed-out label is the "sign up to join" copy, translated in both langs.
  assertTranslated("join.signUpToJoin");

  // Find the ternary that picks the primary button label and confirm its
  // signed-out branch shows join.signUpToJoin; capture the controlling
  // condition (e.g. "!isSignedIn").
  let signedOutCondition = null;
  function findLabelTernary(node) {
    if (ts.isConditionalExpression(node) && directTKey(node.whenTrue) === "join.signUpToJoin") {
      signedOutCondition = node.condition.getText();
    }
    ts.forEachChild(node, findLabelTernary);
  }
  findLabelTernary(sf);
  assert.ok(
    signedOutCondition,
    "could not find the label branch that renders t('join.signUpToJoin')",
  );

  // Under that same condition, the handler must navigate to /sign-up.
  let signedOutDestination = null;
  function findGuardBranch(node) {
    if (ts.isIfStatement(node) && node.expression.getText() === signedOutCondition) {
      const dests = [];
      const collect = (n) => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === "setLocation" &&
          n.arguments.length
        ) {
          const arg = n.arguments[0];
          if (ts.isStringLiteralLike(arg)) {
            dests.push(arg.text.split("?")[0]);
          } else if (ts.isBinaryExpression(arg) && ts.isStringLiteralLike(arg.left)) {
            dests.push(arg.left.text.split("?")[0]);
          } else if (ts.isTemplateExpression(arg)) {
            dests.push(arg.head.text.split("?")[0]);
          }
        }
        ts.forEachChild(n, collect);
      };
      collect(node.thenStatement);
      if (dests.length) signedOutDestination = dests[0];
    }
    ts.forEachChild(node, findGuardBranch);
  }
  findGuardBranch(sf);

  assert.equal(
    signedOutDestination,
    "/sign-up",
    `the "${signedOutCondition}" branch (label ar: "${dict.ar["join.signUpToJoin"]}", en: "${dict.en["join.signUpToJoin"]}") must route to /sign-up`,
  );

  // And the join flow must never divert a signed-out visitor to /sign-in.
  assert.ok(
    !setLocationTargets(sf).includes("/sign-in"),
    "join page should not navigate to /sign-in",
  );
});
