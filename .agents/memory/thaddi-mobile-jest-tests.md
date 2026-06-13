---
name: thaddi-mobile jest smoke tests
description: How the Expo app's screen render/smoke tests are wired (jest-expo) and the seam-mocking pattern they rely on.
---

# thaddi-mobile screen smoke tests (jest-expo)

The Expo app uses **jest-expo** (SDK-matched, i.e. `jest-expo@~54` with jest 29 — jest-expo 54 still pins jest 29 / `react-test-renderer@19.1.0`, NOT jest 30) + `@testing-library/react-native@13`. Tests live in `artifacts/thaddi-mobile/__tests__/`, config in `jest.config.js`, global mocks in `jest/setup.ts`. Run via `pnpm --filter @workspace/thaddi-mobile run test`, registered as the `mobile` validation.

**Why:** the app had zero automated tests; a refresh touched every screen and a render regression would only show by opening the app by hand. The smoke tests mount each key screen and assert it renders without throwing.

**How it works (the load-bearing decisions):**
- **`--forceExit` is REQUIRED in the test script.** RN's mocked native modules / reanimated leave open handles, so jest never exits on its own (the run *hangs* without it — and `--detectOpenHandles` also hangs). This is expected for Expo jest suites, not a bug to chase.
- **jest.mock factories can't close over outer vars** (babel-jest-hoist): define helper objects (e.g. the noop router) INSIDE the factory, or prefix with `mock`.
- **Generated client `@workspace/api-client-react` is mocked with a Proxy** keyed by naming convention: `useGet*`/`useList*` → a *loading* query result (`data: undefined, isLoading/isPending: true`), other `use*` → idle mutation result, `getGet*`/`getList*` → query-key factory, `set*` → no-op, anything else → a proxy that echoes the key (covers enums like `GetMatchesScope`). Loading state is deliberate: every screen guards content behind isLoading, so this exercises the full module + top-level render WITHOUT depending on exact response shapes. Handle `__esModule` → true.
- **Native lib mocks:** reanimated → `react-native-reanimated/mock`; gesture-handler → `require(".../jestSetup")`; AsyncStorage → its `jest/async-storage-mock`. **safe-area-context + keyboard-controller ship their mock on the `default` export** — must spread it to named exports (`{ __esModule: true, ...(mock.default ?? mock) }`) or `useSafeAreaInsets is not a function`.
- **Kept REAL:** the app's own `lib/i18n` provider, `components/ui` primitives, formatters — and a real `QueryClientProvider` is needed because screens call `useQueryClient()` from the un-mocked `@tanstack/react-query`.
- `expo-router` is mocked (router no-ops, `useLocalSearchParams` returns a fixed `{id, code}` serving challenge/match/player + join screens); `@clerk/expo` mocked signed-in.
- Each screen is rendered in BOTH ar(RTL, default) and en(LTR) to catch direction-dependent render crashes. Path alias `@/*` is mapped via jest `moduleNameMapper`.
