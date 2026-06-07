// Render-based regression test for the auth pages' shared nav bar
// (components/public-header.tsx).
//
// The static companion test (auth-nav-bar.test.mjs) locks down the markup wiring
// of the sign-in / sign-up pages. This test exercises the *interactive* controls
// the way a user does: it renders the real <PublicHeader> in jsdom (inside the
// real ThemeProvider + I18nProvider) and:
//   1. confirms the logo links home to "/",
//   2. confirms the theme toggle is present and clicking it flips the theme,
//   3. confirms the language toggle is present and clicking it flips ar<->en
//      (label, document lang, and document direction all switch).

import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --------------------------------------------------------------------------
// jsdom environment + globals the components / providers read directly.
// --------------------------------------------------------------------------
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const { window } = dom;

const g = globalThis as Record<string, unknown>;
g.window = window;
g.document = window.document;
g.localStorage = window.localStorage;
try {
  g.navigator = window.navigator;
} catch {
  // Node >=21 exposes a read-only global navigator; its userAgent is enough.
}
for (const key of [
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "Text",
  "DocumentFragment",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
]) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value && g[key] === undefined) g[key] = value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  fn: () => void,
  { timeout = 4000, interval = 30 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  for (;;) {
    try {
      fn();
      return;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() - start > timeout) throw lastError;
    await sleep(interval);
  }
}

test("auth nav bar: logo links home and the theme + language toggles are wired", async () => {
  // Start from a clean, default state: no saved language (defaults to Arabic)
  // and no saved theme (defaults to dark).
  window.localStorage.clear();

  const React = (await import("react")).default;
  // The auth-page components are authored for the automatic JSX runtime (no
  // `import React`); under the lightweight node test runner they compile with
  // the classic runtime instead, which references a global `React`. Expose it
  // so the real components render exactly as shipped.
  g.React = React;
  const { createRoot } = await import("react-dom/client");
  const { Router } = await import("wouter");
  const { memoryLocation } = await import("wouter/memory-location");
  const { I18nProvider } = await import("../src/lib/i18n.tsx");
  const { ThemeProvider } = await import("../src/lib/theme.tsx");
  const { PublicHeader } = await import("../src/components/public-header.tsx");

  // Drive wouter from an in-memory location so the nav links resolve without
  // touching the browser-only globals the default hook expects.
  const { hook } = memoryLocation({ path: "/" });

  function Harness() {
    return React.createElement(
      ThemeProvider,
      null,
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          Router,
          { hook },
          React.createElement(PublicHeader),
        ),
      ),
    );
  }

  const mount = window.document.createElement("div");
  window.document.body.appendChild(mount);
  const root = createRoot(mount);
  root.render(React.createElement(Harness));
  await sleep(80); // let effects run (theme class + lang/dir attributes)

  const byTestId = (id: string) =>
    mount.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  // ---- Logo links home to "/" -------------------------------------------
  const logo = byTestId("link-logo");
  assert.ok(logo, "the logo link should render");
  assert.equal(logo.tagName, "A", "the logo should be an anchor");
  assert.equal(
    logo.getAttribute("href"),
    "/",
    "the logo must link home to /",
  );

  // ---- Theme toggle present and wired -----------------------------------
  const themeBtn = byTestId("button-theme-toggle-nav");
  assert.ok(themeBtn, "the theme toggle should render");
  // Default theme is dark -> <html> carries the `dark` class.
  await waitFor(() =>
    assert.ok(
      window.document.documentElement.classList.contains("dark"),
      "theme should start dark",
    ),
  );
  themeBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() =>
    assert.ok(
      !window.document.documentElement.classList.contains("dark"),
      "clicking the theme toggle should switch to light",
    ),
  );
  // Toggle back to dark to prove it is a real flip, not a one-way set.
  themeBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() =>
    assert.ok(
      window.document.documentElement.classList.contains("dark"),
      "clicking the theme toggle again should switch back to dark",
    ),
  );

  // ---- Language toggle present and flips ar<->en ------------------------
  const langBtn = byTestId("button-lang-toggle");
  assert.ok(langBtn, "the language toggle should render");
  // Default language is Arabic; the button offers to switch to English.
  await waitFor(() => {
    assert.equal(window.document.documentElement.lang, "ar", "lang starts as ar");
    assert.equal(window.document.documentElement.dir, "rtl", "dir starts as rtl");
    assert.match(
      langBtn.textContent ?? "",
      /English/,
      "in Arabic, the toggle offers English",
    );
  });

  langBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() => {
    assert.equal(
      window.document.documentElement.lang,
      "en",
      "clicking the toggle switches the document language to en",
    );
    assert.equal(
      window.document.documentElement.dir,
      "ltr",
      "switching to English makes the document left-to-right",
    );
    assert.match(
      langBtn.textContent ?? "",
      /العربية/,
      "in English, the toggle offers Arabic",
    );
  });

  // Click again to confirm it flips back to Arabic.
  langBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() => {
    assert.equal(
      window.document.documentElement.lang,
      "ar",
      "clicking the toggle again switches back to Arabic",
    );
    assert.match(
      langBtn.textContent ?? "",
      /English/,
      "back in Arabic, the toggle again offers English",
    );
  });

  root.unmount();
});
