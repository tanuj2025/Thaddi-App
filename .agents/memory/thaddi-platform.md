---
name: THADDI platform foundation
description: Durable architecture decisions and gotchas for the THADDI prediction platform (api-server + thaddi web + shared db).
---

# THADDI platform

Arabic-first FIFA World Cup 2026 prediction challenge platform (Saudi market, NOT gambling). Bilingual AR/EN, RTL default. Monorepo: `artifacts/api-server` (Express), `artifacts/thaddi` (React+Vite), shared `lib/db` (Drizzle), `lib/api-spec` (OpenAPI → generated `@workspace/api-client-react`).

## API routing
The api-server is mounted at `/api` (see its `artifact.toml` `paths = ["/api"]`). Inside the app, route files mount their routers at the **root** of that prefix, so OpenAPI paths map directly: `/feature-flags` → `/api/feature-flags`, `/platform-stats` → `/api/platform-stats`, `/me/...` → `/api/me/...`. The OpenAPI spec (`lib/api-spec/openapi.yaml`) is the source of truth — route handler paths must match spec paths exactly or the generated client 404s.
**Why:** easy to assume a `/platform/...` sub-prefix that doesn't exist and waste time debugging 404s.

## Dev workflow builds once — restart after backend changes
The api-server dev workflow runs `pnpm build && pnpm start` (esbuild bundle, **no watch**). Edits to routes/services are NOT live until you `restart_workflow` the API Server. New routes returning 404 right after editing almost always means "not rebuilt yet", not a routing bug. (The thaddi web workflow IS Vite HMR, so frontend edits are live.)

## Spec contract: response shapes must match the generated client exactly
The spec is the contract for **both** paths AND response/param shapes. Handler JSON bodies must match the generated client interfaces field-for-field, or the typed client silently mis-reads. Lessons paid for: notifications must return `{notifications, unreadCount}` / `{unreadCount}` (not `{count}`/`{updated}`), serialized items need the `channel` field, success endpoints return `SuccessResponse {success:true}` (200, not 202 `{accepted}`), and query params must match (`/analytics/metrics` reads `days`, not `windowDays`). When in doubt, grep the interface in `lib/api-client-react/src/generated/api.schemas.ts`.

## Web auth model
Web app talks to the API **same-origin** through the Replit proxy with cookie-based Clerk sessions. No Bearer tokens / `getToken` on web. CORS is therefore not needed for the web app; cross-origin (future mobile) must use an env allow-list (`ALLOWED_ORIGINS`) — never reflect arbitrary origins with `credentials: true`.

## Clerk JIT provisioning sync safety
`getOrProvisionUser` syncs email/emailVerified from Clerk on every read. The Clerk identity read is a **3-state** discriminated result, NOT a nullable identity: `ok` (sync), `deleted` (Clerk 404 — DEFINITIVE, refuse to serve), `unknown` (transient 5xx/network — keep last-known local state, skip sync). Do not collapse 404 back into "unknown" or a deleted account keeps resolving to its lingering local row.
**Why:** a transient Clerk outage was overwriting valid users to unverified/null email — but a 404 is the opposite (the identity is gone for good and must be honoured immediately).
**How to apply:** any "sync from external source of truth on read" must distinguish "definitively changed/gone" from "couldn't fetch".

## Account deletion (Apple 5.1.1(v)) — two non-obvious invariants
1. **Refuse deleted identities before serving any local row.** `getOrProvisionUser` returns null if EITHER a tombstone (`account_deletions`) exists OR the live Clerk read is `deleted` (404). The tombstone is the fast steady-state path; the 404 covers the window after Clerk is deleted but before/if local cleanup commits (e.g. a rolled-back txn leaves no tombstone). A Clerk session JWT stays signature-valid (networkless verify) until its short expiry, so without these checks a deleted account keeps authenticating.
2. **`DELETE /me` deliberately bypasses `requireCurrentUser`.** It resolves the caller from the verified JWT subject (`getAuth(req)`), deletes Clerk (404 = success), then atomically tombstones + deletes the local row **by clerkUserId**. This is what lets a user whose identity is already gone (a prior attempt's partial failure) retry and self-heal the lingering row. Going through `requireCurrentUser` would 401 them (invariant 1) and permanently strand the row.
**Why:** found via review — orphan local row + still-valid JWT was a privacy/compliance gap; the naive "atomic delete then rely on requireCurrentUser" both leaves an access window AND locks the user out of finishing cleanup.
**How to apply:** never "simplify" DELETE /me back through requireCurrentUser; keep the delete keyed by clerkUserId (not a pre-fetched row id) so retries find the row. Deterministic fault-injection test in `moderationFlows.e2e.ts`: delete the Clerk user directly, leave the row + no tombstone, assert GET /me=401 and retried DELETE /me=200 + row gone.

## Reviewer SMS bypass is mobile-only (App Store guideline 2.1)
A `REVIEWER_EMAILS` account skips the SMS/OTP gate ONLY on the native client. The native app sets header `X-Thaddi-Client: mobile` (web never does); `isMobileRequest(req)` reads it. The bypass is computed ONCE in `getOrProvisionUser` as `mobileReviewerBypass = fromMobile && isReviewer(email)` on BOTH return paths and stored on `CurrentUserRecord`; serializers (`serializeCurrentUser`/`isActivated`) read that flag — they must NEVER re-derive from `isReviewer` (they have no request context, so they'd leak the bypass to web).
**Why:** the bypass must never apply on the web, and pure serializers can't see the request.
**How to apply:** every endpoint that re-serializes after a mutation must spread `{...record, user}` (not `{user, profile}`) so the flag carries through; the underlying `users` row is never mutated (mobileVerified stays false).

## Prediction lock = kickoff (no lead)
`predictionLockAt` is always populated by sync as `kickoff - LOCK_LEAD_MS`, and `lockBoundary() = predictionLockAt ?? kickoffAt`. `LOCK_LEAD_MS` is **0** — predictions lock exactly at kickoff. The match-card "locks in / يتقفل خلال" countdown reads `predictionLockAt`, so any non-zero lead makes that countdown appear ahead of real kickoff (a user noticed a 30-min gap when lead was 30m).
**Why:** product owner explicitly wants the deadline AT kickoff, not before. Do not reintroduce a pre-kickoff buffer without sign-off; notification windows keyed off `predictionLockAt` shift with it.

## Activation flow ordering
Activation sequence is `email verified → profile complete → mobile verified → activated`. The mobile OTP endpoints (`/me/mobile/send-otp`, `/me/mobile/verify-otp`) enforce the prerequisites server-side (409 unless emailVerified && profileComplete), not just via the frontend `ActivationGate`. verify-otp also checks `expiresAt` and marks stale attempts `expired` before calling the provider.

## SMS verification
Mobile OTP uses a swappable provider service (`services/smsVerification.ts`, Authentica via `AUTHENTICA_API_KEY`). Missing key → service is null → endpoints return 503 gracefully (rest of app unaffected). `mobile_verification_status` enum: `pending|verified|failed|expired`. One verified mobile number per account (anti-cheating, unique guard at send + verify + DB constraint).
**Authentica auth header quirk:** the API expects the raw key in `X-Authorization: <key>` — do NOT add a `Bearer ` prefix and do NOT use the standard `Authorization` header; either of those returns `401 {"errors":[{"message":"Unauthorized"}]}` and the user sees the generic "Failed to send verification code." fallback. Verified: `X-Authorization: <key>` → `200 {"success":true,"message":"OTP sent successfully"}`. To probe the provider directly, curl from bash (env vars live there; the code_execution sandbox has NO `process.env`) and never print the key.

## Payments (Moyasar hosted Invoice flow)
Checkout creates a Moyasar **invoice** with `metadata {userId, planCode, edition}` and redirects to its hosted URL; on return the frontend POSTs the redirect `id` to `/payments/moyasar/callback`, which `verifyPayment`s server-side then activates the subscription (ownership gated on `metadata.userId === record.user.id`).
**Gotcha (cost a real paid-but-not-activated bug):** Moyasar does NOT copy invoice metadata onto the **payment** object. The hosted-invoice redirect returns a **payment** id whose `metadata` is `null`; the `userId/planCode` live only on the parent **invoice**. `verifyPayment` tries the Payments API first, so it must fall back to fetching `invoices/{payment.invoice_id}` when the payment metadata lacks our keys — otherwise the ownership check fails silently and activation is skipped (payment charged, plan unchanged).
**How to apply:** any new metadata-dependent payment logic must read from the invoice, not assume payment-level metadata. Activation is idempotent via two partial unique indexes — `(payment_provider, payment_reference)` and `(user_id, edition) WHERE active` — so replaying the callback (e.g. re-hitting `/pricing?id=<paymentId>`) is safe and is the recovery path for a charge that didn't activate.

### Tier upgrades (one active pass per edition)
Only ONE active subscription per `(user, edition)` is allowed (partial unique index), so "upgrading" = cancel the old pass + insert the new one **atomically in one tx**. Checkout permits a purchase only when the requested plan's `priceSar` is **strictly greater** than the user's current active plan price (same/lower → 409); price (not `orderIndex`) is the upgrade definition. There is no proration — the buyer pays full price for the new tier. Status enum has no `superseded`; the old pass is set to `cancelled`.
**Critical guard (a review caught this):** checkout-time gating is NOT enough — the activation callback MUST re-check monotonicity against the *currently active* plan and refuse to downgrade, because two invoices can be started from the same lower tier and confirm out of order (cheaper one last), or an invoice can go stale after a price change. Inside the activation tx: advisory-lock on the payment reference (serialize same-payment replays) → idempotency check by reference → `SELECT ... FOR UPDATE` the active pass → if new price ≤ current price, log + return the current plan WITHOUT cancelling → else cancel + insert. Base the `activated` response on the actual insert `returning` (re-read active on conflict), never assume success from the intended plan code.

## Clerk custom UI for account changes
Self-service email/password/mobile changes live in `components/account/*` dialogs on the profile page, NOT Clerk hosted screens (so the design system + AR/EN + i18n/rtl guards apply). Email: `user.createEmailAddress` → `prepareVerification({strategy:'email_code'})` → `attemptVerification({code})` → `user.update({primaryEmailAddressId})` → destroy stale addresses → `user.reload()` + invalidate `getGetMeQueryKey()` (local DB email syncs on next `/me` read via `getOrProvisionUser`). Password: branch on `user.passwordEnabled` — `updatePassword({currentPassword,newPassword})` vs `updatePassword({newPassword})` for social-login first-time set. Mobile: REUSE existing `useSendMobileOtp`/`useVerifyMobileOtp` (backend enforces one-verified-number-per-account + overwrite), no new endpoint.
**Gotcha:** `@clerk/types`/`@clerk/shared` are NOT directly resolvable in the thaddi package — don't `import type {EmailAddressResource}`; derive Clerk resource types from the hook instead (`type ClerkUser = NonNullable<ReturnType<typeof useUser>['user']>; type EmailAddressResource = ClerkUser['emailAddresses'][number]`). Clerk SDK errors surface via shared `lib/clerkError.ts` (`errors[0].longMessage||message`) with a localized fallback; if the instance requires step-up reverification these calls throw and only show the raw error (no custom reverification UI yet).

## Web custom auth uses Clerk's Future/signals API (NOT classic)
The whole web app imports Clerk from the `@clerk/react` index, which is the **Future/signals API** — custom sign-in + password-reset cards (`components/auth/CustomSignIn.tsx`, `ForgotPassword.tsx`) MUST use it, mirroring the `@clerk/expo` mobile screens. Key differences from classic:
- `useSignIn()` returns `{ signIn, fetchStatus, errors }` — there is **no** `isLoaded` / `setActive`. Loading = `fetchStatus === 'fetching'`; signed-in detection uses `useUser().isSignedIn`.
- Methods **return** `{ error: ClerkError | null }` — they do **not** throw. Always check the returned `error`, then read `signIn.status` **synchronously after** the await.
- `signIn.finalize({ navigate })` replaces classic `setActive`; the navigate callback gets `{ session?, decorateUrl }` — if `decorateUrl(url)` yields an absolute http(s) URL use `window.location.href`, else `setLocation(destPath,{replace:true})`.
- `signIn.sso({ strategy, redirectUrl, redirectCallbackUrl })` replaces `authenticateWithRedirect`; both URLs are absolute `${origin}${basePath}/sso-callback` (basePath = `BASE_URL` minus trailing slash, "" for web).
- Email-code password reset: `signIn.resetPasswordEmailCode.sendCode / verifyCode / submitPassword`; email MFA: `signIn.mfa.sendEmailCode / verifyEmailCode`.
**Error shape is dual** (`clerkErrors.ts`): a Future single `ClerkError` carries `.code`; a classic `ClerkAPIResponseError` carries `.errors[0].code` — `clerkErrorCode` reads BOTH, `clerkErrorMessage` delegates to it. Non-enumerating reset: `form_identifier_not_found` silently advances to the reset-code step.
**Invite (`?join=`) preservation has TWO channels — keep both:** email/password + reset read the `?join=` URL param into `destPath`/`joinSuffix` and navigate there directly. But the **OAuth/SSO** round-trip (Google/Apple) drops the query param, so `onOAuth` must stash the code in `localStorage` key `thaddi_pending_join` (the SAME key JoinPage writes) BEFORE `signIn.sso()`; after the `/sso-callback` finalize, the user lands at `/` → `HomeRedirect` → `PostAuthLanding`, which reads that key and redirects to `/join/{code}`. The old hosted `<SignIn fallbackRedirectUrl={/join/code}>` covered OAuth implicitly; a custom sign-in card does NOT, so forgetting the localStorage stash silently regresses invite-via-Google/Apple.
**Why:** the cards were first written in the classic API (`signIn.create`+`setActive`, throw-based) and compiled under Vite (which does NOT typecheck), so the mismatch only surfaced via `tsc`. Verify auth changes with `pnpm --filter @workspace/thaddi run typecheck` — the web app has unrelated pre-existing tsc errors (favorite-team-flag/layout/spinner/analytics), so check that none reference `components/auth/`.

## Seeded foundation
World Cup 2026 tournament/stages, plans (free/professional/legend/business) + entitlements, levels, badges, achievements, challenge templates, feature flags are **seeded data** (`lib/db/src/seed.ts`), never hardcoded in app logic. Seed is idempotent.

## Football sync & scoring: concurrency safety
Tournament sync (`services/football/sync.ts`) and the scoring engine (`services/scoring/engine.ts`) both run inside a `db.transaction` that first acquires a shared Postgres advisory lock (`acquireFootballLock`, key in `services/football/lock.ts`).
**Why:** `teams.external_id`/`matches.external_id` are NOT unique in the schema and sync upserts via read-then-write; scoring rewrites the points ledger via delete-then-insert. Two concurrent runs (startup sync racing a `/matches/refresh` call, or simultaneous refreshes) could otherwise duplicate teams/matches/ledger rows and inflate standings.
**How to apply:** any new operation that upserts football entities or rewrites ledger/standings must run under the same advisory lock + transaction. Fetch provider data BEFORE opening the transaction so network latency doesn't hold the lock.
- Sync matches on `external_id` (NOT unique). Different providers use different external_id schemes (mock: `m-a1`/`sa`; football-data.org: numeric). football-data.org (`FOOTBALL_DATA_API_KEY`) is the preferred live provider: GET `/v4/competitions/WC/matches?season=2026`, header `X-Auth-Token`; English names only, enriched to Arabic + flags via curated lookup in `footballDataProvider.ts`.
- **Self-heal prune (sync is no longer upsert-only):** after upserting the snapshot, sync prunes any *provider-managed* row (`external_id IS NOT NULL`) whose id is NOT a current-snapshot row — both rows from a prior provider's scheme AND legacy duplicate rows of a current external_id. This is why switching providers now fixes itself instead of needing a manual DB cleanup. **Guard:** matches referenced by predictions/prediction_history/points_ledger/challenge_matches are SKIPPED (never delete user data); teams still referenced by a match or a `challenge.teamId` are SKIPPED. Prune runs inside the SAME advisory-lock tx as upserts, AFTER matches then teams (so teams orphaned by removed matches become deletable). **Empty-snapshot safety:** never prune when the snapshot has 0 matches/teams (a provider hiccup must not wipe the tournament). **Determinism for legacy dups:** existing-row selects are ordered `createdAt,id` and keep the OLDEST as canonical; newer duplicates fall out of the canonical-id set and are pruned. Rows with `external_id NULL` (manual/non-provider) are never pruned; there is no admin endpoint to create matches/teams (only update, which doesn't touch external_id), so in prod every external_id-bearing row is provider-owned. `SyncResult` now carries `teams/matchesPruned` + `teams/matchesPruneSkipped`, surfaced in `/admin/sync` + `/matches/refresh` responses (both loosely typed, not in the spec) and the `sync.trigger` audit metadata.
- **adminSync e2e + prune:** that test FORCES the mock provider against the real WC tournament, so the prune now deletes the dev DB's live-provider rows. The test snapshots ALL team/match rows BEFORE the sync and, in teardown, re-inserts (verbatim, by original id) any pruned row that's now missing — safe because pruned rows have no dependents — leaving the DB exactly as found. It also seeds stale fixtures (orphan team + dependent-free match → pruned; a match WITH a prediction → skipped) to assert both prune and skip-guard. Other e2e suites set external_ids on fixtures but NONE trigger a sync, so they're unaffected.

## Prediction scoring model — "Simplest" 3 / 1 / 0
`scorePrediction` (`services/scoring/rules.ts`) awards **exact scoreline = 3, correct winner incl. draw = 1, everything else = 0**. Tiers do NOT stack (max 3/match). `DEFAULT_SCORING_RULES`/`ScoringRules` only hold `{exact, winner, none}`.
**Why:** product owner switched away from the old stacking 100/50/30/10 model (exact/winner/goal_difference/submitted).
**How to apply:** the `score_outcome` DB enum **intentionally keeps all 5 values** (`exact|winner|goal_difference|submitted|none`) — there is NO migration. But the scorer never emits `goal_difference` anymore: a goal-difference-only miss AND any other wrong-but-submitted prediction both store outcome `"submitted"` with **0 points**; `submitted` no longer carries points. "Correct" for accuracy/stats everywhere = `outcome in ('exact','winner')` (rankings.ts + gamification.ts SQL filters). Don't reintroduce points for `goal_difference`/`submitted`, and don't drop the enum values without a real migration. UI (`thaddi/src/lib/matchUtils.tsx` `outcomeBadgeStyle`/`outcomeLabelKey`) gates the "+N" badge on `pointsAwarded > 0`, collapsing submitted/goal_difference/none into one neutral "no points" state. To re-score the dev DB after a rule change use the canonical idempotent path: `applyScoringForFinalMatches()` then `runPostScoring(scored)` (mirrors `/admin/sync`).
- **`assignRanks` shares a rank on equal POINTS only** (standard competition ranking). The `exact`-then-`total` tie-break only orders display rows — it does NOT split the rank integer. So multiple 0-point participants all tie at the same rank (this surprised a test that assumed distinct ranks per distinct point value). Leaderboard tie-break is intentionally unchanged by the 3/1/0 switch.
- **Dormant `goal_master` badge:** `BADGE_THRESHOLDS.goal_master` / `goalDifferencePredictions` still exist but are now **unearnable** (scorer never emits goal_difference). Left in place deliberately; retire/hide from the catalog in a follow-up rather than leaving indefinitely.

## Active provider selection & ESPN switch
- **football-data.org free tier serves NO live WC2026 data** (all fixtures stay `TIMED` with null scores) — it is useless as the live source even though it "works". The keyless ESPN provider (`espn-wc`) is the one with real live scores. The active provider is chosen by the **`FOOTBALL_PROVIDER` env override** (`mock|espn|football-data|sportmonks`; key-requiring values fall through to the auto chain if unconfigured). Prod is pinned to `espn` (set in `.replit` env, applies on Publish). Tests that need offline determinism set `process.env.FOOTBALL_PROVIDER="mock"` BEFORE importing the app (selection is lazy/uncached in `resolveFootballProvider`; `getFootballProvider` caches).
- **Switching providers needs a one-time external_id reconcile** (`services/football/reconcile.ts`, `reconcileEspnExternalIds`, wired into `src/index.ts` boot BEFORE `syncTournament`). Predictions reference the match **UUID**, never `external_id`, but providers use different external_id schemes — so a naked switch makes sync INSERT fresh ESPN rows while the prune skips the old prediction-bearing rows → prediction-less duplicates. Reconcile rewrites ONLY `external_id` of existing rows onto the espnw- scheme (teams by ISO country code, fallback `lookupTeamI18n(nameEn).cc` then normalized name; matches by unordered team-UUID pair + UTC day, pair-only when unique), so the next sync UPDATES in place. Idempotent (skips already-espnw rows + taken targets → 2nd boot no-op), advisory-locked, no-op unless active provider is `espn-wc`. **Why the cc-fallback:** football-data left some teams uncoded (`country_code` NULL, e.g. "Cape Verde Islands"); without it they don't match ESPN's "Cape Verde" and duplicate.
- **ESPN snapshot contains bracket-PLACEHOLDER "teams"** for undetermined knockout slots ("Group A Winner", "Round of 32 14 Winner", "Third Place Group …") — ~52 of them. `GET /teams` (platform.ts) is the PUBLIC favourite-team picker listing ALL teams, so placeholders WOULD pollute it. `isPlaceholderTeam(name)` in `espnWorldCupProvider.ts` (matches `/\bwinner\b/`/`/\bplace\b/`, which never appear in real nation names) skips them in `buildTournament`; the knockout match is still created but with null team slots (TBD) until real teams are known — matches the football-data baseline and self-prunes the placeholder team rows. Result: picker shows exactly the 48 qualified nations.

## Challenge-scoped match access
`GET /challenges/:id/matches/:matchId` must verify `matchId ∈ matchIdsForChallenge(challenge)` before revealing participant predictions — the challenge-view permission check alone is insufficient.
**Why:** without the membership check, a viewer permitted to see a challenge could pass any match id and read that challenge's participant predictions for matches outside its scope (scope bypass / prediction leak).

## Rankings & prediction stats
- Standings expose rank *movement* by snapshotting each scoring run into a `rankings` table. The scoring engine writes snapshots with the open `tx`, but the previous-rank baseline is read on the pooled `db` (committed state) — never read the just-written snapshot back through the same tx, or movement is always 0.
- `accuracy` is stored/returned as a **ratio in [0..1]** (e.g. 0.733), not a percent. Any UI that shows it as `%` must multiply by 100 first.
**Why:** a frontend rendered `Math.round(accuracy)%` and showed 0%/1% for everyone.
- Prediction privacy: `/matches/:id/trends` returns aggregate **percentages only** (+ caller's own rarity) and is safe pre-lock; `/matches/:id/comparison` withholds all scorelines until `isLocked(match)` (prediction lock, NOT kickoff — once locked no one can change picks so aggregate scorelines are safe). Never widen these to expose individual scorelines before lock.
- Ranking-impact UI: `/challenges/:cid/matches/:mid/impact` is challenge-scoped (needs a challengeId), so it lives on challenge-detail, not the global match page. Pick the target match client-side: prefer live/half_time, else earliest locked-not-finished match from `GET /challenges/:cid/matches`.
- Advanced surfaces are gated by feature flags (`winning_probability`, `prediction_comparison`, `rare_predictions`), served via `GET /feature-flags`, read client-side through `useFeatureFlag`. Gate **every** UI fragment for a flag (incl. rarity badges on the trends card), not just the main card.

## Challenge writes: entitlement gating & atomicity
- Validate plan entitlements (e.g. custom_prizes) BEFORE any DB write in update handlers, and wrap multi-table writes (challenge + prizes) in a single `db.transaction`. Otherwise a rejected request can still persist partial non-prize updates.
- Participant-limit enforcement on join must be atomic: inside a transaction, `SELECT ... FOR UPDATE` the challenge row, re-count active participants, then insert/reactivate — a check-then-insert in separate statements lets concurrent joins exceed the limit. Use a sentinel error class thrown inside the tx to roll back and map to 409.
- Invite codes are generated UPPERCASE (unambiguous alphabet, no 0/O/1/I). Always normalize submitted codes with `.trim().toUpperCase()` before comparing for private joins; the public preview already uppercases, so a mismatch breaks lowercase invite URLs.

## Notifications: dispatch policy is part of the contract
Every product event type (`prediction_closing`, `match_starting`, `ranking_updated`, `competition_ending`, `badge_unlocked`, `competition_won`) must dispatch to **both** in-app AND email channels; only `general` (internal/system) is in-app-only. The DISPATCH map in `services/notifications/index.ts` is the source of truth — the requirement is "in-app and email for all listed events", and a review rejected an earlier version that emailed only the two competition milestones.
**Why:** narrowing email to "high-signal milestones only" reads as a sensible anti-spam choice but violates the stated requirement.
**How to apply:** EmailChannel must log-and-skip (never silent fallback) when `RESEND_API_KEY`/`NOTIFICATIONS_FROM_EMAIL`/recipient is missing, so routing all events to email is safe even before Resend is configured.

## Admin access gating & audit IP integrity
- `requireAdminUser` (`lib/currentUser.ts`) requires BOTH `role==='admin'` AND `status==='active'` (403 otherwise). Admin access must be revocable: a suspended/deleted admin loses the panel immediately on the next request. Activation (email/mobile verified) is intentionally NOT required for admin access — only role + active status.
- Audit IP comes from Express `req.ip`, which requires `app.set("trust proxy", 1)` in `app.ts` (single platform reverse proxy). Never read leftmost `x-forwarded-for` manually for the audit trail — an untrusted client can spoof it; `req.ip` under a correct `trust proxy` hop count is the canonical client address.
- Frontend `AdminGate` (`components/admin/admin-layout.tsx`) **redirects** non-admins (`/home`) and unauthenticated users (`/sign-in`) rather than rendering an access-denied page — the requirement is to redirect, not to show a denial screen.
**Why:** role-only gating left suspended admins with full access; manual x-forwarded-for parsing made audit IPs spoofable.

## Testing authenticated admin/API flows in this env
- The browser tester (`runTest`) has a HARD cap of ~10 runs per task; it is NOT reset by a user "continue" approval or by a code_execution notebook restart. Budget runs for the security-critical, UI-only checks (gating/redirects, RTL) and don't burn them on debugging loops. Keep plans ≤~6 steps and assert DURABLE state (table rows), not transient toasts. The in-test `[DB]` step silently no-ops here (UPDATE matches 0 rows) — provision/promote via your own `executeSql` instead, then sign in with the SAME email (Clerk reuses the same `clerk_user_id`).
- To exercise authenticated admin/user API endpoints WITHOUT the browser tester, mint a real Clerk session token server-side and call the API directly: `POST https://api.clerk.com/v1/sessions {user_id}` → `POST /v1/sessions/{id}/tokens` (use `CLERK_SECRET_KEY`), then hit `https://$REPLIT_DEV_DOMAIN/api/...` with `Authorization: Bearer <jwt>`. `clerkMiddleware()` accepts the Bearer token, so `getAuth`/`requireAdminUser` authenticate exactly as a real cookie session. Audit rows then carry `req.ip` (127.0.0.1 from the proxy hop) + the caller's user-agent — both non-null, proving the audit trail end-to-end. Drive the secret via a Node script (`process.env`), never the code_execution sandbox (no `process.env` there) and never print the secret/JWT.
**How to apply:** use the Bearer-token path for fast, cap-free verification of any role-gated endpoint + its audit/side-effects; reserve the browser tester for things only a real browser proves (redirect gating, dir/RTL rendering).

## Admin-panel regression test (validation `test`)
A self-contained automated regression test (`artifacts/api-server/test/`, run via `tsx`, registered as validation `test`) boots the Express `app` **in-process on an ephemeral port** — import `src/app`, NOT `src/index.ts` (index requires `PORT` and runs the startup football sync). It seeds its own admin + non-admin Clerk users + fixtures, mints Bearer tokens, exercises one mutation per admin section asserting 2xx + an `audit_logs` row with non-null ip/user_agent, asserts unauth→401 / non-admin→403, then deletes everything it created (audit rows first — `actorUserId` FK is set-null — then fixtures child→parent, then users + Clerk users).
**Why:** it must leave the dev DB exactly as found and not depend on a running workflow.
**How to apply:** the live sync (`POST /admin/sync`) is covered by a SEPARATE sibling test (`test/adminSync.e2e.ts`) that FORCES the offline mock provider by `delete process.env.FOOTBALL_DATA_API_KEY`/SportMonks keys before importing the app (provider selection is lazy, so clearing keys → mock). Run it as its own `tsx` process (chained `&&` in the `test` script) so the env-clearing can't leak into the live-provider admin-panel test. Self-cleaning via id-diff: snapshot team/match/ranking ids before sync, delete only the ids that appear after. Matches FK-cascade to predictions/ledger/challenge_matches; rankings are append-only so deleting the new snapshot ids restores the baseline. Never blindly delete re-created points_ledger rows (scoring is delete-then-insert) — rely on match-cascade instead. Create your own fixtures rather than editing seed data so teardown is a clean delete.
- A sibling player-flow regression test (`test/playerFlows.e2e.ts`) follows the same in-process harness and covers the security-sensitive player flows: challenge-scoped match access (out-of-scope match → 404, no prediction leak), prediction privacy (`/matches/:id/comparison` reveals scorelines only after lock; `/matches/:id/trends` exposes aggregate percentages only, never a `scorelines` key), and atomic participant-limit join (two concurrent joins for one slot → exactly one 200 + one 409, limit never exceeded). The `test` validation chains all suite files via `&&` (adminPanel && adminSync && playerFlows && challengeDelete && predictionWrites && scoringEngine && activationFlow) so an earlier failure short-circuits before the next runs. Seeded join users must be FULLY activated (emailVerified + mobileVerified=true + complete profile); Clerk Admin-API-created emails come back verified so the on-read identity sync keeps emailVerified=true.
- A sibling activation-flow test (`test/activationFlow.e2e.ts`) covers the sign-up→email→profile→mobile→activated foundation: the mobile-OTP prerequisite gate (send/verify-otp → 409 unless emailVerified && profileComplete, then 503 once eligible), OTP expiry (verify → 400 + status flipped `expired` before the provider), one-mobile-per-account (send → 409 dup + the `users.mobile_number` unique constraint), JIT-sync safety (transient Clerk read → no downgrade vs definitive unverified → downgrade), and the ActivationGate routing as a pure function of `/me` flags (email-gate → /onboarding → /verify-mobile → children). Two gotchas: (1) `AUTHENTICA_API_KEY` IS set in this env, so `delete process.env.AUTHENTICA_API_KEY` BEFORE importing the app to force the SMS service offline (memoized null) and never send a real OTP — mirrors the adminSync provider trick. (2) Stub `clerkClient.users.getUser` (a lazy Proxy — touch `.users` once, then override `getUser` in place) per-user to make the on-read email-verified sync deterministic and to simulate a transient failure by throwing (don't delete the Clerk user — that also kills the minted JWT). Keep the Clerk password SHORT (`Aa1!`+random); embedding the long e2e email overflows Clerk's password byte limit (422).

## Challenge permanent-delete (`DELETE /challenges/:id`) cleanup contract
Owner-only: non-owner → 403, missing → 404, owner → 200. The handler wraps cleanup in one `db.transaction`, deleting all dependent rows (challenge_participants, challenge_matches, challenge_prizes, points_ledger, rankings) before the challenge row. The ONE exception: earned `user_achievements` are PRESERVED — their `challengeId` is set to null, not the row deleted — matching that FK's `onDelete: "set null"`; a player keeps the badge/achievement they won even after the challenge is gone.
**Why:** the original handler `delete`d user_achievements rows on challenge delete, which destroyed earned achievements and contradicted the schema's set-null FK intent. Changed to `update ... set challengeId=null`.
**How to apply:** any new table referencing `challenges.id` must be added to this teardown — cascade-delete if it's challenge-scoped data, set-null if it's a durable user record that merely happened inside the challenge. Covered by `test/challengeDelete.e2e.ts` (15 checks: 403/404/200 + asserts every dependent table empties AND the user_achievements row survives with challengeId null).

## i18n guardrail check (validation `i18n`)
A registered `i18n` validation (`pnpm --filter @workspace/thaddi run check:i18n` → `artifacts/thaddi/scripts/check-i18n.mjs`, plain Node ESM, imports `typescript` from root) guards the Arabic experience against new hardcoded English. It does two things: (1) parses `src/lib/i18n.tsx` with the TS AST and asserts the `ar` and `en` blocks of the `translations` object have identical key sets (also flags duplicate keys); (2) walks `src/**/*.{ts,tsx}` (skips the dict itself) and flags JSX literal text nodes and user-facing attribute string literals (aria-label, aria-roledescription, title, placeholder, alt, label, …) that contain English words. Expressions like `{t('key')}` are JsxExpression, not JsxText, so they pass.
**Why:** the codebase was localized by hand; without a gate, new English literals silently break Arabic. Must keep a CLEAN baseline so it works as a regression gate.
The scanner covers many user-facing sinks beyond JSX text/attrs: toast/sonner, native dialogs (`confirm/alert/prompt`), `console.*`, thrown `Error` (dev-guard messages allowlisted), project-specific confirm/dialog helpers (helper calls + dialog-component message props), and project-specific notification/toast wrappers (`NOTIFY_HELPER_CALLEES`: notify/useNotify/showNotification/pushToast/notifySuccess… — direct string or options obj with title/message/description). The notify sink matches on EITHER the callee name (namespaced `helpers.notify(...)`) OR the receiver (chained toast-style `notify.success(...)`), unlike the confirm sink which is callee-name-only. Each sink is a small named set/matcher near the top of the file; **to add a new custom sink, extend the relevant CALLEES/PROPS set (or `isConfirmDialogComponent`) and re-run** — don't reinvent the English detection, always route through the shared `looksLikeEnglish`/`untranslatedWords` pipeline so the allowlist+masks apply. Gotchas worth keeping consistent: detect confirm-helper calls by the **callee/method name** (so `obj.confirmDialog()` matches), not the receiver; and never add a key already in UI_TEXT_ATTRS (e.g. `title`) to a second sink's prop set or you double-report.
**How to apply:** legitimately non-translatable tokens are allowlisted in `BRAND_ALLOW` (THADDI, Instagram, TikTok, WhatsApp, PlayStation, FAQ) and input masks (`^[Xx]+$`, e.g. `05XXXXXXXX`) are skipped — a translation check shouldn't demand translating brand proper nouns. To clear a new violation: wrap the string in `t()` and add the key to BOTH ar+en blocks, or (only for genuine proper nouns) extend the allowlist. NOTE editing `i18n.tsx` breaks Vite Fast Refresh (it exports both the provider component and the `useI18n` hook) → a full reload happens and you may briefly see "useI18n must be used within I18nProvider" in the console; it's transient, the app is fine after reload.
**Shared logic (no more drift):** like the RTL guard, ALL i18n detection logic now lives in ONE place — `scripts/i18n-guard.mjs` (the `@workspace/scripts` package), exporting `runI18nGuard({ rootDir, srcDir, i18nFile })` plus the pure helpers the tests import (`classifyArabicValue`, `longestEnglishRun`, `untranslatedWords`, `containsArabic`, `isNonProseSample`, `isProseWord`, `looksLikeEnglish`, `MIXED_RUN_THRESHOLD`, `BRAND_ALLOW`). `artifacts/thaddi/scripts/check-i18n.mjs` is now a thin wrapper supplying only its scan root + dict path. `artifacts/thaddi/test/check-i18n.test.mjs` imports the helpers from `@workspace/scripts/i18n-guard.mjs` (NOT the wrapper). Only thaddi has a wrapper today (mockup has no dictionary); add another wrapper + dict path if a second artifact ever needs it.

## Numerals & calendar: Western digits + Gregorian in BOTH languages
The product intentionally shows Western/Latin numerals (0123, not ٠١٢٣) and the Gregorian calendar in BOTH Arabic and English — only Arabic month/day NAMES stay Arabic. Numerals come from TWO independent sources, both must be handled:
1. **Programmatic formatting** — all `Intl.*` formatting routes through `localeOf(lang, enLocale?)` in `lib/matchUtils.tsx`. For Arabic it returns `AR_LOCALE = 'ar-SA-u-ca-gregory-nu-latn'` (the `-u-ca-gregory-nu-latn` extension forces Gregorian + Latin digits while keeping Arabic names); else the `enLocale` arg (default `en-US`, admin date helpers pass `en-GB`). NEVER hardcode `'ar-SA'`/`'ar'` ternaries at call sites — import and use `localeOf`. Admin `formatDate` helpers take `lang?: Lang` and call `localeOf(lang ?? 'en', 'en-GB')`.
2. **Hardcoded literals in the Arabic dictionary** (`lib/i18n.tsx` `ar` block) — these are NOT caught by `localeOf`. Any digit typed into an `ar` value (e.g. `كأس العالم 2026`, prices `200 ريال`, terms section numbers `10.`, `60 ثانية`) must be Latin. The i18n guard does NOT flag Arabic-Indic digits, so this is a manual discipline; a screenshot of an Arabic page is the real check.
**Why:** Saudi market preference; a numeral switch is only "done" when both sources are converted — fixing `localeOf` alone still leaves ٢٠٢٦ etc. in static dictionary strings.
**Gotchas:** `components/auth/password-requirements.tsx` matches Clerk's password-length error by substring — it keeps BOTH `"٨ أحرف"` and `"8 أحرف"` variants, and the password test (`test/password-requirements.test.ts` `REJECTED_MESSAGES.ar.length`) hardcodes the dictionary string, so editing that key's numerals requires updating the test in lockstep. Terms version is the separate constant `n` in `api-server/src/lib/terms.ts` (`"2026-06-07"`), NOT derived from the `legal.n` display string, so reformatting the displayed date does not trigger re-consent.

## RTL guardrail check (validation `rtl`)
A registered `rtl` validation (`pnpm --filter @workspace/thaddi run check:rtl` → `artifacts/thaddi/scripts/check-rtl.mjs`, plain Node ESM, imports `typescript` from root, mirrors the `i18n` guard) keeps the Arabic experience from regressing to physical LTR layout. It TS-AST-walks `src/**/*.{ts,tsx}`, collects class strings from `className`/`class` JSX attributes and class-helper calls (`cn`/`cva`/`clsx`/`cx`/`twMerge`/`tw`/`classNames`, covering ternaries + cva variant objects), and flags physical directional Tailwind utilities: `pl-/pr-`, `ml-/mr-`, `left-/right-`, `text-left/text-right` (incl. negatives + responsive/state variant prefixes), steering to logical `ps-/pe- ms-/me- start-/end- text-start/text-end`.
**Why:** physical→logical classes were hand-converted for native RTL; nothing stopped new physical classes silently breaking it again. Must keep a CLEAN baseline.
**How to apply:** the whole tree is scanned — `src/components/ui/` is NO LONGER skipped: the vendored shadcn primitives were converted to logical directional props, so new physical classes anywhere (incl. vendored primitives) now fail. Escape hatches: an explicit `rtl:`/`ltr:` variant on a class is treated as intentional and allowed; centering transforms `left-1/2`/`right-1/2` are allowlisted (`ALLOW_TOKENS`) — and dialog/alert-dialog centering uses `left-1/2` (not arbitrary `left-[50%]`, which IS flagged) to stay allowlisted. To clear a violation: swap to the logical class, or add an `rtl:`/`ltr:` variant if the class must be direction-specific on purpose. The `dir="ltr"` wrappers (OTP, phone numbers, scores) are NOT scanned — the guard only targets Tailwind classes, not `dir` attributes. The guard ALSO flags fixed-direction lucide icons (`ArrowLeft/Right`, `ChevronLeft/Right`) used as JSX tags without an RTL flip; it strips a trailing `Icon` suffix before lookup so the `<ChevronLeftIcon>`/`<ChevronRightIcon>` aliases (used by the vendored `calendar.tsx`) can't sidestep it — clear with `rtl:rotate-180`/`rtl:-scale-x-100` or `rotate-90` (vertical = neutral).
**Shared logic (no more drift):** all detection logic now lives in ONE place — `scripts/rtl-guard.mjs` (the `@workspace/scripts` package), exporting `runRtlGuard({ rootDir, srcDir })`. Each artifact's `scripts/check-rtl.mjs` is a thin wrapper that imports it via `@workspace/scripts/rtl-guard.mjs` (added as a `workspace:*` devDep) and only supplies its scan root: BOTH thaddi and `mockup-sandbox` (Canvas) scan all of `src` (mockup must scan its full tree so backward icons are caught in every component, not just vendored `ui/`). The `rtl` validation runs BOTH wrappers. The expanded `DIRECTIONAL_ICONS` set (cardinal+diagonal arrows, single/double chevrons, corner/elbow arrows, side panels) and the allowlist/class rules live in `scripts/rtl-guard.mjs` ONCE and cover both artifacts. `@workspace/scripts` has no `exports` field, so the subpath import resolves; `typescript` is required from root node_modules via the shared module's own `createRequire`.

## Live password requirement checkmarks (sign-up)
Clerk's prebuilt `<SignUp>` does NOT expose the live password value via any hook. To give per-rule live feedback, wrap `<SignUp>` in a ref'd div and attach a delegated `input` event listener (capture) that reads `input[name="password"]` (`name === 'password'`, not the confirm field). Component: `artifacts/thaddi/src/components/auth/password-requirements.tsx`, consumed by `SignUpPage` in `App.tsx`.
**Why:** the prebuilt form is a black box; DOM event delegation is the only way to mirror Clerk's own validation live without forking to a custom Clerk Elements form.
**How to apply:** mirror exactly what Clerk enforces — (1) length >= 8 (instant), (2) strength via `zxcvbn(value).score >= 2` (lazy `import('zxcvbn')`, debounced), (3) breach via HIBP k-anonymity range API (`api.pwnedpasswords.com/range/<sha1[0:5]>`, SHA-1 from Web Crypto, debounced). HIBP/zxcvbn failures must be NON-blocking (fall back to neutral, never a false red X) since Clerk does the authoritative check on submit. Throw `new Error()` with NO message in catch paths so the i18n guard's thrown-Error scan doesn't flag English. `zxcvbn` lives in thaddi `dependencies`, `@types/zxcvbn` in devDeps.
**Regression guard:** a jsdom render test (`artifacts/thaddi/test/password-requirements.test.ts`, run via `tsx --test`, script `test:password`, chained into the `test` validation) is thaddi's FIRST DOM-render test — it mounts the real `<PasswordRequirements>` against an `input[name="password"]` (plus a `confirmPassword` decoy) inside the shared container ref, types, and asserts the three rule rows transition (short→length unmet; `password123`→breach fail; strong→all met; typing the confirm field changes nothing). HIBP is stubbed with a real range-format body keyed by SHA-1 prefix (no network); rule state is read from each `<li>`'s lucide svg class (`text-primary`=met, `text-destructive`=fail, `animate-spin`=checking, no svg=unmet/idle). Needed new devDeps `jsdom`+`tsx`; set jsdom globals (window/document/localStorage + DOM ctors) BEFORE dynamic-importing react/react-dom; use real timers + a poll-`waitFor` (component debounces 200ms/500ms), NOT React `act`. **Limit:** it cannot catch Clerk *renaming* its password input — that needs a real browser against Clerk's network; this guards our delegation + thresholds + HIBP parsing only.

## Surfacing Clerk's submit-time password rejection in our card
To map Clerk's own rejection back onto our localized rule rows, run a `MutationObserver` on the same ref'd container and scan for password field errors via `.cl-formFieldErrorText__password` + `[data-localization-key^="unstable__errors.form_password"]`. Classify by the `data-localization-key` first (`pwned`→breach, `not_strong_enough`→strength, `too_short`/`length`→length, else generic), with EN/AR text fallbacks. Highlight the matching rule (force `fail` + ring) with a localized reason; render a generic banner when unmapped; clear the flag on the next password `input`.
**Why:** the prebuilt form shows its rejection in Clerk's own (sometimes English) alert, disconnected from our localized requirements card; `data-localization-key` is language-independent so it's the stable signal across AR/EN.
**How to apply:** add new `auth.passwordHint.rejected*` keys (parity in both dicts). Use logical Tailwind utils only (`-mx-2`, `ms-6`, never pl/pr/ml/mr) so the `rtl` guard passes.

## Participant limit is a SHARED owner pool, not per-challenge
The plan `participantLimit` is a single pool shared across ALL challenges an owner owns; each challenge's auto-added owner seat counts toward it. Enforced on BOTH join and challenge creation. The challenge row still stores a snapshot `participantLimit` (harmless/legacy) — do NOT read it for capacity; resolve the OWNER's `getUserPlan(ownerId).participantLimit` and count active participants across all the owner's challenges (`countActiveParticipantsForOwner`). Null limit = unlimited. Never retroactively evict over-budget members.
**Why:** per-challenge caps let an owner spin up unlimited challenges and bypass their plan; the pool is the real monetization boundary.
**How to apply:** any capacity check (join, create, invite `isFull`) must be pool-based and race-safe: open a tx, take a per-owner advisory lock (`acquireOwnerPoolLock`, two-key `pg_advisory_xact_lock(471707, hashtext(ownerId))` — separate lock space from the single-key football lock), re-count inside the tx, then reject. Create rejects when `used + 1 > limit` (the owner's own new seat) with 403; join rejects when `used >= limit` with 409. Both responses carry `code: "owner_pool_full"` (ErrorResponse.code is optional in spec) and the frontend branches on that code for AR/EN messaging (`join.full` = host capacity full, `create.poolFull` = your capacity full). `getMySubscription` exposes `participantsUsed` so UI shows `used/limit`. e2e capacity tests need a DEDICATED owner with a custom plan + active subscription (insert plansTable + subscriptionsTable, teardown subs before plans before users) since the default free plan's pool spans the whole test owner.
## Prediction visibility — three states & reveal lockstep
`prediction_visibility` (DB enum `predictionVisibilityEnum`, OpenAPI enum) has THREE values: `hidden` (no one but the predictor ever sees a prediction), `reveal_after_kickoff` (visible to everyone once that match has kicked off), and `always_visible` (everyone sees everyone's predictions anytime). Per-match reveal = `always_visible OR (reveal_after_kickoff AND hasKickedOff)`.
**Why:** the reveal rule is computed in MORE THAN ONE place — the single match-detail/comparison endpoint AND the consolidated challenge-predictions endpoint (`GET /challenges/{id}/predictions`, owner Players-&-Predictions tab). They must stay in lockstep or one surface leaks while the other hides.
**How to apply:** when changing reveal semantics, update BOTH endpoints together. NEVER add an owner bypass — owners are gated identically to guests pre-kickoff (verified: owner sees no predictions under `reveal_after_kickoff` before kickoff). Adding a new enum value means touching: `lib/db/src/schema/enums.ts` (+ `cd lib/db && pnpm push`), all OpenAPI enum spots + `pnpm --filter @workspace/api-spec run codegen`, both reveal sites, and BOTH ar+en i18n blocks (`pv.<value>`).

## Challenge badges (paid decorative) vs earnable badges
Two unrelated "badge" concepts coexist — keep them separate. **Challenge badges** are a real-money catalog (admin CRUD, price SAR) of decorative emblems bought via the existing Moyasar SAR checkout and attached to a *challenge* (shared per-challenge set, not per-user). Buyer must be the challenge owner OR an active participant; the purchase is gated like other paid writes (entitlement check + atomicity) and the Moyasar callback branches on `metadata.kind === 'challenge_badge'` (idempotent insert under advisory lock, unique payment ref) — mirror the same callback/ownership-metadata pattern as other purchases, do NOT add a parallel checkout path. Purchased badges render on the challenge card + detail for ALL viewers; the shop dialog only shows for buyers. Catalog seeds 20 starter PNGs in `artifacts/thaddi/public/badges/<code>.png` served at `${import.meta.env.BASE_URL}badges/<code>.png`. This is distinct from any earnable/gamification badge concept — don't conflate the two tables or UIs.
**Why:** "badge" is overloaded; conflating the paid catalog with achievement badges leads to wrong gating and double checkout paths.

## Testing Radix dialogs in jsdom (node:test)
Frontend dialog tests render the real account dialogs in jsdom + `mock.module` (run via `tsx --test --experimental-test-module-mocks`). jsdom alone is NOT enough for Radix Dialog: its FocusScope/DismissableLayer build & dispatch events and walk the DOM using the *global* constructors, and Node 24 already defines some of those globals — so you must **overwrite** (not conditionally assign) jsdom's `Event`/`CustomEvent`/`NodeFilter` onto `globalThis`, AND copy every `HTML*`/`SVG*Element` constructor across (FocusScope does `instanceof HTMLInputElement`-style checks). Symptom of a missing one: dialog content silently never mounts (`document.body` stays empty, errors swallowed by React) — debug by capturing `console.error` stacks, not by trusting the empty DOM.
**Why:** chased "dialog won't render" through several missing globals; each one threw inside a Radix effect that React caught and hid.
**How to apply:** mirror the global-setup block in `artifacts/thaddi/test/account-dialogs.test.ts`; query portaled content on the whole `document`; set inputs via the native value setter + `input` event.
## orval name collisions across api-zod export-star + tsx resolution
When an OpenAPI operation has BOTH a path param and query params, orval emits a `{OperationId}Params` **zod schema** (path params, in `lib/api-zod/src/generated/api.ts`) AND a `{OperationId}Params` **type** (query params, in `./generated/types`). `lib/api-zod/src/index.ts` does `export * from "./generated/api"` + `export * from "./generated/types"`, so the duplicate name triggers `tsc` `TS2308` (ambiguous re-export).
**Why:** the obvious fix — an extensionless explicit re-export `export { X } from "./generated/api"` — satisfies `tsc` but is FLAKY under `tsx`'s ESM resolver (the e2e `test` validation): it races the `export *` resolution and intermittently throws `ERR_MODULE_NOT_FOUND` / `resolveDirectory` for `./generated/api`. Standalone runs may pass while the chained workflow fails.
**How to apply:** disambiguate with an EXPLICIT `.ts` extension — `export { X } from "./generated/api.ts"` — and set `allowImportingTsExtensions: true` in `lib/api-zod/tsconfig.json` (permitted because it's `emitDeclarationOnly`). Deterministic for both `tsc --build` and `tsx`. Consumers import api-zod via its `exports` → `src/index.ts`, so the emitted `.d.ts` extension is never consumed. Don't just drop the re-export: the name IS unused by consumers but `tsc` still errors `TS2308` on the bare double `export *`.

## Prod data vs dev: publish syncs schema, NOT seed data
**Rule:** Replit Publish syncs the production *schema* (table/column diff) but does NOT copy seed/reference data. Prod is a SEPARATE database from dev with its own real user data.
**Why:** challenge_badge feature merged fine and prod schema matched dev (32 tables identical), yet prod's `challenge_badge_catalog` was empty (dev=20, prod=0) because the seed never ran against prod. `plan_entitlements` had also DIVERGED (prod has a `business` plan + different max_participants the dev seed lacks) — i.e. prod config edited independently; do NOT blindly push dev seed over it.
**How to apply:** To get reference/catalog rows into prod: prod is read-only via executeSql (can't INSERT), and you MUST NOT write prod-targeting seed scripts or startup-seeding (see database-migrations-on-publish). Safe paths = the live admin panel CRUD (app's own write path) or the Publish "overwrite data" option — but overwrite is WHOLESALE and destroys real prod users/challenges/subscriptions, so unsafe when prod has real usage. The real badge-purchase table is `challenge_purchased_badges` (NOT `payments`/`challenge_badge_purchases` — those names don't exist). Beware: the prod read-replica can momentarily return odd results; verify with information_schema before concluding a table is "missing".

## RTL bidi scramble in mixed number+label runs
The `rtl` guard only catches physical Tailwind classes — it cannot see bidi text-ordering bugs. The real surviving RTL bugs are runs that mix Arabic-Indic digits + Arabic labels + separators inside one text node. The countdown (`formatCountdown` in `lib/matchUtils.tsx`) was forced into a `dir="ltr"` span while its content was Arabic (e.g. `٤يوم ٥س ٥١د`); the LTR base + multiple alternating number/word runs scrambled it visually (rendered like `٤يوم اس ٥ا د`).
**Fix:** wrap each `${number}${label}` unit in Unicode first-strong isolates U+2068 (FSI) … U+2069 (PDI) so each unit renders self-contained and never reorders against neighbours OR the container `dir`. This fixes every call site (schedule/landing/match-center/match-detail) at the source without changing the spans.
**How to apply:** a single number-then-Arabic-word run (e.g. "١٢ صحيحة", "١٢٣ ريال") is usually safe; it's 3+ alternating runs in a forced-dir container that scramble. Reach for FSI/PDI isolation, not `dir` flips, when a numeric/label string mixes scripts.
**Static guard now exists (part of the `rtl` validation):** `scanBidiScramble` in `scripts/rtl-guard.mjs` (called by `runRtlGuard`, so both thaddi+mockup wrappers run it; no new validation) AST-flags un-isolated number+label runs in two shapes: (1) a template literal / `+` concat that glues a number producer (`formatNum(...)`, a local arrow alias of it like `const n = v => formatNum(...)`, or `.toLocaleString()`) directly to a label (`t(...)`, an Arabic string literal, or a property-access label) with NO whitespace separator and NO isolate; (2) a forced-`dir="ltr"/"rtl"` JSX element whose children build a multi-unit run (≥2 number producers + a `t()` label, or a number glued straight to a `t()` label). A literal-level isolate char (U+2066–2069) anywhere in the template/concat/children marks the unit protected → not flagged, which is why the FSI/PDI-wrapped `formatCountdown` passes. Allowlisted-clean: whitespace-separated single number+word ("١٢ صحيحة"), pure scorelines (`${formatNum(a)}/${formatNum(b)}`), number+punctuation ("78'", "+5", "#3"), and dynamic `dir={dir}` containers (only literal `"ltr"/"rtl"` count as forced). Tests: `artifacts/thaddi/test/check-rtl.test.mjs` (fixture-driven, incl. a regression that re-flags the ORIGINAL glued countdown).

## Radix DirectionProvider must be INSIDE ClerkProvider
Placing `<DirectionProvider dir={dir}>` OUTSIDE `<ClerkProvider>` does NOT work — Clerk internally re-provides its own Radix direction context as `ltr`, which overrides our outer provider for all Radix components in the subtree.
**Why:** React context uses closest-ancestor wins. Clerk's internal `DirectionProvider` is closer to our components than the one outside ClerkProvider.
**How to apply:** In `App.tsx → ClerkProviderWithRoutes`, the `DirectionProvider` must wrap the app content INSIDE ClerkProvider — specifically wrapping `<TooltipProvider>` inside `<QueryClientProvider>`, AFTER `<ClerkQueryClientCacheInvalidator />`. Using a `dir` prop directly on individual Radix components (e.g. `<Tabs dir={...}>`) also works as a per-component fallback but the app-level inside-Clerk placement covers all components at once.

## Brand naming: "thaddi App" / "تطبيق تحدي" vs the common noun
User-facing brand is **"thaddi App"** (EN) / **"تطبيق تحدي"** (AR), driven by the `app.name` i18n token; route logo alt/footer brand through `t('app.name')`, not hardcoded text. The Arabic word **تحدّي/تحدي** is ALSO the common noun "challenge" (share copy "سوِّ تحدّي", custom-challenge labels, `admin.audit.entity.challenge`, seed labels) — those are NOT the brand and must stay. Only rename تحدّي when it names the platform itself (Terms/Privacy/FAQ subject, "على تحدّي" = "on THADDI" in share tails).
**Why:** a blind find/replace of تحدّي would corrupt half the dictionary.
**How to apply:** i18n-guard `BRAND_ALLOW` carries the brand tokens (`thaddi`, `App`); email sender display name is built in `notifications/channels.ts` by wrapping `NOTIFICATIONS_FROM_EMAIL` as `thaddi App <addr>`. Logo wordmark art (`public/logo.png`, `public/opengraph.jpg`) still shows the old wordmark — needs a design pass.

## Live match status: ESPN state-driven + client-derived phase
**ESPN soccer status must be driven off `status.type.state` ("pre"/"in"/"post"/`completed`), never by enumerating `type.name`.** ESPN reports period-specific names (first half, second half, in-progress, halftime, full time); matching only "in progress" lets live halves fall through to `scheduled` — the score shows but the live badge never does. Precedence: explicit halftime/postponed/cancelled names first, then completed/post→finished, then state "in"→live.
**Why:** this was the root cause of "live friendly shows a score but no live/minute indicator."
**The API status enum does NOT distinguish 1st vs 2nd half** — that distinction is a *display* concern derived client-side from `minute` (≤45 first half, >45 second half). Keep all card surfaces driven by one shared helper rather than re-deriving per surface, so a single place owns the phase→label/minute contract and surfaces never drift (the detail header originally forgot the "ended" state because it duplicated logic).
**How to apply:** backend mapping lives in the football providers' `mapStatus`; frontend phase + labels live in `lib/matchUtils.tsx`; new status labels need ar/en i18n parity. No spec/codegen change — phase is purely derived from existing status+minute.

## Hall of Fame duplicate awards (NULL-challenge dedupe)
Global achievements (e.g. `top_predictor`) are awarded with `challengeId = NULL`. The
`user_achievements_unique` constraint on `(userId, achievementId, challengeId)` does NOT
dedupe these: Postgres treats NULLs as distinct in UNIQUE constraints, so
`awardAchievement`'s `onConflictDoNothing` never matches and `evaluateTopPredictor()`
(called from `runPostScoring` after every scoring/sync run) inserted a fresh row each time
— the Hall of Fame filled with the same user repeated.

**Fix (two parts, both deploy-safe):**
- Read: `/hall-of-fame` query GROUP BYs `(userId, achievement code/names, challengeId)` with
  `max(awardedAt)`. GROUP BY treats NULLs as equal, so dup rows collapse to one entry and
  `LIMIT` applies to DISTINCT entries (so a bloated user can't push others out).
- Write: `awardAchievement`'s null-challenge branch runs check-then-insert inside a
  `db.transaction` that first takes `pg_advisory_xact_lock(GLOBAL_ACHIEVEMENT_LOCK_NS=471708,
  hashtext(`${userId}:${achId}`))`. Needed because `runPostScoring` runs AFTER the football
  scoring lock is released and from several entry points (scheduler, /matches/refresh,
  /admin/sync, demo engine), so concurrent calls would otherwise both pass the existence check.

**Why no DB unique index / NULLS NOT DISTINCT:** prod already contains duplicate NULL-challenge
rows, so a `drizzle-kit push` of a new unique index at deploy time would fail. The advisory
lock gives equivalent write-safety without a migration. Long-term option: clean prod dups,
then add a partial unique index `(userId, achievementId) WHERE challengeId IS NULL`.

**Advisory-lock namespaces (two-key int4,int4 space, never collide):** participant pool
`471707`, global achievements `471708`; football domain uses the single-key space.

## Admin overrides: plan change & challenge member roster
**Admin plan override** (`PATCH /admin/users/:id/plan`) sets a user's plan with NO payment, separate from the Moyasar paid path: under `pg_advisory_xact_lock` + transaction, cancel the user's active subs then insert a fresh active sub with `paymentProvider:"admin"` for the configured edition. Entitlements resolve off the active sub, so the override stays consistent with the paid flow without touching it. `loadUserDetail` must surface the current plan (via `getUserPlan`) so the admin UI reflects the change immediately.
**Challenge member roster** (`GET /admin/challenges/:id/members`) must UNION owner + assistants + participants and dedupe by userId — assistants live in `challenge_assistants` and may have NO `challenge_participants` row, and the owner may never have joined as a player. Building the list only from participant rows (even annotated with assistant role) silently drops non-playing assistants. Members `joinedAt` is therefore nullable (assistants/owner with no participant row).

## jsdom test mock.module requires every named import
`mock.module(specifier, { namedExports })` in the thaddi node:test suites must list EVERY named export the component statically imports from that specifier — node validates the named imports against the mock, not the real module. Adding a new generated hook (e.g. a `useList*` from `@workspace/api-client-react`) to a page breaks its render test with `SyntaxError: ... does not provide an export named ...` until you add the hook to that test's mock namedExports.

## Football provider chain & ESPN WC26
Provider selection (`services/football/index.ts`, lazy + cached): `footballData ?? sportmonks ?? espnWC ?? mock`. football-data.org stays PRIMARY (needs `FOOTBALL_DATA_API_KEY`).
- **ESPN WC26 (`espnWorldCupProvider.ts`, name `espn-wc`)** is the **keyless fallback**: when neither football-data nor SportMonks keys are set it is selected automatically (ESPN `fifa.world`/league 606 scoreboard, no key) — it is NOT gated behind an enable flag. **Why:** the task requires real WC26 data with no API key as the no-key default. **Forcing the offline mock** (offline dev + any e2e/sync test that must not hit a live API) is done via explicit `FOOTBALL_PROVIDER=mock`, NOT by clearing keys — clearing keys now falls through to ESPN. Date-range overridable via `ESPN_WC2026_START_DATE`/`_END_DATE` (default `20260611`-`20260720`). Selection logic lives in pure `resolveFootballProvider()` (uncached) so env combos are unit-testable.
- **Full-tournament fetch in ONE call** (`?dates=START-END`) — sync's prune needs a COMPLETE snapshot or it would delete not-yet-fetched valid matches. Verified live: 104 teams / 100 matches, stages group/R32/R16/QF.
- Stage from each event's `season.slug` via `mapStage` (exported, unit-tested): knockout slugs `quarterfinals`/`semifinals` embed "final", so specific rounds MUST be checked before the generic `final` fallback. Status via inline `mapStatus` (same ESPN shape, exported for tests). IDs prefixed `espnw-` (distinct from football-data numeric ids).
- **Curated AR-name+flag map is now SHARED** in `services/football/teamI18n.ts` (`TEAM_I18N`, `normalizeName`, `flag`, `lookupTeamI18n`); footballDataProvider + espnWorldCupProvider both import it (was duplicated in footballDataProvider). Unknown teams fall back to English name + provider logo/crest.
- Tests: `test/espnWorldCupProvider.test.ts` (pure mapStage + buildTournament assembly; no network) chained into the `test` validation.

## lib/db consumed via TS project references — rebuild .d.ts after adding exports
`@workspace/db` package.json `exports` point at SOURCE (`./src/index.ts`), so RUNTIME (esbuild/tsx) always sees new exports immediately. But api-server/thaddi tsconfigs list `lib/db` under `references`, and TS project-reference resolution reads the referenced project's EMITTED declarations in `lib/db/dist/*.d.ts` (lib/db has `composite:true`, `emitDeclarationOnly:true`, NO `build` npm script). **So after adding/renaming an export in lib/db, `tsc` typecheck of consumers fails with "Module '@workspace/db' has no exported member X" even though the app runs fine** — the dist `.d.ts` is stale. **Fix:** rebuild declarations with `pnpm exec tsc -b lib/db --force` (or `tsc -b <consumer>` which builds refs first). **Why it's confusing:** runtime success masks the stale-types problem; only `tsc --noEmit` surfaces it.

## Safari "Verifying…" handshake loop & gate dead-ends
**Symptom:** In PROD only, a signed-in Safari user self-refreshes forever on a "جاري التحقق" (Verifying…) screen, never reaching /home. Root cause = Clerk full-page handshake loop (Safari ITP partitions/blocks the session cookie unless Clerk loads same-origin via the `/api/__clerk` proxy). There is NO `window.location.reload` in app code — the reloads are Clerk's own handshake.
**Fix path (clerk-auth skill, in order):** (1) bump `@clerk/*` within major ranges respecting `minimumReleaseAge` — handshake/Safari fixes ship in the SDK; (2) diff client+server wiring against `setup-and-customization.md` and re-sync (ours already matched canonical verbatim — proxy middleware == template, `clerkMiddleware` host resolution canonical, `proxyUrl` unconditional, no `setAuthTokenGetter`/Bearer on web).
**Why gate hardening matters:** `ActivationGate` (ClerkConfig.tsx) must NEVER fall through to a permanent spinner. If `/me` errors OR the user is signed-in but stuck non-activated, render an error card with Retry (`refetch`) + Sign Out (`signOut({redirectUrl:'/'})`), not `gate.verifying`. Dead-end spinners look identical to the handshake loop and hide real failures.
**Verify:** dev cannot reproduce (proxy is prod-only) — real acceptance is physical Safari/iOS on the published domain after Publish.

## Hall of Fame top-players: challenge visibility must filter on the VIEWER
`GET /hall-of-fame/top-players` (viewer-optional / effectively public) returns the global Top-N players AND, per player, the challenge(s) they belong to (owner UNION active participant). Those challenge names/IDs are subject to challenge visibility — the SAME rule as `canViewChallenge`: public/unlisted are shown to anyone, but a PRIVATE challenge may only be revealed to a viewer who owns it or is an active participant of THAT specific challenge.
**Why:** the board is public, so an unfiltered list leaks private challenge names/IDs and the member associations behind them (privacy/scope leak). The leak is in the *enriching join* (`challengesForUsers`), not the ranking itself — easy to miss because the standings are legitimately public.
**How to apply:** `challengesForUsers(userIds, viewerId)` precomputes the viewer's accessible private challenge ids (owned + active membership) and drops any private challenge not in that set; `computeTopPlayers(currentUserId,…)` passes the viewer through. Regression: `test/hallOfFameVisibility.e2e.ts` (anonymous/outsider see public-only; owner/member see private).

## Social graph: profile-prediction privacy & friend-request state machine
Public player profile (`buildPlayerProfile`, signed-in only) recent-predictions reveal to a NON-self viewer must honor THREE gates together: (1) match has kicked off; (2) the owner's user-level `users.hidePredictions` flag is off; (3) the per-challenge `predictionVisibility` rule — a prediction is concealed only when it is covered EXCLUSIVELY by `hidden`-visibility challenges among the owner's challenges (a match in NO owner challenge is revealed; one non-hidden covering challenge is enough to reveal). The OWNER (self) always sees their own kicked-off predictions regardless of any toggle.
**Why:** these are the same reveal semantics as the comparison/challenge-match endpoints — keep them in lockstep; a profile that honored only the user-level flag would leak predictions the per-challenge `hidden` rule was meant to conceal, and vice-versa.

**Friend-request state machine** (`services/social/index.ts`): pending uniqueness is a PARTIAL unique index on `least/greatest(pair) WHERE status='pending'`, so declined/cancelled/accepted rows are kept as history and NEVER block a fresh request — any test asserting "can't resend after decline/cancel" is wrong. Send + respond serialize on a per-canonical-pair `pg_advisory_xact_lock` (namespace `471709`) and re-check state inside the txn. Friendships are stored ONCE per pair in canonical order (`userIdA < userIdB`, DB check constraint) — always insert with `canonicalPair()`. Follow is idempotent via `onConflictDoNothing`; notify fires only on an actual insert.

**Route gating:** social READS (`/users/:id/profile|followers|following`, `/me/social`) use `requireCurrentUser` (401 if anon); all MUTATIONS use `requireActivatedUser` (403 if not activated). `followUser` AND `unfollowUser` both 404 on a missing/deleted target (kept symmetric so the spec's documented 404 holds for unfollow too). Self-follow / self-friend-request → 400; respond by non-recipient → 403; respond to non-pending → 409.
Regression: `test/socialFlows.e2e.ts` (31 checks: hide-predictions + hidden-challenge interplay, follow idempotency/404, full friend lifecycle incl. decline/cancel-resend) chained into the `test` validation after `playerFlows.e2e.ts`.

## api-server e2e harness: plain tsx (no mock.module) → stub external HTTP at global.fetch
The `artifacts/api-server/test/*.e2e.ts` files run via plain `tsx test/X.e2e.ts` (NOT `tsx --test`), so `node:test`'s `mock.module` is UNAVAILABLE — that seam only works for the `--test` runner (used by the web jsdom tests). To isolate an external service (e.g. Moyasar) in an api-server e2e: capture `realFetch = globalThis.fetch`, override `globalThis.fetch` to intercept the provider host (`api.moyasar.com`) and passthrough everything else (Clerk admin REST + the local app), set any required secret env (e.g. `MOYASAR_SECRET_KEY`) BEFORE `await import("../src/app")` (top-level await so import ordering holds), and restore both fetch + env in `finally`.
**Why:** mixing up the two runners silently no-ops the stub (mock.module throws/ignored under plain tsx) → real outbound calls or false greens.
**How to apply:** each e2e boots Express via `app.listen(0)` on an ephemeral port, mints real Clerk session tokens (CLERK_SECRET_KEY admin REST), seeds + self-reverts fixtures in FK-safe order, and always `server.close()` + `pool.end()` in `finally` (separate process per file, so per-file pool.end is fine). Template: `socialFlows.e2e.ts`; fetch-stub example: `paymentsCallback.e2e.ts`.

### e2e fixture teams get pruned mid-run unless `demo:` prefixed
The api-server boots the football scheduler, so `pruneStaleTeams` (`src/services/football/sync.ts`) runs every ~60s during any long e2e and DELETES any team whose `externalId` is non-null, not in the live ESPN snapshot, and NOT `LIKE 'demo:%'` — UNLESS the team is referenced by a match. A fixture team referenced only by `users.favoriteTeamId` is unprotected, so a multi-minute e2e (each `createClerkUser` is a slow network call) can lose its team mid-run → FK violation `users_favorite_team_id_teams_id_fk` on a later seed. Symptom is flaky/timing-dependent (passes fast, fails slow).
**Why:** the prune only skips match-referenced teams; favourite-team-only references aren't seen as "in use".
**How to apply:** for a self-contained fixture team, give it `externalId: \`demo:...\`` (prune-exempt by design) — done in `moderationFlows.e2e.ts`. Or do what `playerFlows.e2e.ts` does: point `favoriteTeamId` at a pre-existing ESPN team (`SELECT id FROM teams LIMIT 1`), which the snapshot keeps alive. Don't rely on a throwaway non-demo team surviving.

## Production health-check path
Repeatable read-only prod check: `pnpm --filter @workspace/api-server run health:prod` (script `artifacts/api-server/scripts/health-probe.mjs`, no deps, exit 0/1) probes the public endpoints (healthz, platform-stats, feature-flags, plans, teams, schedule, upcoming-matches) and confirms football data is synced. Doc: `artifacts/api-server/HEALTHCHECK.md`.
**Why:** the configured startup gate is `/api/healthz` (artifact.toml `[services.production.health.startup]`), a static handler returning 200 the instant Express listens; the platform ALSO runs a generic port-readiness probe against the service root `/api` (no route → 404 when healthy) which logs a brief cluster of `healthcheck /api returned status 500` during autoscale COLD START before the port settles — that is benign noise, not a live error. Treat only steady-state (post-boot) 5xx/Exception log lines as real.

## Moyasar money recovery (callback + webhook + reconciler)

A paid Moyasar purchase is granted by THREE paths that ALL funnel through one
shared activator `services/payments/activate.ts → activateVerifiedPayment(verified)`:
1. browser callback `/payments/moyasar/callback` (also asserts the authed user
   matches `metadata.userId` — stolen payment id can't grant to someone else here),
2. public webhook `POST /payments/moyasar/webhook`,
3. periodic reconciler `services/payments/reconcile.ts`.

**Rules (don't regress):**
- Grant is anchored to Moyasar-**verified** `metadata.userId` (re-verified via
  `verifyPayment`), NEVER the request body/session. Webhook/reconciler grant to the
  ORIGINAL buyer (no session); never trust webhook body for money truth.
- Subscription branch takes TWO advisory locks in fixed order: per-reference THEN
  `moyasar:user-edition:${userId}:${edition}` — serializes both same-reference
  replays AND payment-id-vs-invoice-id first-time races. Plus a monotonic
  never-downgrade guard vs the CURRENTLY active plan price (FOR UPDATE). Partial
  unique (user,edition,active) index is the final backstop.
- Webhook: 503 if `MOYASAR_WEBHOOK_SECRET` unset or payments unconfigured;
  timing-safe (`timingSafeEqual`) compare of body.secret_token → 403 on mismatch;
  200 `{received,activated}` for everything else INCLUDING unpaid/missing-id/errors
  so Moyasar doesn't retry-storm. Never logs the token.
- Reconciler is **schema-less** (deliberate — no tombstone table): lists recent
  invoices (`listRecentInvoices`), skips non-paid + older-than-lookback, derives
  reference `paidPaymentId ?? invoiceId` (prefer payment id so it matches the
  callback's recorded reference → `referenceAlreadyRecorded` short-circuits without
  a verify call), re-verifies, delegates to the activator. Bounded by
  `MOYASAR_RECONCILE_PAGES` (≤20) + `_LOOKBACK_MS`; self-scheduling (no overlap),
  best-effort (never throws, never blocks boot), no-op when payments unconfigured.
  Bootstrapped in index.ts after the match scheduler.

**Known minor caveat (intentionally NOT fixed):** an already-active equal/lower
purchase returns `activated:true` without recording the new reference, so a
DIFFERENT-reference duplicate (rare: invoice-id when callback recorded payment-id)
re-verifies every pass until it ages out. Harmless (idempotent, bounded); fixing it
would need a processed-reference tombstone, which breaks the schema-less design.

**Tests:** `test/paymentsCallback.e2e.ts` (proves callback unchanged after the
activator extraction) + `test/paymentsWebhookReconcile.e2e.ts` (webhook gating +
happy/replay, reconciler payment-id path, idempotency, invoice-id fallback). Both
run via plain `tsx` (no `--test`) so stub `globalThis.fetch` for api.moyasar.com
(list endpoint `/v1/invoices?page=` must be matched BEFORE `/v1/invoices/:id`); seed
local users with fake clerkUserId (webhook public, activator only does DB lookup).

## Clerk FAPI proxy resilience (clerkProxyMiddleware)

`src/middlewares/clerkProxyMiddleware.ts` reverse-proxies `/api/__clerk/*` →
Clerk Frontend API (only when `NODE_ENV==="production"` && `CLERK_SECRET_KEY`
set; no-op otherwise). It is built on `http-proxy-middleware` v4, whose engine is
**httpxy** (NOT node-http-proxy).

**Why bare-500s happened:** without an `on.error` handler, http-proxy-middleware
emits a bare `500 text/plain "Internal Server Error"` whenever the upstream
connection to Clerk blips — landing OAuth-callback users on a raw error page mid
sign-in. Apple is hit hardest: it uses `response_mode=form_post` (a top-level
**POST** navigation), more fragile than Google's GET redirect.

**The non-obvious httpxy constraint (drove the whole retry design):** httpxy
ALWAYS pipes the client `req` into the upstream request — `(options.buffer ||
req).pipe(proxyReq)` — and finishes the upstream request only on the source
stream's `'end'` event. So once the upstream socket has connected (body stream
consumed), re-invoking the middleware to "retry" produces an upstream request
that NEVER gets `.end()`ed → it **HANGS until `proxyTimeout`**. Therefore:
- **Retry is safe ONLY for pre-connect errors** (`ECONNREFUSED`, `ENOTFOUND`,
  `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`) where the socket never connected and
  the body was never piped. Idempotent methods only (GET/HEAD/OPTIONS), max 2
  retries, 100/200ms backoff, **never the Apple POST**.
- **Post-connect errors** (`ECONNRESET`/`ETIMEDOUT`, incl. stale keep-alive
  sockets) are NOT retried — they degrade straight to the graceful fallback.

**Graceful fallback:** browser navigations (detected via `Sec-Fetch-Mode:
navigate`, falling back to `Accept: text/html` or an `oauth_callback` URL
pattern) get a **relative** `302 Location: /sign-in?auth_error=connection`
(relative so it stays on the canonical client host incl. custom domains); XHR/
fetch get `503 {error:"clerk_upstream_unavailable"}`. `isResponseWritable`
(headersSent/writableEnded/destroyed) guards every write; the retry timer
re-checks writability + `req.destroyed` before spending another attempt.

**Keep-alive caveat:** a keep-alive `https.Agent` + `proxyTimeout` 30s reuses
upstream connections (protocol-aware: only attached when the target is https).
Watch post-deploy for stale-socket `ECONNRESET` on POST callbacks — these aren't
retried but now degrade to the sign-in redirect instead of a bare 500.

**Test seam is a security boundary:** `CLERK_FAPI_URL` overrides the target for
tests, but is honoured **ONLY when it points at loopback** (127.0.0.1/localhost/
[::1]) — every proxied request carries `Clerk-Secret-Key`, so a non-loopback
value (prod misconfig) must never redirect the secret to an arbitrary host; it's
ignored in favour of the real endpoint. `getClerkProxyHost` export unchanged.

**Tests:** `test/clerkProxy.test.ts` (pre-connect ECONNREFUSED: XHR→503 after
retry backoff ≥250ms & no hang, nav GET→302, nav POST→302 NOT retried ~10ms) +
`test/clerkProxyReset.test.ts` (post-connect ECONNRESET via a local server that
accepts-then-destroys: GET→503 & POST→302, both fast, no retry/hang). Both run
via `tsx --test` as separate processes (fresh module + env) and are wired into
the api-server `test` script. Timing is the assertion that proves retry-vs-no-retry.

## Clerk proxy failure observability (monitoring)

Production Clerk-proxy sign-in failures are made durable + alertable two ways:

1. **Durable aggregation:** every real upstream failure is recorded into
   `analytics_events` with `type = clerk_proxy_error`, metadata
   `{code, willRetry, method, degraded}`. Deployment is `autoscale` (multi-instance)
   so in-memory counters are unsafe — persisting to the DB is the only cross-instance
   source of truth. `computeClerkProxyMetrics(windowDays)` aggregates byCode /
   byWillRetry / byMethod / daily / degradedCallbacks; admin endpoint
   `GET /analytics/clerk-proxy`, rendered on the admin Analytics page.
   Recording is **gated off the loopback test seam** (`CLERK_FAPI === default`) so
   unit tests stay DB-free.

2. **Log-based alert:** `degraded` = un-retryable ECONNRESET on Apple's `form_post`
   POST callback (browser-navigation POST that can't be safely replayed). Each one
   emits a severity-elevated log line `event=clerk_proxy_callback_degraded`
   ("ALERT clerk proxy callback degraded …"); configure a deployment log-alert on
   that field (baseline ~0/hr). **Next lever** when it spikes: tune/disable the
   proxy keep-alive pool (`keepAliveAgent`) — stale pooled sockets are the cause.
   See HEALTHCHECK.md "Sign-in failure monitoring".

**Daily-bucket off-by-one (general):** a daily-trend loop anchored on
`since = now - windowDays` that iterates `d < windowDays` ends at *yesterday* —
today's data (the day you care about right after a deploy) silently drops. Iterate
calendar days from the window-start date THROUGH today (inclusive) instead.

3. **Retention pruning:** `clerk_proxy_error` rows would otherwise grow forever.
   `startClerkProxyErrorPruner()` (boot, in `lib/analytics.ts`, next to the Moyasar
   reconciler in `index.ts`) is a self-scheduling best-effort timer (first pass ~60s
   after boot, then daily) that `pruneClerkProxyErrors()` deletes rows older than
   retention. **Retention floor = `MAX_ANALYTICS_WINDOW_DAYS` (365)** — the same
   constant the three admin analytics route caps clamp `?days=` to (kept in lockstep);
   retention can be RAISED via `CLERK_PROXY_ERROR_RETENTION_DAYS` but never below the
   max queryable window, or pruning would silently truncate a valid breakdown. No
   advisory lock (the type+age DELETE is idempotent and races harmlessly across
   autoscale instances).

**Analytics enum lives in source but dev DB may lag:** `clerk_proxy_error` (and
`page_view`) are in `analyticsEventTypeEnum` (schema source) but the dev DB enum can
be missing them (schema pushed only on Publish), so inserting that `type` fails with
`22P02 enum_in`. Fix dev locally with `ALTER TYPE analytics_event_type ADD VALUE IF
NOT EXISTS '…'` (drizzle push prompts interactively); prod gets it on deploy.

## Apple Sign-In "Unable to complete action" in prod = Auth-pane OAuth creds, NOT code
"Unable to complete action at this time. If the problem persists please contact support."
on **Apple** sign-in only in the **published** app is a Clerk **configuration** problem,
not a proxy/code bug. Replit-managed Clerk uses Clerk's shared dev OAuth credentials in
development (so Apple "just works" in preview) but **production requires the app's OWN
Apple credentials** (Team ID, Services ID, Key ID, `.p8` private key) entered in the
**Auth pane → Production**, with the prod domain + the Auth-pane return URLs registered in
the Apple Developer portal (and Apple Private Email Relay if used). Google/email can work
while Apple fails for exactly this reason.
**Why:** Apple won't honor Clerk's shared dev OAuth app on a custom/prod domain.
**How to diagnose (don't guess at the proxy):** prod logs show the proxy passing the flow
cleanly — `POST /api/__clerk/v1/client/sign_ins` 200 → `POST /v1/oauth_callback` 303 →
`GET /v1/oauth_callback` 303 → `environment`/`client` 200 → back to `sign_ins` 200, with
**zero** 5xx/`clerk_proxy_*` fallbacks. When client/environment GETs are 200 but the
cookie-setting OAuth callback round-trip dead-ends, look at provider creds in the Auth
pane, not `clerkProxyMiddleware` (whose `proxyReq` header handling is byte-identical to
the skill template — neither rewrites Set-Cookie/Location). Agent cannot fix this; the
user must enter credentials in the Auth pane. Do NOT push them to dashboard.clerk.com.
**Get the exact Clerk reason from the browser, not server logs:** our proxy logs only show
status codes; Clerk's failure reason lives in the `client` GET response body under
`sign_in.first_factor_verification.error {code, message, long_message}` (DevTools → Network →
enable "Preserve log" so the Apple redirect doesn't wipe it). Two distinct failure modes:
(a) `first_factor_verification` stays `null` and you only ever get back `needs_identifier` →
Apple never accepted the round-trip (portal Domains/Return-URLs not saved through Apple's
Next→Done→Continue→**Save** chain); (b) `verification_oauth` with
`error.code = "oauth_token_exchange_error"` + long_message `client secret generate:
pki/LoadPublicKey: parse error ... pkcs1PrivateKey / asn1 tags don't match` → the **`.p8`
private key** pasted into the **"Apple OAuth client secret"** field is malformed (Replit/Clerk
takes the raw PKCS#8 `.p8` and generates the Apple JWT itself; it is NOT a pre-made secret).
Fix (b) — THE WORKING FIX: the Auth-pane "Apple OAuth client secret" field is **single-line**
and FLATTENS pasted newlines into spaces, turning the PEM into
`-----BEGIN PRIVATE KEY----- <body> -----END PRIVATE KEY-----` on one line — that space-mangled
armor is what breaks PEM decode and produces the `oauth_token_exchange_error` /
`pki/LoadPublicKey: parse error`. Do NOT paste the full PEM. Paste the **base64 body ONLY, with
NO `-----BEGIN/END PRIVATE KEY-----` lines** (Replit/Clerk adds the armor itself). Tell-tale:
user reports a space "between the dashes and the body". Confirm **Key ID** matches the
`AuthKey_<KEYID>.p8` filename + Team ID set. `.p8` downloads only once — if lost, create a NEW
key in Apple → Keys, update both the key contents and the Key ID. Prod creds go live ONLY on
**Publish**. The redirect_uri + client_id echoed in that same `error` block confirm
Services ID/return-URL are correct, so when you see the parse error, stop re-checking the portal
and fix the key. **Verify success in prod logs**: a real `client/sessions/sess_.../tokens 200`
must appear AFTER the Apple `oauth_callback` (the failure signature is oauth_callback with NO
subsequent session-token call).

## Season-pass test determinism & live-DB smoke false positives
**Rule:** Season-pass DB-derived assertions must NOT read the live `tournaments` table directly — the sync scheduler mutates it continuously (e.g. attaches off-season leagues a coarse window that can outrank the WC's precise window at a pre-season date, flipping nearest-upcoming). Test the selection policy against FIXED fixtures via the pure `pickCurrentSeasonFromWindows(rows, now)` (in `passSeason.ts`).
**Rule:** A live-DB integration smoke whose expected value equals the calendar/static fallback is a FALSE POSITIVE — it passes even when the DB-derived path returns null. Assert a value that DIFFERS from the fallback, e.g. insert a temp far-future tournament row (competition-slug-less ⇒ exempt from `tournaments_active_competition_idx`) and assert its slash-season canonicalizes to `season_YYYY_YY` ≠ calendar `season_YYYY`; clean up in-test (e2e `check()` records without throwing, so the delete always runs).
**Why:** An architect review caught the Jun-19-2026 WC smoke as a no-op (fallback==expected); the pre-season flake was a scheduler race, not a policy bug.

## Web competition/season scoping (multi-competition transform)
The thaddi web app is multi-competition + season-aware via `src/lib/competition.tsx` (CompetitionProvider/useCompetition), mounted **inside** QueryClientProvider but **outside** Clerk — it is public, so the signed-out landing must load competitions (backed by `useGetCompetitions`). Smart default = lowest-`displayOrder` **actionable** competition (`isActionable` = `currentSeason && hasPublishedFixtures && !comingSoon`); persists `thaddi:competition:v1` + `thaddi:seasonByCompetition:v1` (jsdom-safe try-catch). `selectedSeason` now resolves a VALID persisted per-competition override else `currentSeason` else `availableSeasons[0]`; a stale/invalid override is IGNORED without rewriting storage, and `setSeason(currentSeason)` CLEARS the override so a competition auto-follows its current season on rollover (only PAST seasons stay pinned).
- `comingSoon` from context is keyed off the **selected** season: a past season always has a published board (never coming-soon), while the current season is coming-soon when missing or `currentSeason.comingSoon`. **Missing currentSeason MUST still count as coming-soon** (lockstep with the landing `CompetitionCard`'s `!comp.currentSeason || comp.currentSeason.comingSoon`).
- Public `Competition` DTO carries an additive `seasons[]` (beside `currentSeason`) = `listCompetitions` group rows where `hasPublishedFixtures && season != null`, most-recent-first (`bySeasonRecency`: startDate desc → endDate desc → season desc), mapped via the SHARED `toSeasonDto` (currentSeason uses it too so they never drift); coming-soon shells ⇒ empty `seasons`. The ranking endpoint already accepts `?season=`; the picker just supplies the keys. Both contexts expose `availableSeasons`; the switcher shows the season list only when `availableSeasons.length > 1` OR the effective season isn't in the published list. Generated `CompetitionSeason.season` is OPTIONAL (`string|null|undefined`) → coerce `?? null` at every call site. Mobile (`artifacts/thaddi-mobile/lib/competition.tsx` + its switcher) mirrors this 1:1 (BottomSheet + ltrIsolate for Latin season numbers); web season numbers use `dir="ltr"` spans; i18n `competition.currentSeasonBadge` (ar الحالي / en Current) added on both.
- Every scoped read (`useGetMatches`/`useGetCompetitionRanking`/`useGetUpcomingMatches`/`useGetSchedule`) MUST gate `enabled: isReady && !!selectedSlug && !comingSoon`, include the scoped params in `queryKey`, AND render a coming-soon/empty state. `!!selectedSlug` is the guard that prevents an **unscoped** query when the public competitions list is empty/errored (selectedSlug null while comingSoon false).
**Why:** review caught disabled-query empty flashes + unscoped queries firing when signed-out / competitions empty.

## Challenge creation has NO competition/season (backend gap)
Merged backend has no `competitionSlug`/`season` on `CreateChallengeBody` and no PUBLIC tournament/season listing endpoint (only admin `/admin/tournaments`); the challenge row has no competition column. So multi-competition challenges can't be threaded from the web without first extending the backend — do not fabricate client fields (a selector the backend ignores). Needs a backend task before any web challenge-create competition picker.

## api-server has NO typecheck validation — only e2e (run via tsx) guards DTO shapes
There is no registered `tsc` validation for `artifacts/api-server`; its e2e suites run via plain `tsx`, which transpiles WITHOUT typechecking. So a missing REQUIRED field on a response DTO compiles, runs, and is caught ONLY if an e2e explicitly asserts it. A concurrent-task merge reconciliation once silently dropped an additive DTO field from a function-body `out.push(...)` while keeping the `interface` declaration + unused helper functions — nothing failed until the e2e `.map`-crashed on the `undefined` field.
**How to apply:** when adding a required field to an api-server response DTO, ALWAYS back it with an e2e assertion; after any merge, re-verify additive fields you added are still wired in the EMITTING function body, not just declared on the interface.

## Match-detail prediction stepper is dir-locked to the header
The web match-detail prediction grid (`artifacts/thaddi/src/pages/match-detail.tsx`) is forced `dir="ltr"` so its 3 columns (home / center / away) line up left-to-right with `MatchHeader`'s team order. The rest of the page mirrors under RTL, but this one grid must NOT — flipping it puts the home stepper under the away crest.
**Why:** the stepper and the header are two separate components; only a shared PHYSICAL order keeps "the box under each team is that team's prediction." The `rtl` guard does NOT scan `dir` attributes, so deleting this `dir="ltr"` while "fixing RTL" silently breaks the alignment with NO guard failure. Labels/numerals inside the grid still localize via the normal i18n path.
**How to apply:** keep `dir="ltr"` on the prediction grid; never revert it to `dir`-driven. Related UX convention from the same task: the `/matches` tab list (web `match-center.tsx` + mobile `matches.tsx`) is ordered Live → Upcoming → Ended/Finished → All and DEFAULTS to Live; an empty Live list shows `matches.emptyLive` plus an action (testid `button-empty-live-upcoming`) that switches the active tab/scope to Upcoming. The mobile ranking screen mirrors web `/ranking` (global/challenge toggle, "your rank" GlowCard + WhatsApp share, top-3 award badges, accuracy/exact/movement/points) — the old podium is gone, don't reintroduce it.
