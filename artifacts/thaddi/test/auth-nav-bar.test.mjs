import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// --------------------------------------------------------------------------
// Auth pages' shared nav bar (PublicHeader) wiring guardrail.
//
// The sign-in and sign-up pages render a shared <PublicHeader> with a logo link
// back to "/", a theme toggle, a language switch, and a cross-link between the
// two auth pages. None of this navigation is covered elsewhere, so a stray edit
// could quietly re-point the logo, drop the theme/language controls, or swap the
// sign-in <-> sign-up cross-link without anyone noticing.
//
// These tests statically read the real source (via the TypeScript AST) so the
// guarantees hold against the actual rendered markup. Cross-links are anchored
// to their i18n *key* (meaning) and resolved against both the Arabic AND English
// dictionaries, so the check survives translation. The interactive language flip
// is exercised behaviourally by the companion render test (auth-nav-bar.test.ts).
// --------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "src");
const COMPONENTS = join(SRC, "components");

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

// Read a JSX attribute's string value (handles both `x="y"` and `x={"y"}`).
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

// Get the JSX opening element for any JSX element / self-closing node.
function openingOf(node) {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

// Find the first function/const-arrow declaration with the given name and run
// `visitor(node)` over its whole subtree.
function findComponent(sf, name) {
  let found = null;
  function visit(node) {
    if (
      (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) ||
      (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name)
    ) {
      found = node;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

// Collect every JSX element/self-closing element of a given tag name inside a
// subtree, returning {opening, node} for each.
function elementsNamed(root, tagName) {
  const out = [];
  function visit(node) {
    const opening = openingOf(node);
    if (opening && opening.tagName.getText() === tagName) {
      out.push({ opening, node });
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return out;
}

// --------------------------------------------------------------------------
// The shared <PublicHeader> itself: logo link home, theme toggle, language
// toggle, and the ar<->en flip logic.
// --------------------------------------------------------------------------
test("PublicHeader renders the logo as a link home to /", () => {
  const sf = parse(join(COMPONENTS, "public-header.tsx"));
  const links = elementsNamed(sf, "Link");

  const logo = links.find(
    ({ opening }) => jsxAttr(opening, "data-testid") === "link-logo",
  );
  assert.ok(logo, "PublicHeader should render a logo <Link> with testid link-logo");
  assert.equal(
    jsxAttr(logo.opening, "href"),
    "/",
    "the logo link must navigate home to /",
  );
});

test("PublicHeader renders the theme toggle and the language switch", () => {
  const sf = parse(join(COMPONENTS, "public-header.tsx"));

  const themeToggles = elementsNamed(sf, "ThemeToggle");
  assert.equal(themeToggles.length, 1, "exactly one ThemeToggle should be rendered");
  assert.equal(
    jsxAttr(themeToggles[0].opening, "testId"),
    "button-theme-toggle-nav",
    "the nav theme toggle should carry its own testId",
  );

  // The language switch is a Button identified by its testid; it must be wired
  // to an onClick handler.
  const buttons = elementsNamed(sf, "Button");
  const langBtn = buttons.find(
    ({ opening }) => jsxAttr(opening, "data-testid") === "button-lang-toggle",
  );
  assert.ok(langBtn, "PublicHeader should render a language toggle Button");

  const hasOnClick = langBtn.opening.attributes.properties.some(
    (a) => ts.isJsxAttribute(a) && a.name.getText() === "onClick",
  );
  assert.ok(hasOnClick, "the language toggle must be wired to an onClick handler");
});

test("PublicHeader's language toggle flips ar<->en", () => {
  const sf = parse(join(COMPONENTS, "public-header.tsx"));

  // Locate the toggleLanguage handler and assert it calls setLang with a
  // conditional that swaps 'ar' and 'en' (in either order).
  let handlerText = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "toggleLanguage" &&
      node.initializer
    ) {
      handlerText = node.initializer.getText();
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  assert.ok(handlerText, "PublicHeader should define a toggleLanguage handler");
  assert.match(handlerText, /setLang\(/, "toggleLanguage must call setLang");
  assert.match(
    handlerText,
    /'ar'/,
    "toggleLanguage must reference the Arabic locale",
  );
  assert.match(
    handlerText,
    /'en'/,
    "toggleLanguage must reference the English locale",
  );
  // It must compare against one locale and switch to the other — i.e. a flip,
  // not a hard-coded set to a single language.
  assert.match(
    handlerText,
    /===\s*'ar'\s*\?\s*'en'\s*:\s*'ar'/,
    "toggleLanguage must flip ar<->en",
  );
});

// --------------------------------------------------------------------------
// Sign-in page: nav bar with logo home + cross-link to /sign-up.
// --------------------------------------------------------------------------
test("sign-in page renders the nav bar and cross-links to /sign-up", () => {
  const sf = parse(join(SRC, "App.tsx"));
  const page = findComponent(sf, "SignInPage");
  assert.ok(page, "App.tsx should define a SignInPage component");

  // The page renders the shared nav bar.
  assert.equal(
    elementsNamed(page, "PublicHeader").length,
    1,
    "SignInPage should render the shared <PublicHeader>",
  );

  // Cross-link to the sign-up page, anchored to its i18n key (auth.signUp).
  const crossLink = elementsNamed(page, "Link").find(
    ({ opening }) => jsxAttr(opening, "data-testid") === "link-go-signup",
  );
  assert.ok(crossLink, "SignInPage should render a cross-link to sign-up");
  assert.equal(
    jsxAttr(crossLink.opening, "href"),
    "/sign-up",
    "the sign-in page cross-link must point to /sign-up",
  );
  assert.ok(
    tKeysIn(crossLink.node).includes("auth.signUp"),
    "the cross-link label must use the auth.signUp translation",
  );
  assertTranslated("auth.signUp");
  assertTranslated("auth.noAccount");
});

// --------------------------------------------------------------------------
// Sign-up page: nav bar with cross-link to /sign-in.
// --------------------------------------------------------------------------
test("sign-up page renders the nav bar and cross-links to /sign-in", () => {
  const sf = parse(join(SRC, "App.tsx"));
  const page = findComponent(sf, "SignUpPage");
  assert.ok(page, "App.tsx should define a SignUpPage component");

  assert.equal(
    elementsNamed(page, "PublicHeader").length,
    1,
    "SignUpPage should render the shared <PublicHeader>",
  );

  const crossLink = elementsNamed(page, "Link").find(
    ({ opening }) => jsxAttr(opening, "data-testid") === "link-go-signin",
  );
  assert.ok(crossLink, "SignUpPage should render a cross-link to sign-in");
  assert.equal(
    jsxAttr(crossLink.opening, "href"),
    "/sign-in",
    "the sign-up page cross-link must point to /sign-in",
  );
  assert.ok(
    tKeysIn(crossLink.node).includes("auth.signIn"),
    "the cross-link label must use the auth.signIn translation",
  );
  assertTranslated("auth.signIn");
  assertTranslated("auth.haveAccount");
});
