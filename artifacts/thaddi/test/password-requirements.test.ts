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
});
