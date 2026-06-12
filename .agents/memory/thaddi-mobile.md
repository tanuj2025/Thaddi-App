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

## Apple App Store 3.1.1 (payments) — hard rule for all mobile work
- NEVER surface Moyasar or any external/web payment link in the mobile app. On-device purchases go through RevenueCat IAP ONLY (see thaddi-revenuecat-iap.md).
- Paid challenge **badges** (the Moyasar decorative catalog) are EXCLUDED from mobile entirely — do not port that flow even though the web/api supports it.
- Subscription **history** in the mobile profile is READ-ONLY (plan name / status / dates / price text), no billing or upgrade links.
- **Why:** linking out to external payment from an iOS app violates Apple 3.1.1 and risks rejection. Apply whenever porting a web feature that touches money.

## expo-router route conflicts (folder vs flat)
- A flat `app/foo/[id].tsx` and a folder `app/foo/[id]/index.tsx` resolve to the SAME route and conflict. When restructuring a screen into a folder (to add sibling routes like `[id]/manage.tsx`), you MUST delete the old flat `[id].tsx` — leaving both breaks routing silently. New file-based routes auto-discover; no `_layout.tsx`/Stack edit needed to register them.

## App icon & Android Expo-Go "stuck downloading" (large-bundle cold build)
- App icon source is the thaddi badge logo (gold ring / green / dark, "T" monogram). Generate with ImageMagick: `icon.png` 1024² near full-bleed (opaque, NO alpha — iOS rejects alpha); `adaptive-icon.png` 1024² with the badge scaled to ~66% (resize source to ~812 then `-extent 1024`) so Android's circular/squircle masks don't clip the gold ring. app.json: `android.adaptiveIcon.{foregroundImage,backgroundColor:"#060914"}`. Custom icon NEVER shows in Expo Go (Expo Go uses its own icon) — only in a dev/prod build.
- Android Expo Go infinite "New update available, downloading…" on this app = COLD-BUILD DEAD-AIR, not network. The dev JS bundle is large (multi-MB, ~1.6k modules); the first device request triggers a multi-second Metro build with ZERO bytes sent → Expo Go first-byte timeout → retry-loop (each retry restarts a build). Delivery of an ALREADY-BUILT bundle through the proxy is sub-second, so it's purely the build window that kills it.
- **Why/levers:** `experiments.reactCompiler:true` (experimental) noticeably lengthened the cold build for marginal runtime benefit — removed it. The dominant remaining cost is serializing the whole module graph, paid on every first-request-after-restart even with disk transform cache. Pre-warm fixes the immediate case: after a restart, curl the android+ios `launchAsset.url` (fetch the manifest with the `expo-platform` header, rewrite host→`localhost:$PORT`) so the next scan hits a cached bundle.
- Did NOT background expo in the dev script to auto-warm: backgrounding with `&`+`wait` breaks SIGTERM propagation → workflow restart can't free the Metro port. Keep expo in the FOREGROUND. Durable smoothness = an EAS dev build (Expo Go is at its limit for a 1653-module app).

## Deep-link join + ActivationGate ordering
- Pending invite code is stashed in AsyncStorage key `thaddi_pending_join` BEFORE redirecting an unauth'd/unactivated user to auth, and consumed exactly once at the **fully-activated** branch of `components/activation-gate.tsx` — `removeItem` the key BEFORE the `<Redirect>` to `/join/{code}`, or you get a redirect loop.
- The unauthenticated redirect target is `/(auth)/sign-in` (a real typed route); `/(auth)` alone is NOT a valid expo-router typed path and fails typecheck.
- Friend-request cancel is keyed by the TARGET user id (`useCancelFriendRequest({ id: user.userId })`), NOT the request id — mirrors web; the endpoint is `DELETE /api/users/{id}/friend-request`.
