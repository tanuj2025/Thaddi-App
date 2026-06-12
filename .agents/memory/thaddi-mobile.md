---
name: thaddi-mobile (Expo app)
description: Architecture & gotchas for the THADDI native mobile app (@workspace/thaddi-mobile) — auth, networking, CORS, verification.
---

# THADDI mobile (Expo)

New Expo artifact (slug `thaddi-mobile`, previewPath `/mobile/`) that REUSES the shared API + generated `@workspace/api-client-react` client. NOT AsyncStorage, NOT a new backend. Arabic-first, RTL-default, bilingual AR/EN. Own i18n in `lib/i18n.tsx` + `lib/translations.ts` (ar/en key parity required; no registered i18n/rtl validation for mobile — web's checks don't scan it).

## Auth + networking wiring
- Auth = Replit-managed Clerk via `@clerk/expo` (Core v3 APIs) with BEARER tokens (no cookies on native). `tokenCache` from `@clerk/expo/token-cache` (SecureStore-backed).
- `setBaseUrl(\`https://${EXPO_PUBLIC_DOMAIN}\`)` at module load — **NO `/api` suffix**; generated client paths already include `/api` (e.g. `/api/me`).
- **`setAuthTokenGetter` MUST be registered at RENDER time, not in a `useEffect`.** React runs child effects before parent effects, so an effect-based registration in a layout fires AFTER child screens' first `useQuery` → those requests go out with no bearer → 401. Pattern: an `AuthBridge` component rendered directly inside `<ClerkLoaded>` registers a stable getter during render via a ref (`setAuthTokenGetter(() => getTokenRef.current())`).
- `AuthBridge` also calls `queryClient.clear()` when `useAuth().userId` changes → prevents cross-user cache bleed on sign-out / account switch (queryClient is a module singleton).
- Custom themed auth screens (native Clerk UI is incompatible with Expo Go). SSO: `useSSO().startSSOFlow({strategy:'oauth_google', redirectUrl: AuthSession.makeRedirectUri()})` + `warmUpBrowser` (android) + `WebBrowser.maybeCompleteAuthSession()`. `<View nativeID="clerk-captcha"/>` on sign-up. `navigate` callback: guard `session.currentTask`, use `window.location.href` only for absolute http URLs (web), else `router.replace`.
- Env: do NOT add NODE_ENV/PROD gates to Clerk wiring. `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` empty in dev workflow if not exported; pass it in the dev script and in `scripts/build.js` for prod (`EXPO_PUBLIC_CLERK_PROXY_URL = https://<domain>${CLERK_PROXY_URL}`, empty in dev).
- React stays 19.1.0 (RN 0.81 pins it). `@clerk/react` peer ~19.1.4 warning + `@solana/*` warnings are benign — do NOT bump react.

## CORS for native (api-server `app.ts`)
- `cors()` origin callback: no Origin header ⇒ allowed; in dev (`NODE_ENV!=="production"`) ALL origins allowed; in prod only `ALLOWED_ORIGINS` allow-listed.
- **Native iOS/Android send NO Origin header ⇒ always allowed.** So the production mobile app needs NO `ALLOWED_ORIGINS` change. The Expo *web preview* (cross-origin expo-domain→dev-domain) works in dev only because dev allows all.

## Data hooks (generated react-query client)
- This repo's orval config types the per-hook `query` option as a FULL `UseQueryOptions` (NOT Partial). So ANY override that passes `query: { ... }` MUST also pass `queryKey: getGet<Name>QueryKey(args)` or `tsc` fails with "Property 'queryKey' is missing". The web app already follows this everywhere — copy that pattern. Hooks called with no options are unaffected.
- After a mutation, invalidate BOTH the list key and any derived-count key (e.g. notifications: invalidate `getGetMyNotificationsQueryKey()` AND `getGetUnreadNotificationCountQueryKey()` — the header bell reads the count key).

## RTL in React Native (no I18nManager.forceRTL)
- Direction comes from `useI18n().dir`; rows set `flexDirection: dir==="rtl" ? "row-reverse" : "row"`, text uses `writingDirection`, back/forward chevrons mirror (`chevron-right` for rtl). Absolute offsets must be dir-aware too (spread `dir==="rtl" ? {left} : {right}`), since physical left/right don't auto-flip.

## Verifying mobile authed endpoints (deterministic)
- Mint a Clerk session token server-side with `CLERK_SECRET_KEY`: `POST https://api.clerk.com/v1/sessions {user_id}` → `POST /v1/sessions/{id}/tokens {expires_in_seconds}` → `jwt`; then `curl /api/me -H "Authorization: Bearer <jwt>"`; `POST /v1/sessions/{id}/revoke` to clean up. (Note: `?order_by=-created_at` can return a since-deleted id; use a plain `?limit=N` id.)
- `runTest` with `testClerkAuth:true` against the Expo **web** bundle is SLOW (timed out at 10 min) — the programmatic sign-in does create the user, but prefer the minted-token curl for endpoint verification over driving the web bundle.
- Screenshots of the Expo web preview often capture a blank white frame on first try (paint timing); wait a few seconds and re-screenshot. A `[DOM] Password field is not contained in a form` browser log + `Clerk has been loaded` confirms the screen actually mounted.
