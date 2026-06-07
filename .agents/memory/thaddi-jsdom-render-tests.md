---
name: jsdom render tests for entangled thaddi pages
description: How to render a real React page (Clerk/wouter/generated-client/import.meta.env) in jsdom under node:test for behavioral assertions.
---

# Rendering entangled thaddi pages in jsdom (node:test)

The thaddi web tests are mostly static TS-AST guards, but a page's *rendered behavior*
(which JSX branch shows, what a click does) can be tested by mounting the REAL page in
jsdom and mocking only its external seams. Pattern lives in `artifacts/thaddi/test/`
(`invite-states.test.ts` + `register-hooks.mjs` + `vite-env-loader.mjs`), run via
`test:invite` script and chained into the `test` validation.

**Why:** "Tests cover the page rendering state X" tasks want real-DOM assertions, not
just source scans, and the password-requirements test only worked because that component
had no Clerk/wouter/import.meta.env/generated-client deps — full pages do.

**How to apply (the gotchas, in order):**
- **Run command** must be `node --import tsx --import ./test/register-hooks.mjs --experimental-test-module-mocks --test --test-force-exit <file>`. `node:test` `mock.module` is undefined without the experimental flag. `tsx` alone (the password test's `tsx --test`) can't register extra loaders, hence the explicit `node --import tsx`.
- **import.meta.env** (`BASE_URL`, etc.) is undefined under tsx and crashes pages at module load. Fix with a `module.register`'d `load` hook (`vite-env-loader.mjs`) that prepends `import.meta.env = Object.assign({BASE_URL:'/',...}, globalThis.__VITE_ENV__||{}, import.meta.env||{})` to transpiled src files. Exporting `load` via `--import` does NOT register it — you need a separate file that calls `register('./vite-env-loader.mjs', import.meta.url)`. Order matters: `--import tsx` first so the hook sees already-transpiled JS.
- **mock.module** the external seams (`@clerk/react` useUser, `wouter` useLocation/useParams, `@workspace/api-client-react` data hooks + query-key helpers), have them read a mutable `state` object each test sets before rendering. Keep i18n provider, `ui/` primitives, the toast store and react-query REAL.
- **Ambient React:** vendored `components/ui/*` (Toaster etc.) use the classic JSX transform with no `import React` → "React is not defined". Set `globalThis.React = React`. Also stub `ResizeObserver` (Radix needs it).
- **Event realm:** Node ≥21 predefines global `Event`/`CustomEvent`; jsdom rejects cross-realm events ("parameter 1 is not of type 'Event'") when Radix dispatches them. FORCE jsdom's `Event/CustomEvent/MouseEvent/...` onto the global (overwrite Node's, don't guard on `=== undefined`).
- **Process won't exit:** the toast store schedules a multi-minute removal timer → hang. `--test-force-exit` is required.
- ApiError shape from the generated client: `err.data` is the parsed JSON body, so a 409 reason is `err.data.error` (join.tsx surfaces `err.data?.error || t('join.error')`).
