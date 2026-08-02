// Regression test: the owner invite card in ChallengeDetailPage must render
// all three share actions — Copy Code, Copy Link, WhatsApp — when the challenge
// has an invite code and the viewer is the owner.
//
// This specifically guards against the two-path duplication bug where the
// visible invite section (rendered in the return tree) diverges from any
// pre-computed variable.
//
// To avoid Radix compose-refs infinite update loops in jsdom, all shadcn UI
// primitives are stubbed as plain HTML elements.  Only the JSX branching logic
// inside ChallengeDetailPage (i.e. whether it emits the data-testid attributes)
// is exercised.
//
// Run with:World Championship 2026
//   node --import tsx --import ./test/register-hooks.mjs \
//     --experimental-test-module-mocks --test --test-force-exit \
//     test/challenge-detail-invite.test.ts

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";

// --------------------------------------------------------------------------
// jsdom environment
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
// English copy so assertions use English button labels.
(window.localStorage as Storage).setItem("thaddi_lang", "en");
try { g.navigator = window.navigator; } catch { /* Node >=21 */ }
for (const key of [
  "HTMLElement", "Element", "Node", "Text", "DocumentFragment",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "MutationObserver",
]) {
  const v = (window as unknown as Record<string, unknown>)[key];
  if (v && g[key] === undefined) g[key] = v;
}
for (const key of [
  "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "PointerEvent",
  "NodeFilter",
]) {
  const v = (window as unknown as Record<string, unknown>)[key];
  if (v) g[key] = v;
}
g.__VITE_ENV__ = { BASE_URL: "/" };
g.React = React;
if (g.ResizeObserver === undefined) {
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

// --------------------------------------------------------------------------
// Minimal challenge fixture (owner view, private challenge with invite code).
// --------------------------------------------------------------------------
const INVITE_CODE = "ABC12345";

const baseChallenge = () => ({
  id: "chal-1",
  name: "World Championship 2026 Predictions",
  description: null,
  type: "world_cup",
  status: "active",
  visibility: "private",
  predictionVisibility: "reveal_after_kickoff",
  inviteCode: INVITE_CODE,
  participantCount: 3,
  prizes: [],
  isOwner: true,
  isParticipant: true,
  isAssistant: false,
  owner: { displayName: "Alice", avatarUrl: null },
  badges: [],
  ownerBadgeCount: 0,
  participantBadgeCount: 0,
  scope: { type: "tournament", tournamentId: "wc2026", tournamentName: "World Championship 2026" },
});

// --------------------------------------------------------------------------
// Stub heavy shadcn/Radix UI primitives as plain HTML so Radix never runs
// in jsdom and cannot trigger compose-refs infinite loops.
// --------------------------------------------------------------------------
const passthrough =
  (tag: string) =>
  ({ children, "data-testid": dt, onClick, className, title, dir }: Record<string, unknown>) =>
    React.createElement(tag, { "data-testid": dt, onClick, className, title, dir }, children);

const noChildren = (tag: string) => (props: Record<string, unknown>) =>
  React.createElement(tag, { "data-testid": props["data-testid"] });

// Card
mock.module("@/components/ui/card", {
  namedExports: {
    Card: passthrough("div"),
    CardHeader: passthrough("div"),
    CardTitle: passthrough("h3"),
    CardContent: passthrough("div"),
  },
});

// Button — forward data-testid and onClick
mock.module("@/components/ui/button", {
  namedExports: {
    Button: passthrough("button"),
  },
});

// Label
mock.module("@/components/ui/label", {
  namedExports: { Label: passthrough("label") },
});

// Badge
mock.module("@/components/ui/badge", {
  namedExports: { Badge: passthrough("span") },
});

// Avatar
mock.module("@/components/ui/avatar", {
  namedExports: {
    Avatar: passthrough("div"),
    AvatarImage: noChildren("img"),
    AvatarFallback: passthrough("span"),
  },
});

// Input / Textarea
mock.module("@/components/ui/input", {
  namedExports: { Input: (p: Record<string, unknown>) => React.createElement("input", { "data-testid": p["data-testid"] }) },
});
mock.module("@/components/ui/textarea", {
  namedExports: { Textarea: passthrough("textarea") },
});

// Skeleton
mock.module("@/components/ui/skeleton", {
  namedExports: { Skeleton: (p: Record<string, unknown>) => React.createElement("div", { "data-testid": p["data-testid"] }) },
});

// Select — render nothing (owner settings, not under test)
const Noop = () => null;
mock.module("@/components/ui/select", {
  namedExports: {
    Select: Noop, SelectContent: Noop, SelectItem: Noop,
    SelectTrigger: Noop, SelectValue: Noop,
  },
});

// Tabs — render children of TabsContent transparently
mock.module("@/components/ui/tabs", {
  namedExports: {
    Tabs: passthrough("div"),
    TabsList: passthrough("div"),
    TabsTrigger: passthrough("button"),
    TabsContent: passthrough("div"),
  },
});

// AlertDialog / Dialog — stubs that render nothing (not under test)
mock.module("@/components/ui/alert-dialog", {
  namedExports: {
    AlertDialog: Noop, AlertDialogTrigger: Noop, AlertDialogContent: Noop,
    AlertDialogHeader: Noop, AlertDialogTitle: Noop, AlertDialogDescription: Noop,
    AlertDialogFooter: Noop, AlertDialogAction: Noop, AlertDialogCancel: Noop,
  },
});
mock.module("@/components/ui/dialog", {
  namedExports: {
    Dialog: Noop, DialogContent: Noop, DialogHeader: Noop,
    DialogTitle: Noop, DialogDescription: Noop, DialogTrigger: Noop,
  },
});

// Toast
mock.module("@/hooks/use-toast", {
  namedExports: { useToast: () => ({ toast: () => {} }) },
});

// Lucide icons — stub each one used by challenge-detail.tsx
const Icon = ({ className }: { className?: string }) =>
  React.createElement("span", { "data-lucide": true, className });
mock.module("lucide-react", {
  namedExports: {
    ArrowLeft: Icon, Users: Icon, Trophy: Icon, Copy: Icon, RefreshCw: Icon,
    MessageCircle: Icon, Crown: Icon, Loader2: Icon, QrCode: Icon, Plus: Icon, Trash2: Icon,
    Settings: Icon, Lock: Icon, Swords: Icon, LogOut: Icon, Shield: Icon,
    ShieldPlus: Icon, ShieldMinus: Icon, Award: Icon, Check: Icon, X: Icon,
    CalendarDays: Icon, ChevronRight: Icon, Star: Icon, Info: Icon,
    AlertCircle: Icon, RotateCcw: Icon, Eye: Icon, EyeOff: Icon, Send: Icon,
  },
});

// --------------------------------------------------------------------------
// Module mocks for data / routing.
// --------------------------------------------------------------------------
const noopMutation = () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false });

mock.module("@workspace/api-client-react", {
  namedExports: {
    useGetChallenge: () => ({ data: baseChallenge(), isLoading: false }),
    useGetChallengeParticipants: () => ({ data: [] }),
    useGetMySubscription: () => ({ data: undefined }),
    useUpdateChallenge: noopMutation,
    useRegenerateInvite: noopMutation,
    useRemoveParticipant: noopMutation,
    useDeleteChallenge: noopMutation,
    useLeaveChallenge: noopMutation,
    usePromoteAssistant: noopMutation,
    useDemoteAssistant: noopMutation,
    useGetChallengeBadgeCatalog: () => ({ data: [] }),
    useGetChallengeBadges: () => ({ data: [] }),
    useCheckoutChallengeBadge: noopMutation,
    useMoyasarCallback: noopMutation,
    useGetChallengeJoinRequests: () => ({ data: { requests: [] } }),
    useResolveJoinRequest: noopMutation,
    getGetChallengeQueryKey: () => ["getChallenge"],
    getGetChallengeJoinRequestsQueryKey: () => ["getChallengeJoinRequests"],
    getGetChallengeParticipantsQueryKey: () => ["getChallengeParticipants"],
    getGetChallengeBadgeCatalogQueryKey: () => ["getChallengeBadgeCatalog"],
    getGetChallengeBadgesQueryKey: () => ["getChallengeBadges"],
    getGetMySubscriptionQueryKey: () => ["getMySubscription"],
    getGetMyChallengesQueryKey: () => ["getMyChallenges"],
    UpdateChallengeVisibility: { public: "public", private: "private" },
    UpdateChallengePredictionVisibility: {
      hidden: "hidden",
      reveal_after_kickoff: "reveal_after_kickoff",
      always_visible: "always_visible",
    },
  },
});

mock.module("@clerk/react", {
  namedExports: {
    useUser: () => ({ isSignedIn: true, isLoaded: true }),
  },
});

mock.module("wouter", {
  namedExports: {
    useLocation: () => ["/challenges/chal-1", () => {}],
    useParams: () => ({ id: "chal-1" }),
    Link: ({ children, href }: { children: unknown; href: string }) =>
      React.createElement("a", { href }, children),
  },
});

mock.module("../src/components/challenge-stats", {
  namedExports: {
    ChallengeLeaderboard: () => null,
    WinningProbabilityCard: () => null,
    RankingImpactCard: () => null,
  },
});
mock.module("../src/components/challenge-predictions", {
  namedExports: { ChallengePredictions: () => null },
});
mock.module("../src/components/challenge-chat", {
  namedExports: { ChallengeChat: () => null },
});
mock.module("../src/components/layout", {
  namedExports: {
    Layout: ({ children }: { children: unknown }) =>
      React.createElement("div", { "data-testid": "layout" }, children),
  },
});

// --------------------------------------------------------------------------
// Render helper.
// --------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  fn: () => void,
  { timeout = 4000, interval = 30 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  for (;;) {
    try { fn(); return; } catch (err) { lastError = err; }
    if (Date.now() - start > timeout) throw lastError;
    await sleep(interval);
  }
}

async function renderDetailPage() {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { I18nProvider } = await import("../src/lib/i18n.tsx");
  const ChallengeDetailPage = (await import("../src/pages/challenge-detail.tsx")).default;

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
      React.createElement(I18nProvider, null, React.createElement(ChallengeDetailPage)),
    ),
  );
  await sleep(80);
  return { mount, root };
}

// --------------------------------------------------------------------------
// Tests.
// --------------------------------------------------------------------------
test("owner invite card renders the copy-code button", async () => {
  const { mount, root } = await renderDetailPage();
  try {
    await waitFor(() => {
      const btn = mount.querySelector('[data-testid="button-copy-code"]');
      assert.ok(btn, "expected button-copy-code to be in the DOM for an owner with an invite code");
    });
  } finally {
    root.unmount();
  }
});

test("owner invite card renders the copy-link button", async () => {
  const { mount, root } = await renderDetailPage();
  try {
    await waitFor(() => {
      const btn = mount.querySelector('[data-testid="button-copy-link"]');
      assert.ok(btn, "expected button-copy-link to be present in the invite card");
    });
  } finally {
    root.unmount();
  }
});

test("owner invite card renders the WhatsApp share button", async () => {
  const { mount, root } = await renderDetailPage();
  try {
    await waitFor(() => {
      const btn = mount.querySelector('[data-testid="button-share-whatsapp"]');
      assert.ok(btn, "expected button-share-whatsapp to be present in the invite card");
    });
  } finally {
    root.unmount();
  }
});

test("owner invite card shows the invite code display", async () => {
  const { mount, root } = await renderDetailPage();
  try {
    await waitFor(() => {
      const code = mount.querySelector('[data-testid="text-invite-code"]');
      assert.ok(code, "expected text-invite-code element to render for the owner");
      assert.ok(
        (code?.textContent ?? "").includes(INVITE_CODE),
        `expected invite code "${INVITE_CODE}" to appear in the code element`,
      );
    });
  } finally {
    root.unmount();
  }
});
