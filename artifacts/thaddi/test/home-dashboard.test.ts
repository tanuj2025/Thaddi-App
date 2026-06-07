// Regression tests for the signed-in home dashboard (src/pages/home.tsx).
//
// The home page renders three live-data cards by reusing the generated client
// hooks:
//   - Challenges (useDiscoverChallenges)  -> data-testid="list-home-challenges"
//   - Ranking    (useGetGlobalRanking)    -> data-testid="list-home-ranking"
//   - Matches    (useGetMatches)          -> data-testid="list-home-matches"
// Each card has a localized empty state when its hook returns nothing, and the
// ranking card additionally highlights the signed-in user's own rank/points
// when the API returns a `me` entry.
//
// None of this had automated coverage, so a stray edit to a hook, a card's
// loading/empty branch, or the "me" highlight could silently break the
// dashboard. This renders the REAL HomePage in jsdom with its data hooks /
// layout / router mocked, exercising the exact JSX branches a user sees, and
// asserts the rendered output for each scenario. Run with:
//   node --import tsx --import ./test/register-hooks.mjs \
//     --experimental-test-module-mocks --test --test-force-exit \
//     test/home-dashboard.test.ts

import { test, mock, beforeEach } from "node:test";
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
// Deterministic English copy for the empty-state assertions.
window.localStorage.setItem("thaddi_lang", "en");
try {
  g.navigator = window.navigator;
} catch {
  // Node >=21 exposes a read-only global navigator; the existing one is enough.
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
for (const key of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "PointerEvent"]) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value) g[key] = value;
}
// Seeds the import.meta.env shim injected by ./vite-env-loader.mjs.
g.__VITE_ENV__ = { BASE_URL: "/" };
// The vendored shadcn `ui/` components rely on the classic JSX transform with an
// ambient `React`, so expose it globally for them.
g.React = React;
if (g.ResizeObserver === undefined) {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// useCountdown (used by the matches card) starts a 1s setInterval per upcoming
// match. Unref the handles so a failing assertion that short-circuits a test
// before unmount can never keep the process alive.
const origSetInterval = globalThis.setInterval.bind(globalThis);
(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((
  ...args: Parameters<typeof setInterval>
) => {
  const handle = origSetInterval(...args);
  (handle as { unref?: () => void })?.unref?.();
  return handle;
}) as typeof setInterval;

// --------------------------------------------------------------------------
// Mutable test state. The mocked hooks below all read from this object, so each
// test simply sets the scenario it wants before rendering a fresh HomePage.
// --------------------------------------------------------------------------
type ChallengeSummary = {
  id: string;
  name: string;
  visibility: string;
  participantCount: number;
  inviteCode?: string | null;
};
type RankingEntry = {
  userId: string;
  rank: number;
  points: number;
  displayName: string | null;
};
type Me = { rank: number; points: number };
type TeamRef = { id: string; nameAr: string; nameEn: string };
type MatchSummary = {
  id: string;
  homeTeam: TeamRef | null;
  awayTeam: TeamRef | null;
  kickoffAt: string;
};

const state: {
  me: { displayName: string; level: string; totalPoints: number } | undefined;
  discover: { data: ChallengeSummary[] | undefined; isLoading: boolean };
  ranking: {
    data: { me: Me | null; entries: RankingEntry[] } | undefined;
    isLoading: boolean;
  };
  matches: { data: MatchSummary[] | undefined; isLoading: boolean };
} = {
  me: { displayName: "Tester", level: "rookie", totalPoints: 0 },
  discover: { data: [], isLoading: false },
  ranking: { data: { me: null, entries: [] }, isLoading: false },
  matches: { data: [], isLoading: false },
};

beforeEach(() => {
  state.me = { displayName: "Tester", level: "rookie", totalPoints: 0 };
  state.discover = { data: [], isLoading: false };
  state.ranking = { data: { me: null, entries: [] }, isLoading: false };
  state.matches = { data: [], isLoading: false };
});

// --------------------------------------------------------------------------
// Module mocks. HomePage pulls its data from the generated client hooks and its
// chrome from the Layout; routing comes from wouter. We replace those with
// controllable stubs so the actual card JSX branches are exercised against the
// real i18n provider and UI primitives.
// --------------------------------------------------------------------------
mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetMe: () => ({ data: state.me }),
    useTrackAnalyticsEvent: () => ({ mutate: () => {} }),
    useDiscoverChallenges: () => ({
      data: state.discover.data,
      isLoading: state.discover.isLoading,
    }),
    useGetGlobalRanking: () => ({
      data: state.ranking.data,
      isLoading: state.ranking.isLoading,
    }),
    getGetGlobalRankingQueryKey: () => ["getGlobalRanking", { limit: 5 }],
    useGetMatches: () => ({
      data: state.matches.data,
      isLoading: state.matches.isLoading,
    }),
    GetMatchesScope: { upcoming: "upcoming", past: "past", live: "live" },
  },
});

// The full Layout drags in Clerk, the notification bell, theme toggle, etc.,
// none of which are under test here. Replace it with a thin passthrough that
// just renders the page content.
mock.module("../src/components/layout.tsx", {
  namedExports: {
    Layout: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "layout" }, children),
  },
});

// wouter's Link expects a Router context we don't mount; a passthrough anchor is
// enough for these render assertions.
mock.module("wouter", {
  namedExports: {
    Link: ({ href, children }: { href: string; children: React.ReactNode }) =>
      React.createElement("a", { href }, children),
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

async function renderHomePage() {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { I18nProvider } = await import("../src/lib/i18n.tsx");
  const HomePage = (await import("../src/pages/home.tsx")).default;

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
      React.createElement(I18nProvider, null, React.createElement(HomePage)),
    ),
  );
  await sleep(60); // let effects + the initial render settle
  return { mount, root };
}

// --------------------------------------------------------------------------
// All three cards render real rows when their hooks return data.
// --------------------------------------------------------------------------
test("home dashboard renders live rows in all three cards when data is present", async () => {
  state.discover.data = [
    { id: "c1", name: "World Cup Pool", visibility: "public", participantCount: 12 },
    { id: "c2", name: "Friends League", visibility: "public", participantCount: 5 },
  ];
  state.ranking.data = {
    me: { rank: 7, points: 340 },
    entries: [
      { userId: "u1", rank: 1, points: 980, displayName: "Ace" },
      { userId: "u2", rank: 2, points: 870, displayName: "Bolt" },
    ],
  };
  state.matches.data = [
    {
      id: "m1",
      homeTeam: { id: "t1", nameAr: "الأهلي", nameEn: "Al Ahly" },
      awayTeam: { id: "t2", nameAr: "الهلال", nameEn: "Al Hilal" },
      kickoffAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const { mount, root } = await renderHomePage();
  try {
    await waitFor(() => {
      assert.ok(
        mount.querySelector('[data-testid="list-home-challenges"]'),
        "challenges list should render",
      );
      assert.ok(
        mount.querySelector('[data-testid="list-home-ranking"]'),
        "ranking list should render",
      );
      assert.ok(
        mount.querySelector('[data-testid="list-home-matches"]'),
        "matches list should render",
      );
    });

    // Real rows, keyed by the live data ids.
    assert.ok(mount.querySelector('[data-testid="row-home-challenge-c1"]'));
    assert.ok(mount.querySelector('[data-testid="row-home-challenge-c2"]'));
    assert.ok(mount.querySelector('[data-testid="row-home-ranking-u1"]'));
    assert.ok(mount.querySelector('[data-testid="row-home-ranking-u2"]'));
    assert.ok(mount.querySelector('[data-testid="row-home-match-m1"]'));

    const text = mount.textContent ?? "";
    assert.ok(text.includes("World Cup Pool"), "challenge name renders");
    assert.ok(text.includes("Al Ahly") && text.includes("Al Hilal"), "team names render");

    // None of the empty states should be visible when data is present.
    assert.ok(!text.includes("No public challenges right now."));
    assert.ok(!text.includes("No results yet"));
    assert.ok(!text.includes("No matches here right now"));
  } finally {
    root.unmount();
  }
});

// --------------------------------------------------------------------------
// Each card falls back to its localized empty state when its hook has no data.
// --------------------------------------------------------------------------
test("home dashboard shows localized empty states when hooks return no data", async () => {
  state.discover.data = [];
  state.ranking.data = { me: null, entries: [] };
  state.matches.data = [];

  const { mount, root } = await renderHomePage();
  try {
    await waitFor(() => {
      const text = mount.textContent ?? "";
      assert.ok(
        text.includes("No public challenges right now."),
        "challenges empty state",
      );
      assert.ok(text.includes("No results yet."), "ranking empty state");
      assert.ok(text.includes("No matches here right now"), "matches empty state");
    });

    // The data lists must NOT render in the empty case.
    assert.equal(mount.querySelector('[data-testid="list-home-challenges"]'), null);
    assert.equal(mount.querySelector('[data-testid="list-home-ranking"]'), null);
    assert.equal(mount.querySelector('[data-testid="list-home-matches"]'), null);
  } finally {
    root.unmount();
  }
});

// --------------------------------------------------------------------------
// The challenges card only surfaces rows whose detail page the viewer can open:
// public challenges, plus private ones the viewer owns/joined (which carry an
// inviteCode). Private non-member challenges (no inviteCode) would 403 on
// /challenges/:id, so the card must drop them. It also caps the list at 3.
// --------------------------------------------------------------------------
test("home challenges card hides private challenges the viewer can't open and caps at 3", async () => {
  state.discover.data = [
    // Public -> always openable, should render.
    { id: "pub1", name: "World Cup Pool", visibility: "public", participantCount: 12 },
    // Private but the viewer owns/joined it (has inviteCode) -> openable, renders.
    {
      id: "priv-member",
      name: "Friends Only",
      visibility: "private",
      participantCount: 4,
      inviteCode: "JOIN-ME",
    },
    // Private with no inviteCode -> would 403, must be dropped.
    {
      id: "priv-stranger",
      name: "Secret League",
      visibility: "private",
      participantCount: 9,
      inviteCode: null,
    },
    // Extra openable rows to push the visible list past the cap of 3.
    { id: "pub2", name: "Office League", visibility: "public", participantCount: 7 },
    { id: "pub3", name: "Neighbourhood Cup", visibility: "public", participantCount: 3 },
    { id: "pub4", name: "Late Joiners", visibility: "public", participantCount: 1 },
  ];

  const { mount, root } = await renderHomePage();
  try {
    await waitFor(() =>
      assert.ok(
        mount.querySelector('[data-testid="list-home-challenges"]'),
        "challenges list should render",
      ),
    );

    // Private non-member row must never render (it would 403 when clicked).
    assert.equal(
      mount.querySelector('[data-testid="row-home-challenge-priv-stranger"]'),
      null,
      "private challenge without an inviteCode must be hidden",
    );
    assert.ok(
      !(mount.textContent ?? "").includes("Secret League"),
      "the un-openable challenge's name must not appear",
    );

    // The list is capped at 3, drawn from the openable challenges in order.
    const rows = mount.querySelectorAll('[data-testid^="row-home-challenge-"]');
    assert.equal(rows.length, 3, "the challenges list is capped at 3 rows");
    assert.ok(
      mount.querySelector('[data-testid="row-home-challenge-pub1"]'),
      "the public challenge renders",
    );
    assert.ok(
      mount.querySelector('[data-testid="row-home-challenge-priv-member"]'),
      "the private challenge with an inviteCode renders",
    );
    assert.ok(
      mount.querySelector('[data-testid="row-home-challenge-pub2"]'),
      "the next openable challenge fills the third slot",
    );
  } finally {
    root.unmount();
  }
});

// --------------------------------------------------------------------------
// The ranking card highlights the signed-in user's own rank/points when the API
// returns a `me` entry — and omits that highlight when there is no `me`.
// --------------------------------------------------------------------------
test("home dashboard highlights the signed-in user's rank/points when ranking 'me' is present", async () => {
  state.ranking.data = {
    me: { rank: 42, points: 1234 },
    entries: [{ userId: "u1", rank: 1, points: 980, displayName: "Ace" }],
  };

  const { mount, root } = await renderHomePage();
  try {
    await waitFor(() => {
      const text = mount.textContent ?? "";
      assert.ok(text.includes("Your rank"), "the 'your rank' highlight renders");
    });
    const text = mount.textContent ?? "";
    assert.ok(text.includes("#42"), "the signed-in user's rank is shown");
    assert.ok(text.includes("1,234"), "the signed-in user's points are shown");
  } finally {
    root.unmount();
  }

  // No `me` -> no highlight, even though entries still render.
  state.ranking.data = {
    me: null,
    entries: [{ userId: "u1", rank: 1, points: 980, displayName: "Ace" }],
  };
  const second = await renderHomePage();
  try {
    await waitFor(() =>
      assert.ok(second.mount.querySelector('[data-testid="list-home-ranking"]')),
    );
    assert.ok(
      !(second.mount.textContent ?? "").includes("Your rank"),
      "the highlight must be absent when ranking has no 'me'",
    );
  } finally {
    second.root.unmount();
  }
});
