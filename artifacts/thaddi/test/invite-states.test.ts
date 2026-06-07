// Regression tests for the invite-preview page (src/pages/join.tsx).
//
// The recipient of an invite link sees one of several mutually-exclusive states
// that are driven by the API's `isFull` and `status` fields:
//   - "full"  (data-testid="state-full")  when the challenge is at capacity
//   - "ended" (data-testid="state-ended") when its status is no longer "active"
//     (i.e. completed / cancelled)
//   - a working "Join" button otherwise
// and, when a join is attempted but the server replies 409 (e.g. it just filled
// up, or it closed between the preview load and the click), the human-readable
// reason from the server must be surfaced as a toast rather than a raw error.
//
// These branches had no automated coverage, so a stray edit could silently
// regress a recipient back to a broken "Join" button on a full/closed challenge,
// or swallow the 409 reason. This renders the REAL JoinPage in jsdom with its
// data hooks / auth / router mocked, exercising the exact JSX branches a user
// sees, and asserts the rendered state for each case.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";

// --------------------------------------------------------------------------
// jsdom environment + the globals React / the i18n provider read directly.
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
  // Node >=21 exposes a read-only global navigator; jsdom's is preferred but
  // the existing one is sufficient for these tests.
}
for (const key of [
  "HTMLElement",
  "Element",
  "Node",
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
// Node >=21 predefines global Event/CustomEvent, but those are a DIFFERENT realm
// from jsdom's. Radix (inside the toast) constructs events with the global and
// dispatches them on jsdom nodes, which rejects cross-realm Event instances
// ("parameter 1 is not of type 'Event'"). Force jsdom's constructors onto the
// global so dispatched events belong to the same realm as the DOM nodes.
for (const key of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "PointerEvent"]) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value) g[key] = value;
}
// Seeds the import.meta.env shim injected by ./vite-env-loader.mjs.
g.__VITE_ENV__ = { BASE_URL: "/" };
// The vendored shadcn `ui/` components (Toaster etc.) rely on the classic JSX
// transform with an ambient `React`, so expose it globally for them.
g.React = React;
// jsdom lacks ResizeObserver, which Radix primitives in the toast reach for.
if (g.ResizeObserver === undefined) {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// --------------------------------------------------------------------------
// Mutable test state. The mocked hooks below all read from this object, so each
// test simply sets the scenario it wants before rendering a fresh JoinPage.
// --------------------------------------------------------------------------
type Preview = {
  id: string;
  name: string;
  ownerDisplayName: string | null;
  description: string | null;
  participantCount: number;
  participantLimit: number | null;
  prizes: unknown[];
  type: string;
  alreadyJoined: boolean;
  status: string;
  isFull: boolean;
};

function basePreview(overrides: Partial<Preview> = {}): Preview {
  return {
    id: "chal-1",
    name: "Test Challenge",
    ownerDisplayName: "Owner",
    description: null,
    participantCount: 10,
    participantLimit: 10,
    prizes: [],
    type: "world_cup",
    alreadyJoined: false,
    status: "active",
    isFull: false,
    ...overrides,
  };
}

const state: {
  isLoaded: boolean;
  isSignedIn: boolean;
  preview: Preview | undefined;
  previewLoading: boolean;
  previewError: boolean;
  me: { activated: boolean } | undefined;
  joinMutate: (vars: unknown, opts: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void }) => void;
  joinPending: boolean;
} = {
  isLoaded: true,
  isSignedIn: true,
  preview: basePreview(),
  previewLoading: false,
  previewError: false,
  me: { activated: true },
  joinMutate: () => {},
  joinPending: false,
};

// --------------------------------------------------------------------------
// Module mocks. JoinPage pulls its data from the generated client hooks, its
// auth state from Clerk, and its routing from wouter — all of which we replace
// with controllable stubs reading `state`. Everything else (i18n provider, UI
// primitives, the toast store, react-query) stays REAL so the actual JSX
// branches and the real toast pipeline are exercised.
// --------------------------------------------------------------------------
mock.module("@clerk/react", {
  namedExports: {
    useUser: () => ({ isLoaded: state.isLoaded, isSignedIn: state.isSignedIn }),
  },
});

mock.module("wouter", {
  namedExports: {
    useLocation: () => ["/join/ABC123", () => {}],
    useParams: () => ({ code: "ABC123" }),
  },
});

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetInvitePreview: () => ({
      data: state.preview,
      isLoading: state.previewLoading,
      isError: state.previewError,
    }),
    useGetMe: () => ({ data: state.me }),
    useJoinChallenge: () => ({
      mutate: (vars: unknown, opts: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void }) =>
        state.joinMutate(vars, opts),
      isPending: state.joinPending,
    }),
    getGetMeQueryKey: () => ["getMe"],
    getGetMyChallengesQueryKey: () => ["getMyChallenges"],
  },
});

// --------------------------------------------------------------------------
// Render helpers.
// --------------------------------------------------------------------------
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

async function renderJoinPage() {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { I18nProvider } = await import("../src/lib/i18n.tsx");
  const { Toaster } = await import("../src/components/ui/toaster.tsx");
  const JoinPage = (await import("../src/pages/join.tsx")).default;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const mount = window.document.createElement("div");
  window.document.body.appendChild(mount);
  const root = createRoot(mount);
  root.render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        I18nProvider,
        null,
        React.createElement(JoinPage),
        React.createElement(Toaster),
      ),
    ),
  );
  await sleep(60); // let effects + the initial render settle
  return { mount, root };
}

// --------------------------------------------------------------------------
// "Full" state: isFull = true on an active challenge -> capacity notice, and
// crucially NO join button.
// --------------------------------------------------------------------------
test("invite page shows the full state (no join button) when isFull is true", async () => {
  state.preview = basePreview({ isFull: true, status: "active", alreadyJoined: false });
  const { mount, root } = await renderJoinPage();
  try {
    await waitFor(() => {
      assert.ok(
        mount.querySelector('[data-testid="state-full"]'),
        'expected the "full" state to render',
      );
    });
    assert.equal(
      mount.querySelector('[data-testid="button-join"]'),
      null,
      "the join button must not render for a full challenge",
    );
    assert.equal(
      mount.querySelector('[data-testid="state-ended"]'),
      null,
      "the ended state must not render for a merely-full challenge",
    );
  } finally {
    root.unmount();
  }
});

// --------------------------------------------------------------------------
// "Ended" state: a non-active status (completed / cancelled) -> ended notice
// and no join button. Ended takes precedence over full.
// --------------------------------------------------------------------------
for (const status of ["completed", "cancelled"]) {
  test(`invite page shows the ended state (no join button) when status is "${status}"`, async () => {
    state.preview = basePreview({ status, isFull: false, alreadyJoined: false });
    const { mount, root } = await renderJoinPage();
    try {
      await waitFor(() => {
        assert.ok(
          mount.querySelector('[data-testid="state-ended"]'),
          `expected the "ended" state to render for status "${status}"`,
        );
      });
      assert.equal(
        mount.querySelector('[data-testid="button-join"]'),
        null,
        "the join button must not render for an ended challenge",
      );
      assert.equal(
        mount.querySelector('[data-testid="state-full"]'),
        null,
        "the full state must not render for an ended challenge",
      );
    } finally {
      root.unmount();
    }
  });
}

test("invite page shows the ended state even when an ended challenge is also full", async () => {
  // status wins over isFull: a finished tournament shouldn't read as "full".
  state.preview = basePreview({ status: "completed", isFull: true, alreadyJoined: false });
  const { mount, root } = await renderJoinPage();
  try {
    await waitFor(() => {
      assert.ok(
        mount.querySelector('[data-testid="state-ended"]'),
        "ended must take precedence over full",
      );
    });
    assert.equal(
      mount.querySelector('[data-testid="state-full"]'),
      null,
      "the full state must not render when the challenge has ended",
    );
  } finally {
    root.unmount();
  }
});

// --------------------------------------------------------------------------
// Join 409 handling: the server's human-readable reason is surfaced as a toast,
// not a raw/opaque error. We simulate the mutation rejecting with the real
// ApiError shape (`err.data.error` = the server reason) and assert the reason
// text appears in the rendered toast.
// --------------------------------------------------------------------------
test("a join 409 surfaces the server's reason as a toast (not a raw error)", async () => {
  const REASON = "Participant limit reached";
  state.preview = basePreview({ isFull: false, status: "active", alreadyJoined: false });
  state.isSignedIn = true;
  state.me = { activated: true };
  // Mirror the generated client's ApiError: a 409 with a JSON `{ error }` body.
  state.joinMutate = (_vars, opts) => {
    opts.onError?.({ status: 409, data: { error: REASON } });
  };

  const { mount, root } = await renderJoinPage();
  try {
    const button = mount.querySelector<HTMLButtonElement>('[data-testid="button-join"]');
    assert.ok(button, "the join button should render for a joinable challenge");

    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    await waitFor(() => {
      const text = window.document.body.textContent ?? "";
      assert.ok(
        text.includes(REASON),
        `expected the toast to surface the server reason "${REASON}"`,
      );
    });

    const bodyText = window.document.body.textContent ?? "";
    assert.ok(
      !bodyText.includes("[object Object]"),
      "the toast must show the reason string, not a stringified error object",
    );
  } finally {
    root.unmount();
    state.joinMutate = () => {};
  }
});
