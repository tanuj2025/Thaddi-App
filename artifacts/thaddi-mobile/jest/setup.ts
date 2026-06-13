/**
 * Global Jest setup for the THADDI mobile smoke tests.
 *
 * Screens are entangled with three kinds of external seam that cannot run in a
 * headless test: native animation/gesture libs, the Clerk auth session, the
 * generated network client, and expo-router navigation. We mock each here so a
 * screen can be mounted in isolation and we can assert it renders without
 * throwing. Anything *owned by the app* (i18n provider, the `components/ui`
 * primitives, formatters) stays REAL so the test exercises real render code.
 */

/* -------------------------------------------------------------------------- */
/* Native module mocks                                                         */
/* -------------------------------------------------------------------------- */

// Reanimated ships a drop-in Jest mock that no-ops worklets/animations.
jest.mock("react-native-reanimated", () =>
  require("react-native-reanimated/mock"),
);

// Gesture handler installs its own jest globals (RNGestureHandlerModule, etc.).
require("react-native-gesture-handler/jestSetup");

// Safe-area context: return static insets instead of measuring a real window.
// The shipped mock exposes the hooks/components on its `default` export, so we
// re-expose them as named exports (which is how the screens import them).
jest.mock("react-native-safe-area-context", () => {
  const mock = require("react-native-safe-area-context/jest/mock");
  return { __esModule: true, ...(mock.default ?? mock) };
});

// Keyboard controller has no native impl under jest.
jest.mock("react-native-keyboard-controller", () => {
  const mock = require("react-native-keyboard-controller/jest");
  return { __esModule: true, ...(mock.default ?? mock) };
});

// AsyncStorage: in-memory mock so the i18n provider's persistence is a no-op.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

/* -------------------------------------------------------------------------- */
/* Auth + navigation seams                                                     */
/* -------------------------------------------------------------------------- */

jest.mock("expo-router", () => {
  const React = require("react");
  const noopRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    setParams: jest.fn(),
  };
  return {
    router: noopRouter,
    useRouter: () => noopRouter,
    // Provide values for every dynamic segment used by the tested screens
    // (challenge/match/player id and the join code) so a single mock serves
    // all of them.
    useLocalSearchParams: () => ({ id: "test-id-1", code: "ABCD1234" }),
    useGlobalSearchParams: () => ({ id: "test-id-1", code: "ABCD1234" }),
    usePathname: () => "/",
    useFocusEffect: () => {},
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
    Stack: Object.assign(
      ({ children }: { children: React.ReactNode }) => children,
      { Screen: () => null },
    ),
    Tabs: Object.assign(
      ({ children }: { children: React.ReactNode }) => children,
      { Screen: () => null },
    ),
  };
});

jest.mock("@clerk/expo", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: "user_test",
    sessionId: "sess_test",
    getToken: jest.fn(async () => "test-token"),
    signOut: jest.fn(async () => {}),
  }),
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: "user_test",
      fullName: "Test User",
      primaryEmailAddress: { emailAddress: "test@example.com" },
    },
  }),
  useClerk: () => ({ signOut: jest.fn(async () => {}) }),
}));

/* -------------------------------------------------------------------------- */
/* Generated API client                                                        */
/* -------------------------------------------------------------------------- */

// The generated `@workspace/api-client-react` exports dozens of react-query
// hooks, query-key helpers, enums and TS types. Rather than enumerate them, a
// Proxy resolves any access by naming convention:
//   - useGet*/useList*  -> a "loading" query result (data undefined)
//   - use*              -> an idle mutation result
//   - getGet*/getList*  -> a query-key factory
//   - set*              -> a no-op (setBaseUrl/setAuthTokenGetter)
//   - everything else   -> a proxy that echoes the key (covers enum members)
// Loading state is deliberate: every screen guards its content behind an
// isLoading/isPending check, so this exercises each screen's full module +
// top-level render without depending on exact response shapes.
jest.mock("@workspace/api-client-react", () => {
  const queryResult = {
    data: undefined,
    isLoading: true,
    isPending: true,
    isFetching: true,
    isError: false,
    isSuccess: false,
    error: null,
    status: "pending",
    fetchStatus: "fetching",
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  };
  const mutationResult = {
    mutate: jest.fn(),
    mutateAsync: jest.fn(async () => ({})),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: jest.fn(),
  };

  const enumProxy: ProxyHandler<object> = {
    get: (_t, k) => (typeof k === "string" ? k : undefined),
  };

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "__esModule") return true;
        if (typeof prop !== "string") return undefined;
        if (prop.startsWith("useGet") || prop.startsWith("useList")) {
          return () => queryResult;
        }
        if (prop.startsWith("use")) return () => mutationResult;
        if (prop.startsWith("getGet") || prop.startsWith("getList")) {
          return (...args: unknown[]) => ["mock-key", prop, ...args];
        }
        if (prop === "setBaseUrl" || prop === "setAuthTokenGetter") {
          return () => {};
        }
        // Enums (e.g. GetMatchesScope) and other consts: echo the key.
        return new Proxy({}, enumProxy);
      },
    },
  );
});
