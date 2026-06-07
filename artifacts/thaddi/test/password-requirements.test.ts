// Regression test for the live password requirement checkmarks on the sign-up
// page (components/auth/password-requirements.tsx).
//
// The feature rests on a fragile assumption: Clerk's prebuilt <SignUp> password
// value is captured by a delegated `input` listener that reads
// `input[name="password"]` inside a shared container ref. A future Clerk upgrade
// (or a careless edit to the rule thresholds / HIBP parsing) could silently
// break value capture or the per-rule feedback without anyone noticing.
//
// This renders the real <PasswordRequirements> component in jsdom against a
// password input it watches, types into that input, and asserts the three rules
// transition exactly as a user would see them:
//   1. length  >= 8 characters
//   2. strength via zxcvbn(value).score >= 2
//   3. not-breached via the HIBP k-anonymity range API
// The HIBP network call is stubbed with a real range-format body so the
// breach-line parsing is exercised faithfully without hitting the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

// --------------------------------------------------------------------------
// jsdom environment + globals the component / i18n provider read directly.
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

// jsdom doesn't implement scrollIntoView; the component scrolls its card into
// view whenever a submit-time rejection is shown. Stub it so that effect runs
// without throwing (which would otherwise tear down the React tree).
window.Element.prototype.scrollIntoView = function scrollIntoView() {};

// --------------------------------------------------------------------------
// Stubbed Have-I-Been-Pwned range endpoint. The component computes
// SHA-1(password) (uppercase hex), then GETs range/<prefix5> and checks whether
// any returned line's hash-suffix matches the rest of the digest. We register
// responses keyed by prefix so the real parsing path runs unchanged.
// --------------------------------------------------------------------------
const hibpByPrefix = new Map<string, string>();
const DECOY =
  "0000000000000000000000000000000000A:9\n0000000000000000000000000000000000B:5";

g.fetch = async (url: unknown) => {
  const match = String(url).match(/range\/([0-9A-Fa-f]{5})/);
  const prefix = match ? match[1].toUpperCase() : "";
  const body = hibpByPrefix.get(prefix) ?? DECOY;
  return { ok: true, text: async () => body } as unknown as Response;
};

function sha1Upper(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex").toUpperCase();
}
function registerBreached(password: string): void {
  const hash = sha1Upper(password);
  hibpByPrefix.set(hash.slice(0, 5), `${hash.slice(5)}:42\n${DECOY}`);
}
function registerSafe(password: string): void {
  const hash = sha1Upper(password);
  hibpByPrefix.set(hash.slice(0, 5), DECOY);
}

// --------------------------------------------------------------------------
// Small async helpers (real timers — the component debounces 200ms strength /
// 500ms breach, so we poll rather than fake timers).
// --------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  fn: () => void,
  { timeout = 5000, interval = 40 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  for (;;) {
    // Yield *before* reading the DOM so any pending React render and the
    // component's MutationObserver microtasks settle on a clean macrotask turn.
    // Polling synchronously immediately after dispatching an input event can
    // wedge the jsdom event loop (React's scheduler plus the component's
    // self-observing MutationObserver starve the timer), so we always await
    // first and only then assert.
    await sleep(interval);
    try {
      fn();
      return;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() - start > timeout) throw lastError;
  }
}

test("live password checkmarks reflect the three sign-up rules", async () => {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { I18nProvider } = await import("../src/lib/i18n.tsx");
  const { PasswordRequirements } = await import(
    "../src/components/auth/password-requirements.tsx"
  );

  // Mirror SignUpPage: the password input(s) live inside the same div whose ref
  // is handed to <PasswordRequirements>. We also include a confirm-password
  // field to prove the listener keys off name="password", not just any input.
  function Harness() {
    const ref = React.useRef<HTMLDivElement>(null);
    return React.createElement(
      I18nProvider,
      null,
      React.createElement(
        "div",
        { ref },
        React.createElement("input", { name: "password", type: "password" }),
        React.createElement("input", {
          name: "confirmPassword",
          type: "password",
        }),
        React.createElement(PasswordRequirements, { containerRef: ref }),
      ),
    );
  }

  const mount = window.document.createElement("div");
  window.document.body.appendChild(mount);
  const root = createRoot(mount);
  root.render(React.createElement(Harness));
  await sleep(80); // let effects attach the delegated input listener

  const pwInput = mount.querySelector<HTMLInputElement>(
    'input[name="password"]',
  );
  const confirmInput = mount.querySelector<HTMLInputElement>(
    'input[name="confirmPassword"]',
  );
  assert.ok(pwInput, "password input should render");
  assert.ok(confirmInput, "confirm-password input should render");

  // The requirement rows render in order: [length, strength, not-breached].
  const rows = () => Array.from(mount.querySelectorAll("ul li"));
  function ruleState(index: number): "met" | "fail" | "checking" | "unmet" {
    const li = rows()[index];
    assert.ok(li, `rule row ${index} should exist`);
    const svg = li.querySelector("svg");
    if (!svg) return "unmet"; // idle bullet / pending
    const cls = svg.getAttribute("class") ?? "";
    if (cls.includes("text-primary")) return "met";
    if (cls.includes("text-destructive")) return "fail";
    if (cls.includes("animate-spin")) return "checking";
    return "unmet";
  }

  async function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await sleep(0);
  }

  assert.equal(rows().length, 3, "three requirement rows are shown");

  // Phase 1: a short password leaves the 8+ rule unmet.
  await typeInto(pwInput, "short");
  await waitFor(() => {
    assert.notEqual(ruleState(0), "met", "length rule must be unmet for 5 chars");
  });

  // Phase 2: a known breached password (length OK, weak, leaked) -> the breach
  // rule fails while length is met and strength stays unmet.
  registerBreached("password123");
  await typeInto(pwInput, "password123");
  await waitFor(() => {
    assert.equal(ruleState(0), "met", "length rule met at 11 chars");
  });
  await waitFor(
    () => {
      assert.equal(ruleState(2), "fail", "breach rule fails for a leaked password");
    },
    { timeout: 6000 },
  );
  assert.notEqual(ruleState(1), "met", "weak password must not satisfy strength");

  // Phase 3: a strong, unique password satisfies all three rules.
  const strong = "9xK#mq2!vLpZ7wQ";
  registerSafe(strong);
  await typeInto(pwInput, strong);
  await waitFor(
    () => {
      assert.equal(ruleState(0), "met", "length rule met");
      assert.equal(ruleState(1), "met", "strength rule met");
      assert.equal(ruleState(2), "met", "not-breached rule met");
    },
    { timeout: 6000 },
  );

  // Phase 4: typing into the confirm field (name !== "password") must NOT alter
  // the rules — guarding the fragile name-based capture.
  await typeInto(confirmInput, "x");
  await sleep(800);
  assert.equal(ruleState(0), "met", "confirm field must not reset length rule");
  assert.equal(ruleState(1), "met", "confirm field must not reset strength rule");
  assert.equal(ruleState(2), "met", "confirm field must not reset breach rule");

  root.unmount();
  mount.remove();
});

// ===========================================================================
// Submit-time rejection mapping (classifyPasswordError / detectPasswordError /
// MutationObserver wiring in password-requirements.tsx).
//
// When Clerk's prebuilt <SignUp> rejects a password at submit time, it renders
// an error element (carrying a `data-localization-key` such as
// `unstable__errors.form_password_pwned`). A MutationObserver inside
// <PasswordRequirements> scans the shared container for those elements and maps
// each error back onto the matching localized requirement row — or shows a
// generic banner for anything it can't classify. This wiring is DOM/markup
// driven and would silently break if Clerk changed its error markup or keys, so
// we simulate each error type and assert the right feedback appears in both
// Arabic and English, and that it clears once the user edits the password.
// ===========================================================================

// Localized copy mirrored from src/lib/i18n.tsx (auth.passwordHint.rejected*).
// Hardcoding the expected strings makes the test double as a guard that those
// keys keep resolving to the intended message in each language.
const REJECTED_MESSAGES = {
  ar: {
    length: "كلمة المرور قصيرة جدًا. استخدم ٨ أحرف على الأقل.",
    strength: "كلمة المرور سهلة التخمين. اختر كلمة أقوى.",
    breach: "ظهرت كلمة المرور هذه في تسريب بيانات معروف. اختر كلمة مختلفة.",
    generic: "تعذّر قبول كلمة المرور. يرجى تجربة كلمة أخرى.",
  },
  en: {
    length: "This password is too short. Use at least 8 characters.",
    strength: "This password is too easy to guess. Choose a stronger one.",
    breach: "This password appeared in a known data breach. Choose a different one.",
    generic: "This password can't be used. Please try another.",
  },
} as const;

// Clerk's submit-time error localization keys and the requirement row index each
// should highlight ([length, strength, not-breached]).
const ERROR_KEY = {
  length: "unstable__errors.form_password_length_too_short",
  strength: "unstable__errors.form_password_not_strong_enough",
  breach: "unstable__errors.form_password_pwned",
} as const;
const ROW_INDEX = { length: 0, strength: 1, breach: 2 } as const;
// A form_password_* key with no specific rule mapping -> generic banner.
const UNMAPPED_KEY = "unstable__errors.form_password_validation_failed";

async function renderRequirements(lang: "ar" | "en") {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { I18nProvider } = await import("../src/lib/i18n.tsx");
  const { PasswordRequirements } = await import(
    "../src/components/auth/password-requirements.tsx"
  );

  // I18nProvider seeds its language from localStorage on first render, so set it
  // before mounting and render a fresh tree per language.
  window.localStorage.setItem("thaddi_lang", lang);

  function Harness() {
    const ref = React.useRef<HTMLDivElement>(null);
    return React.createElement(
      I18nProvider,
      null,
      React.createElement(
        "div",
        { ref },
        React.createElement("input", { name: "password", type: "password" }),
        React.createElement(PasswordRequirements, { containerRef: ref }),
      ),
    );
  }

  const mount = window.document.createElement("div");
  window.document.body.appendChild(mount);
  const root = createRoot(mount);
  root.render(React.createElement(Harness));
  await sleep(80); // let the MutationObserver + input listener attach

  const pwInput = mount.querySelector<HTMLInputElement>(
    'input[name="password"]',
  );
  assert.ok(pwInput, "password input should render");
  const container = pwInput.parentElement as HTMLElement;
  assert.ok(container, "watched container should exist");
  return { root, mount, pwInput, container };
}

// Simulate Clerk inserting a submit-time error element inside the watched
// container (both the class and the data-localization-key are how the real
// markup is recognized by detectPasswordError).
function emitClerkPasswordError(
  container: HTMLElement,
  key: string,
  text: string,
): HTMLElement {
  const el = window.document.createElement("p");
  el.setAttribute("data-localization-key", key);
  el.className = "cl-formFieldErrorText cl-formFieldErrorText__password";
  el.textContent = text;
  container.appendChild(el);
  return el;
}

function ruleRows(mount: HTMLElement): HTMLElement[] {
  return Array.from(mount.querySelectorAll<HTMLElement>("ul li"));
}
function rowIsHighlighted(li: HTMLElement): boolean {
  return (li.getAttribute("class") ?? "").includes("ring-destructive");
}
function rowMessage(li: HTMLElement): string {
  return li.querySelector("p")?.textContent ?? "";
}
function genericBanner(mount: HTMLElement): HTMLElement | null {
  return mount.querySelector<HTMLElement>('[role="alert"]');
}

// Dispatch a real input event on the password field — the component's delegated
// listener treats this as "the user edited the password" and must clear any
// submit-time highlight.
function editPassword(
  pwInput: HTMLInputElement,
  value: string,
): void {
  pwInput.value = value;
  pwInput.dispatchEvent(new window.Event("input", { bubbles: true }));
}

for (const lang of ["ar", "en"] as const) {
  test(`submit-time rejections highlight the matching rule (${lang})`, { timeout: 30000 }, async () => {
    const { root, mount, pwInput, container } = await renderRequirements(lang);
    const expected = REJECTED_MESSAGES[lang];

    for (const kind of ["length", "strength", "breach"] as const) {
      const index = ROW_INDEX[kind];
      const el = emitClerkPasswordError(
        container,
        ERROR_KEY[kind],
        `simulated ${kind} rejection`,
      );

      // The matching row is highlighted with the localized rejection message...
      await waitFor(() => {
        const rows = ruleRows(mount);
        assert.equal(rows.length, 3, "three requirement rows are shown");
        assert.ok(
          rowIsHighlighted(rows[index]),
          `${kind} row should be highlighted (${lang})`,
        );
        assert.equal(
          rowMessage(rows[index]),
          expected[kind],
          `${kind} row shows its localized rejection message (${lang})`,
        );
      });

      // ...and no other row is highlighted, and the generic banner is absent.
      const rows = ruleRows(mount);
      for (let i = 0; i < rows.length; i++) {
        if (i === index) continue;
        assert.ok(
          !rowIsHighlighted(rows[i]),
          `only the ${kind} row should be highlighted (${lang})`,
        );
      }
      assert.equal(
        genericBanner(mount),
        null,
        `no generic banner for a classified ${kind} error (${lang})`,
      );

      // Editing the password again clears the highlight: the delegated input
      // listener resets the flag, and Clerk (as it does on a fresh edit) drops
      // its error node so the observer doesn't immediately re-detect it. We edit
      // the value back to empty, which both fires the input event (clearing the
      // flag) and returns the field to idle for the next error type without
      // kicking off the strength/breach debounce timers.
      editPassword(pwInput, "");
      el.remove();
      await waitFor(() => {
        assert.ok(
          !rowIsHighlighted(ruleRows(mount)[index]),
          `editing the password clears the ${kind} highlight (${lang})`,
        );
      });
    }

    // An unmapped (but still password-related) error shows the generic banner
    // and leaves every individual rule row un-highlighted.
    const unmapped = emitClerkPasswordError(
      container,
      UNMAPPED_KEY,
      "something else went wrong with the password",
    );
    await waitFor(() => {
      const banner = genericBanner(mount);
      assert.ok(banner, `unmapped error shows the generic banner (${lang})`);
      assert.equal(
        banner!.textContent,
        expected.generic,
        `generic banner shows the localized fallback message (${lang})`,
      );
    });
    for (const li of ruleRows(mount)) {
      assert.ok(
        !rowIsHighlighted(li),
        `unmapped error highlights no specific rule (${lang})`,
      );
    }

    // Editing the password clears the generic banner too.
    editPassword(pwInput, "");
    unmapped.remove();
    await waitFor(() => {
      assert.equal(
        genericBanner(mount),
        null,
        `editing the password clears the generic banner (${lang})`,
      );
    });

    root.unmount();
    mount.remove();
  });
}
