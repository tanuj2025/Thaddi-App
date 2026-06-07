// Regression tests for the self-service account-change dialogs
// (components/account/change-email-dialog.tsx, change-password-dialog.tsx).
//
// These flows live in our own custom UI (not Clerk's hosted screens) and drive
// the Clerk client SDK directly, so they carry branching logic that is easy to
// regress:
//   - email: invalid address / same-as-current rejection, the two-step
//     send-code -> verify-code happy path (primary swapped + stale addresses
//     destroyed), and the invalid/abandoned-code path (current email unchanged).
//   - password: too-short and mismatch rejections, correct vs. incorrect current
//     password, and the social-login "set password" branch (no current password
//     sent because user.passwordEnabled is false).
//
// The real components are rendered in jsdom. The Clerk `useUser` hook and the
// `useToast` hook are module-mocked so we can supply spies and capture the
// toast feedback the user would see. Run with:
//   tsx --test --experimental-test-module-mocks test/account-dialogs.test.ts

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --------------------------------------------------------------------------
// jsdom environment + globals (mirrors password-requirements.test.ts).
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
// Deterministic English copy for assertions.
window.localStorage.setItem("thaddi_lang", "en");
try {
  g.navigator = window.navigator;
} catch {
  // Node >=21 exposes a read-only global navigator; its userAgent is enough.
}
// NOTE: Node 24 pre-defines global Event/CustomEvent/etc., but Radix's
// DismissableLayer/FocusScope build events from these globals and dispatch them
// on jsdom elements, which reject anything that isn't a jsdom Event instance.
// So these MUST be overwritten with jsdom's constructors, not assigned only when
// missing.
for (const key of [
  "HTMLElement",
  "Element",
  "Node",
  "NodeFilter",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "InputEvent",
  "Text",
  "DocumentFragment",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
  "DOMRect",
]) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value === undefined) continue;
  try {
    g[key] = value;
  } catch {
    // Some globals are read-only in newer Node; jsdom's own copy is good enough.
  }
}

// Radix focus-scope references element constructors directly (HTMLInputElement,
// etc.). Copy every jsdom HTML*/SVG* element constructor onto the global so those
// `instanceof` / tag checks resolve.
for (const key of Object.getOwnPropertyNames(window)) {
  if (!/^(HTML|SVG)\w*Element$/.test(key)) continue;
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value === undefined || g[key] !== undefined) continue;
  try {
    g[key] = value;
  } catch {
    // read-only global; ignore.
  }
}

// Radix UI / focus management shims that jsdom lacks.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.scrollIntoView = proto.scrollIntoView ?? (() => {});
proto.hasPointerCapture = proto.hasPointerCapture ?? (() => false);
proto.setPointerCapture = proto.setPointerCapture ?? (() => {});
proto.releasePointerCapture = proto.releasePointerCapture ?? (() => {});
if (!window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
g.matchMedia = window.matchMedia;
if (typeof (g as Record<string, unknown>).ResizeObserver === "undefined") {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (g as Record<string, unknown>).ResizeObserver = ResizeObserver;
  (window as unknown as Record<string, unknown>).ResizeObserver = ResizeObserver;
}

// input-otp starts a 1s setInterval (password-manager badge detection) while the
// OTP field is mounted. Unref it so the test process can exit cleanly even if a
// failing assertion short-circuits a test before it unmounts the dialog.
const origSetInterval = globalThis.setInterval.bind(globalThis);
(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((
  ...args: Parameters<typeof setInterval>
) => {
  const handle = origSetInterval(...args);
  (handle as { unref?: () => void })?.unref?.();
  return handle;
}) as typeof setInterval;

// --------------------------------------------------------------------------
// Mocked hooks. The dialogs call useUser() / useToast() on every render, so
// the mocks read live module-level refs we mutate per test.
// --------------------------------------------------------------------------
let mockUser: any = null;
const toasts: Array<{ title?: string; description?: string; variant?: string }> = [];

mock.module("@clerk/react", {
  namedExports: {
    useUser: () => ({ isLoaded: true, isSignedIn: true, user: mockUser }),
    // The dialogs now wrap their writes in `useReverification`. In these tests
    // the SDK never throws a "needs reverification" error, so the wrapper is a
    // passthrough that simply invokes the underlying action.
    useReverification: (action: (...args: any[]) => any) =>
      (...args: any[]) =>
        action(...args),
    // Only consumed by the reverification step-up dialog, which never opens in
    // these tests (no step-up is triggered); null session keeps it inert.
    useSession: () => ({ isLoaded: true, session: null }),
  },
});
// The dialogs guard on this error type to detect a user-dismissed step-up. No
// such error is thrown here, so it always reports false.
mock.module("@clerk/react/errors", {
  namedExports: {
    isReverificationCancelledError: () => false,
  },
});
mock.module("@/hooks/use-toast", {
  namedExports: {
    useToast: () => ({
      toast: (t: { title?: string; description?: string; variant?: string }) =>
        toasts.push(t),
      dismiss: () => {},
    }),
  },
});

beforeEach(() => {
  toasts.length = 0;
  mockUser = null;
});

// --------------------------------------------------------------------------
// Render helpers.
// --------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  fn: () => void,
  { timeout = 4000, interval = 25 }: { timeout?: number; interval?: number } = {},
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

// Radix Dialog renders into a portal on document.body, so query the whole doc.
function $(testid: string): HTMLElement | null {
  return window.document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

function setInput(el: HTMLElement | null, value: string): void {
  const input = el as HTMLInputElement;
  assert.ok(input, "input should exist");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function click(el: HTMLElement | null): void {
  assert.ok(el, "clickable element should exist");
  el!.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

async function mountDialog(
  Component: any,
  React: any,
  createRoot: any,
  I18nProvider: any,
  QueryClientProvider: any,
  queryClient: any,
) {
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        I18nProvider,
        null,
        React.createElement(Component, {
          open: true,
          onOpenChange: () => {},
        }),
      ),
    ),
  );
  await sleep(60);
  return { host, root };
}

// --------------------------------------------------------------------------
// Password dialog.
// --------------------------------------------------------------------------
test("password dialog: validation + correct/incorrect current + social set", async () => {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { I18nProvider } = await import("../src/lib/i18n.tsx");
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  const { ChangePasswordDialog } = await import(
    "../src/components/account/change-password-dialog.tsx"
  );
  const queryClient = new QueryClient();

  // ---- Password user (passwordEnabled: true) ----
  let updateCalls: any[] = [];
  let shouldReject = false;
  mockUser = {
    passwordEnabled: true,
    updatePassword: async (args: any) => {
      updateCalls.push(args);
      if (shouldReject) {
        throw { errors: [{ longMessage: "Incorrect password." }] };
      }
      return {};
    },
  };

  const { host, root } = await mountDialog(
    ChangePasswordDialog,
    React,
    createRoot,
    I18nProvider,
    QueryClientProvider,
    queryClient,
  );

  // The current-password field is shown for password users.
  await waitFor(() => assert.ok($("input-current-password")));
  assert.ok($("input-new-password"), "new password field renders");

  // Too short: new password < 8 chars -> tooShort toast, no SDK call.
  setInput($("input-current-password"), "current-pw");
  setInput($("input-new-password"), "short1");
  setInput($("input-confirm-password"), "short1");
  click($("button-submit-password"));
  await waitFor(() =>
    assert.equal(toasts.at(-1)?.title, "Password must be at least 8 characters"),
  );
  assert.equal(updateCalls.length, 0, "too-short must not call updatePassword");

  // Mismatch: long enough but confirm differs -> mismatch toast, no SDK call.
  setInput($("input-new-password"), "longenough1");
  setInput($("input-confirm-password"), "different22");
  click($("button-submit-password"));
  await waitFor(() =>
    assert.equal(toasts.at(-1)?.title, "Passwords do not match"),
  );
  assert.equal(updateCalls.length, 0, "mismatch must not call updatePassword");

  // Incorrect current password: SDK rejects -> error toast surfaces the Clerk
  // message; updatePassword IS called with currentPassword + newPassword.
  shouldReject = true;
  setInput($("input-current-password"), "wrong-current");
  setInput($("input-new-password"), "brandnew123");
  setInput($("input-confirm-password"), "brandnew123");
  click($("button-submit-password"));
  await waitFor(() =>
    assert.equal(toasts.at(-1)?.description, "Incorrect password."),
  );
  assert.equal(updateCalls.length, 1, "incorrect current still calls the SDK");
  assert.deepEqual(updateCalls[0], {
    currentPassword: "wrong-current",
    newPassword: "brandnew123",
  });

  // Correct current password: SDK resolves -> success toast, called with both
  // current + new password.
  shouldReject = false;
  updateCalls = [];
  setInput($("input-current-password"), "right-current");
  setInput($("input-new-password"), "brandnew123");
  setInput($("input-confirm-password"), "brandnew123");
  click($("button-submit-password"));
  await waitFor(() =>
    assert.equal(toasts.at(-1)?.title, "Password updated successfully"),
  );
  assert.deepEqual(updateCalls[0], {
    currentPassword: "right-current",
    newPassword: "brandnew123",
  });

  root.unmount();
  host.remove();

  // ---- Social-login user (passwordEnabled: false) ----
  const setCalls: any[] = [];
  mockUser = {
    passwordEnabled: false,
    updatePassword: async (args: any) => {
      setCalls.push(args);
      return {};
    },
  };
  const second = await mountDialog(
    ChangePasswordDialog,
    React,
    createRoot,
    I18nProvider,
    QueryClientProvider,
    queryClient,
  );
  await waitFor(() => assert.ok($("input-new-password")));
  assert.equal(
    $("input-current-password"),
    null,
    "no current-password field for social-login users",
  );
  setInput($("input-new-password"), "firstpass123");
  setInput($("input-confirm-password"), "firstpass123");
  click($("button-submit-password"));
  await waitFor(() =>
    assert.equal(toasts.at(-1)?.title, "Password set successfully"),
  );
  assert.deepEqual(
    setCalls[0],
    { newPassword: "firstpass123" },
    "social set-password sends only newPassword (no currentPassword)",
  );

  second.root.unmount();
  second.host.remove();
});

// --------------------------------------------------------------------------
// Email dialog.
// --------------------------------------------------------------------------
test("email dialog: validation, happy path, and invalid-code path", async () => {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { I18nProvider } = await import("../src/lib/i18n.tsx");
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  const { ChangeEmailDialog } = await import(
    "../src/components/account/change-email-dialog.tsx"
  );
  const queryClient = new QueryClient();

  // Build a Clerk-user mock whose createEmailAddress returns a controllable
  // email-address resource.
  let prepareCalls = 0;
  let attemptStatus: "verified" | "unverified" = "verified";
  const attemptCalls: any[] = [];
  const updateCalls: any[] = [];
  let reloadCalls = 0;
  const staleDestroyed: string[] = [];

  const newAddress = {
    id: "e_new",
    emailAddress: "new@example.com",
    prepareVerification: async () => {
      prepareCalls += 1;
    },
    attemptVerification: async (args: any) => {
      attemptCalls.push(args);
      return { verification: { status: attemptStatus } };
    },
    destroy: async () => {},
  };
  const staleAddress = {
    id: "e_old",
    emailAddress: "old@example.com",
    destroy: async () => {
      staleDestroyed.push("e_old");
    },
  };
  let createCalls = 0;
  mockUser = {
    primaryEmailAddress: { emailAddress: "old@example.com" },
    emailAddresses: [staleAddress],
    createEmailAddress: async () => {
      createCalls += 1;
      return newAddress;
    },
    update: async (args: any) => {
      updateCalls.push(args);
    },
    reload: async () => {
      reloadCalls += 1;
    },
  };

  const { host, root } = await mountDialog(
    ChangeEmailDialog,
    React,
    createRoot,
    I18nProvider,
    QueryClientProvider,
    queryClient,
  );
  await waitFor(() => assert.ok($("input-new-email")));

  // Invalid email -> invalid toast, no SDK call.
  setInput($("input-new-email"), "not-an-email");
  click($("button-send-email-code"));
  await waitFor(() => assert.equal(toasts.at(-1)?.title, "Enter a valid email"));
  assert.equal(createCalls, 0, "invalid email must not create an address");

  // Same as current email -> same toast, no SDK call.
  setInput($("input-new-email"), "OLD@example.com");
  click($("button-send-email-code"));
  await waitFor(() =>
    assert.equal(toasts.at(-1)?.title, "This is already your email"),
  );
  assert.equal(createCalls, 0, "same-as-current must not create an address");

  // Invalid/abandoned code path: send to a valid new email, then submit a code
  // that the provider reports as NOT verified -> invalidCode toast, primary is
  // NOT swapped (user.update untouched).
  attemptStatus = "unverified";
  setInput($("input-new-email"), "new@example.com");
  click($("button-send-email-code"));
  await waitFor(() => assert.equal(prepareCalls, 1));
  await waitFor(() => assert.ok($("input-email-otp")));
  setInput($("input-email-otp"), "654321");
  await waitFor(() => {
    const btn = $("button-confirm-email") as HTMLButtonElement;
    assert.ok(btn && !btn.disabled, "confirm enabled at 6 digits");
  });
  click($("button-confirm-email"));
  await waitFor(() => assert.equal(toasts.at(-1)?.title, "Invalid code"));
  assert.equal(attemptCalls.length, 1, "verification was attempted");
  assert.equal(updateCalls.length, 0, "unverified code must not swap primary");

  // Happy path: the provider verifies the code -> primary swapped to the new
  // address, the stale address destroyed, user reloaded, success toast.
  attemptStatus = "verified";
  click($("button-confirm-email"));
  await waitFor(() =>
    assert.equal(toasts.at(-1)?.title, "Email updated successfully"),
  );
  assert.deepEqual(
    updateCalls.at(-1),
    { primaryEmailAddressId: "e_new" },
    "new address promoted to primary",
  );
  assert.deepEqual(staleDestroyed, ["e_old"], "stale address destroyed");
  assert.ok(reloadCalls >= 1, "user reloaded after the swap");

  root.unmount();
  host.remove();
});
