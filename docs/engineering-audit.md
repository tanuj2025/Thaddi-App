# THADDI — Full Engineering Audit
*Date: 19 July 2026 · Scope: web app, iOS/Expo mobile app, API server, database, auth, deployment, production. All findings are grounded in code inspection, test runs, log evidence, and read-only queries against dev and production. Where something could not be verified, it is stated explicitly.*

---

# 1. Executive Summary

| Metric | Value | Basis |
|---|---|---|
| **Overall completion** | **~92%** | Every planned module exists and works end-to-end; gaps are Android release, push notifications, real-time chat, and a few backend/quality items listed below. |
| **Production readiness** | **~90%** | Production is live and healthy today: probe against `https://thaddi.app/api` passed 7/7 checks (56 users, 13 challenges, 1,254 predictions, 104 WC matches synced). |
| **Development readiness** | **~95%** | All four validation suites pass in dev (backend regression, web i18n, RTL guard, mobile jest — 26/26). Dev sign-in "failure" is expected environment isolation, not a defect (see §5/§16). |
| **Technical debt** | **~12%** | Low. Zero TODO/FIXME comments in app code. Debt items: no `tsc` gate on api-server, 3 web type errors in vendored UI components, a few oversized files, `drizzle-kit push` instead of versioned migrations, polling instead of WebSockets. |
| **Estimated remaining work** | 2–4 weeks to "fully polished production", driven mostly by push notifications + Android release. | See §14. |
| **Critical blockers** | **None for the live product.** The dev sign-in issue is by-design (isolated dev user store). | — |

---

# 2. Web Application Status (`artifacts/thaddi`, ~26,900 lines)

Modules mapped from the actual router (wouter) in `src/App.tsx`:

| Module | Status | % | Evidence |
|---|---|---|---|
| Authentication (custom Clerk sign-in/up, forgot password, SSO callback) | Completed | 100 | `/sign-in`, `/sign-up`, `/forgot-password`, `/sso-callback`; custom UI on Clerk "Future" API |
| Onboarding & activation gate (profile → mobile OTP → favourite team) | Completed | 100 | `/onboarding`, `/verify-mobile`, `/pick-team`, `/pick-club`; 22/22 activation regression checks pass |
| Landing & public pages (terms, privacy, support, legal) | Completed | 100 | `landing.tsx` (1,057 lines), static pages, i18n-clean |
| Home dashboard | Completed | 100 | `/home` with live data cards |
| Match center (list, detail, prediction, trends, live status) | Completed | 100 | `/matches`, `/matches/:id`; predictions lock at kickoff |
| Challenges (create, join, discover, chat, manage, delete) | Completed | 100 | `/challenges/*`, `/join/:code` |
| Rankings & Hall of Fame | Completed | 100 | `/rankings` hosts both; `/hall-of-fame` redirects to `/rankings` (Hall of Fame content lives inside the rankings page) |
| Social (friends, follows, public player profiles, privacy) | Completed | 100 | `/social`, `/players/:userId` |
| Notifications (in-app feed) | Completed | 100 | `/notifications` |
| Profile & account (edit, change team/club, delete account) | Completed | 100 | `/profile` |
| Billing / pricing (Moyasar checkout, season pass, badges) | Completed | 95 | `/pricing`; 38/38 season-pass regression checks pass; payment UX depends on live Moyasar keys (configured) |
| Admin panel (tournaments, matches, teams, users, plans, subs, badges, audit logs, analytics, demo harness) | Completed | 100 | `/admin/*`; admin-panel regression suite passes |
| Search / filter / pagination | Completed | 90 | Search in team/club pickers & schedule; pagination in admin tables; no global site-wide search (not planned) |
| Theme / dark mode | Completed | 100 | Single "dark premium stadium" theme by design (forced dark) |
| i18n / RTL (Arabic-first) | Completed | 100 | Both guardrails pass: key parity + no hardcoded English; no physical directional classes |
| Not-planned modules from the template list (Messages/Documents/CRM/AI Chat/Contacts/Companies/Tasks/Calendar/Files) | N/A | — | Not part of this product; challenge chat covers "messages" |

Minor dead code: `src/pages/placeholder.tsx` is defined but unrouted.

---

# 3. Mobile Application Status (`artifacts/thaddi-mobile`, ~16,200 lines, Expo/iOS live)

Overall mobile completion: **~90%** (feature-complete for iOS App Store scope; push notifications and Android absent).

| Screen | UI | Backend connected | API working | Prod ready | Missing |
|---|---|---|---|---|---|
| Intro / sign-in / sign-up / forgot-password `(auth)` | ✅ | ✅ (@clerk/expo) | ✅ | ✅ | — |
| Onboarding / verify-mobile / pick-team / pick-club `(activation)` | ✅ | ✅ | ✅ | ✅ | — |
| Home (tabs/index) | ✅ | ✅ (5 generated hooks) | ✅ | ✅ | — |
| Matches list | ✅ | ✅ | ✅ | ✅ | — |
| Match detail + prediction (`match/[id]`) | ✅ | ✅ | ✅ | ✅ | — |
| Challenges (mine + discover) | ✅ | ✅ | ✅ | ✅ | — |
| Challenge create (`challenge/create`) | ✅ | ✅ | ✅ | ✅ | — |
| Challenge detail + chat (`challenge/[id]`) | ✅ | ✅ | ✅ | ✅ | Chat is 15s polling, not real-time |
| Challenge manage (owner tools) | ✅ | ✅ | ✅ | ✅ | — |
| Rankings | ✅ | ✅ | ✅ | ✅ | — |
| Profile (stats, badges, subs history, delete account) | ✅ | ✅ | ✅ | ✅ | Sub history read-only by Apple rule (intentional) |
| Paywall (RevenueCat IAP) | ✅ | ✅ | ✅ | ✅ | Includes Restore Purchases |
| Player profile (`players/[id]`) | ✅ | ✅ | ✅ | ✅ | — |
| Notifications | ✅ | ✅ | ✅ | ✅ | In-app only; **no push** |
| Join deep link (`join/[code]`) | ✅ | ✅ | ✅ | ✅ | — |
| Social (friends) | ✅ | ✅ | ✅ | ✅ | Player discovery limited to rankings/challenges |
| Not-found fallback | ✅ | — | — | ✅ | — |

Jest smoke suite: **26/26 tests pass** (run today).

---

# 4. Backend Status (`artifacts/api-server`, ~19,800 lines)

| Area | Verdict | Notes |
|---|---|---|
| API endpoints | ✅ Completed | 15 route files: account, challenges, matches, rankings, gamification, social, notifications, payments, plans, verification, analytics, announcements, platform, health, admin. All mounted at `/api`, spec-first via OpenAPI |
| Controllers/services | ✅ Completed | football (multi-provider sync), scoring engine, payments (Moyasar + RevenueCat), notifications (in-app + Resend email), SMS OTP (Authentica), social, demo harness |
| Database | ✅ Completed | 40 tables in dev (read-only query); see §9 |
| Authentication | ✅ Completed | Clerk middleware + JIT user provisioning with 3-state identity safety; FAPI proxy with degrade paths |
| Authorization | ✅ Completed | Role (admin) + state (activated) gating; entitlement gating before challenge writes; audit logging |
| Validation | ✅ Completed | Zod on every write body (shared `@workspace/api-zod` generated from the spec) |
| Error handling | ✅ Completed | Consistent 4xx semantics; non-fatal boot steps; webhook never 5xx-storms |
| Logging | ✅ Completed | Pino structured logs, sensitive headers redacted |
| Queue | ❌ Absent (acceptable) | In-process schedulers + opportunistic on-read refresh (correct for Replit autoscale) |
| Email | ✅ Completed | Resend transactional email |
| Storage / file upload | ❌ Absent | No avatar upload; avatars are URL-based. Add only if product needs it |
| WebSockets | ❌ Absent | Chat/live data use polling — a deliberate autoscale-friendly tradeoff |
| AI services | ❌ Absent | Not part of the product |
| Third-party integrations | ✅ Completed | Clerk, Moyasar, RevenueCat, ESPN (pinned prod provider; keyless), football-data/Sportmonks fallbacks, Authentica SMS, Resend |
| Needs improvement | ⚠ | No `tsc` typecheck in validation (e2e via tsx compiles without typechecking); build bundle is 3.2 MB (fine for server-side, worth watching) |

Backend regression suites (run today, all green): activation flow 22/22, OTP 15/15, season pass 38/38, live-refresh wrapper 9/9, Clerk proxy metrics/prune e2e OK.

---

# 5. Authentication Analysis — why production sign-in works but development sign-in fails

**Root cause found. It is not a bug — it is environment isolation in Replit-managed Clerk.**

**Current configuration (verified):**
- The project uses **Replit-managed Clerk** (management status check returned `managed`).
- **Development** runs with `CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` = `pk_test_…` and `CLERK_SECRET_KEY` = `sk_test_…` (verified in the dev shell environment). The browser console confirms: *"Clerk has been loaded with development keys."*
- **Production** runs with live keys — the shared `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is `pk_live_…` decoding to the production Clerk domain **clerk.thaddi.app**, and Replit swaps the web/server keys to live automatically on publish.

**Expected configuration:** exactly this. Per the Replit-managed Clerk contract, *development and production are two isolated Clerk instances with separate user stores — accounts do not cross over*, and `pk_test` keys in development are explicitly documented as correct, not something to "fix".

**Problem:** the account you sign in with was created on the **production** instance (thaddi.app). When you try the same email in the **development** preview, Clerk's development instance has no such user, so it returns `form_identifier_not_found` → the UI shows **"Couldn't find your account."** Every other layer was traced and is healthy. Note that the Clerk FAPI proxy middleware is **production-only by design** (it returns early when `NODE_ENV !== "production"`, because Clerk proxying doesn't work for dev instances) — so in development the browser talks to Clerk's dev instance directly, which works and is not part of the failure. Cookies/redirects/JWT validation are environment-internal, and dev API auth works (the test suite mints dev Clerk sessions successfully).

**Solution:**
1. In the development preview, **sign up once** to create a dev-only test account (dev instances have relaxed flows and usage limits meant exactly for this), or create users from the workspace **Auth pane**.
2. Never copy production credentials into dev — the separation is intentional and protects your 56 real production users.
3. No code, key, or config change is needed. Any attempt to point dev at the live instance would be wrong and risky.

---

# 6. Environment Comparison (Development vs Production)

| Dimension | Development | Production | Impact |
|---|---|---|---|
| Clerk keys | `pk_test`/`sk_test` (dev instance, isolated user store) | `pk_live`/`sk_live` → clerk.thaddi.app | **The dev sign-in "failure"** (§5) |
| Users | 77 test users (dev DB) | 56 real users | Separate populations by design |
| Database | Dev Postgres (`DATABASE_URL`, 40 tables) | Separate prod Postgres, same schema (schema synced on publish, data not) | Reference data seeded idempotently on boot in both |
| API URL | Replit dev domain `/api` | `https://thaddi.app/api` | Same code path; web is same-origin via proxy in both |
| Football provider | `FOOTBALL_PROVIDER=espn` (shared) | Same (shared) | Identical |
| Payments | Moyasar **live** keys are global secrets | Same | ⚠ Dev checkout uses live Moyasar — avoid test purchases in dev (see §15) |
| Mobile env | Expo dev points at dev domain, but `EXPO_PUBLIC_*` shared vars pin **prod** (thaddi.app + pk_live) for native builds | Native builds embed shared vars | Intentional: shipped app always talks to prod |
| Demo harness | Enabled by default outside prod | `DEMO_HARNESS_PROD_ENABLED=true` explicitly set (prod-scoped var) | Admin-only, tagged-row isolated |
| Build | Vite dev server / esbuild watch | Vite build + esbuild bundle, autoscale deployment | Prod cold-start compensated by opportunistic on-read sync |
| Cookies/headers | Dev-instance Clerk cookies on the dev domain | `__client` etc. on thaddi.app; `trust proxy` set for real IPs | No cross-domain leakage |

Other shared config: `THADDI_APP_URL`, `NOTIFICATIONS_FROM_EMAIL`, RevenueCat project/app IDs, `REVIEWER_EMAILS`, `BOOTSTRAP_ADMIN_EMAILS`.

---

# 7. Feature Completion Matrix

| Feature | Status | % | Prod ready | Remaining work |
|---|---|---|---|---|
| Auth & activation gate | Complete | 100 | ✅ | — |
| Predictions & scoring (3/1/0) | Complete | 100 | ✅ | — |
| Live match sync (ESPN, multi-competition) | Complete | 100 | ✅ | Domestic leagues auto-activate when fixtures publish |
| Challenges & shared participant pool | Complete | 100 | ✅ | — |
| Challenge chat | Complete | 90 | ✅ | Polling → real-time (optional) |
| Rankings, Hall of Fame, movement | Complete | 100 | ✅ | — |
| Gamification (levels, badges, achievements) | Complete | 100 | ✅ | — |
| Social graph & public profiles | Complete | 100 | ✅ | Broader player search (optional) |
| Season pass (Moyasar web) | Complete | 100 | ✅ | — |
| IAP (RevenueCat iOS) | Complete | 100 | ✅ | — |
| Challenge badges (cosmetic, paid) | Complete | 100 | ✅ | Excluded on iOS by design |
| Admin panel + audit | Complete | 100 | ✅ | — |
| Analytics (page views, funnel, geo/device) | Complete | 100 | ✅ | — |
| Notifications — in-app + email | Complete | 100 | ✅ | — |
| Notifications — mobile push | Not started | 0 | ❌ | expo-notifications + token registry + send pipeline |
| Android app | Not started | 0 | ❌ | RevenueCat Android key exists; needs build + Play submission |
| Business/enterprise tier | Placeholder | 10 | — | Seeded as "coming soon"; deliberate |
| Avatar upload | Not started | 0 | — | Optional; needs object storage |

---

# 8. API Health

- **Working:** all production endpoints probed today returned healthy (healthz, platform-stats, feature-flags, plans, teams, schedule, upcoming-matches — 7/7). Dev server logs show only 2xx/304 across competitions, rankings, matches, analytics. Authed flows verified by regression suites (account, OTP, predictions, challenges, admin, payments, season pass).
- **Broken:** none found in the endpoints exercised by the probes, logs, and regression suites; endpoints outside those paths were reviewed by code inspection only.
- **Unused:** none identified; the OpenAPI spec is the codegen source, so client and server stay in lockstep. (Assessed by spec/code cross-reference, not runtime traffic analysis.)
- **Missing:** device-token registration endpoint (needed only when push notifications are built); challenge-create lacks a competition selector field (known backend gap — challenges currently bind to the active competition).
- **Deprecated:** dormant prediction enum values (`goal_difference`, `submitted`) kept intentionally at 0 points to avoid a migration; `TOURNAMENT_EDITION` env superseded by `PASS_SEASON_KEY` (handled with aliases).

---

# 9. Database (Drizzle ORM / PostgreSQL, 40 tables verified in dev)

- **Tables & relations:** users/profiles (1:1 cascade), account_deletions tombstones, tournaments→stages→matches→predictions (+history, points_ledger, rankings snapshots), challenges (+participants, assistants, messages, message_reports, join requests, badge catalog), plans/plan_entitlements/subscriptions, badges/achievements/levels, follows/friendships (canonical pair constraint), notifications, feature_flags, mobile_verifications, audit_logs, analytics_events.
- **Constraints:** strong — unique clerkUserId/mobileNumber/inviteCode/displayName/username; composite uniques on (challenge,user), (user,match), (planId,key); partial unique for one active pass per user per season; one-active-season-per-competition index; FK cascade/set-null policies deliberate (earned achievements preserved on challenge delete).
- **Indexes:** present on hot paths (email, favourite teams, team code/kind, scoring watermark `scoredAt`).
- **Migrations:** `drizzle-kit push` (schema-sync), no versioned migration files — acceptable at this stage, a risk as the team grows (see §15).
- **Seed data:** idempotent `seedReferenceData()` runs on every boot, insert-only (`onConflictDoNothing`) — safe for prod (verified in `artifacts/api-server/src/index.ts`).
- **Unused/missing tables:** none unused; a `device_push_tokens` table will be needed for push.
- **Known nuance:** Hall-of-Fame historical duplicate awards exist in prod (NULL-tolerant unique); handled by deduped reads + advisory-lock writes rather than a destructive index.

---

# 10. Frontend Audit (web)

| Check | Verdict |
|---|---|
| Routing | wouter, clean public/protected split with activation gate |
| Lazy loading | ⚠ Pages imported statically (no `React.lazy`); acceptable bundle today, worth code-splitting the admin panel |
| State management | TanStack Query (server state) + contexts (i18n, theme, competition, direction) — appropriate |
| Caching | Query cache + 304/ETag from API (visible in logs) |
| Forms & validation | react-hook-form + zod resolvers |
| Performance | Good; largest page files (challenge-detail 1,616 lines, landing 1,057) could be split |
| Accessibility | Radix primitives baseline + explicit aria labels; localized sr-only text |
| Responsive | Mobile-first Tailwind throughout |
| Error boundaries | ⚠ Relies on query error states + toasts; no top-level React error boundary on web (mobile has one) |
| Loading states / skeletons | Extensive skeleton components |
| Search / filtering / pagination | Present where the product needs them |
| Dark mode / theme | Single forced dark theme by design |
| Type safety | ⚠ 3 `tsc` errors (a `title` prop on a lucide icon, and 2 React-19 duplicate-@types issues inside vendored `ui/` components); Vite builds ignore them |

---

# 11. Mobile Audit

| Check | Verdict |
|---|---|
| Navigation | expo-router stack + custom RTL-aware tab bar — solid |
| Performance | Generated hooks + query caching; no reported jank |
| Offline support | ⚠ Minimal (query cache only, no NetInfo/queueing) — acceptable for a live-data product |
| Push notifications | ❌ Absent (biggest mobile gap) |
| Camera | Not used (no feature requires it) |
| Permissions | Only what's needed; nothing over-requested |
| Storage | AsyncStorage for language, intro flags, competition, pending join codes |
| Deep linking | ✅ `thaddi` scheme + join-code stash across auth |
| Authentication | ✅ @clerk/expo bearer tokens bridged into the generated client, cache cleared on sign-out |
| API calls | ✅ 100% generated client (spec-driven) |
| Error handling | ✅ Global ErrorBoundary + per-screen retryable error states |

---

# 12. Code Quality

- **Dead code:** minimal — unrouted `placeholder.tsx` (web); mock football provider is a legitimate dev seam.
- **Unused components:** none material found.
- **Duplicate logic:** guarded deliberately (prediction-reveal rule computed in 2 endpoints kept in lockstep; scoring "pending" predicate in 3 places — documented invariants).
- **Large files:** `i18n.tsx` 2,564 (dictionary — fine), `admin.ts` 2,415, `challenges.ts` 2,335, `challenge-detail.tsx` 1,616 — candidates for splitting.
- **Memory leaks:** none observed; long-running dev server stable across hours of logs.
- **Performance issues:** none observed; 304 caching working.
- **Security risks:** strong posture — webhook constant-time secret compare, server-side payment verification, advisory-lock atomicity, admin+audit gating, privacy filters on public boards, redacted logs. No secrets in code (all in Replit secrets manager).
- **TypeScript errors:** web 3 (above); **api-server has no typecheck step at all** — a real gap since e2e runs via tsx without typechecking.
- **ESLint:** no lint validation registered.
- **Build warnings:** esbuild bundle-size warnings only (3.2 MB server bundle); Expo notes one minor package version drift (`expo@54.0.35` vs expected `~54.0.36`).
- **TODO/FIXME count in app code: 0.**

---

# 13. Production Readiness Checklist

| Item | Rating |
|---|---|
| Authentication | ✅ Ready |
| Authorization | ✅ Ready |
| Security | ✅ Ready |
| Performance | ✅ Ready (autoscale-aware refresh design) |
| Logging | ✅ Ready (structured, redacted) |
| Monitoring | ⚠ Needs work — health probe + Clerk-proxy error analytics exist, but no external uptime alerting |
| Analytics | ✅ Ready |
| Testing | ✅ Ready (4 suites green today) / ⚠ no CI trigger outside the workspace |
| Error handling | ✅ Ready |
| Validation | ✅ Ready (Zod everywhere) |
| Deployment | ✅ Ready (live on thaddi.app, publish flow proven) |
| CI/CD | ⚠ Needs work — validations run in-workspace, not on an external pipeline |
| Documentation | ✅ Ready (HEALTHCHECK.md, RTL_CONTRACT.md, product brief, task history) |
| Backup | ⚠ Needs work — relies on Replit's managed Postgres; no independent backup/export routine verified |
| Recovery | ⚠ Needs work — payment recovery is excellent (3-path activator); DB point-in-time recovery not independently verified |

---

# 14. Remaining Development Estimates

| Milestone | Status | Estimate |
|---|---|---|
| MVP | **Shipped** — live with real users | 0 |
| Beta | **Shipped** (iOS + web live) | 0 |
| Fully polished production | Push notifications, api-server typecheck, error boundary, monitoring/backup routine | ~40–60 hours (~1.5–2 weeks) |
| Android release | Build, store assets, Play review | ~40–80 hours (~2–3 weeks incl. review) |
| Enterprise ready (Business tier) | Branded corporate competitions, billing | ~3–5 weeks |

---

# 15. Priority List

**Critical**
- None (production healthy; no data-loss or security exposure found).

**High**
1. Mobile **push notifications** (largest engagement gap; notification content pipeline already exists).
2. Add a **typecheck validation for api-server** (`tsc --noEmit`) — currently type errors can only be caught by e2e.
3. Scope Moyasar keys per environment (dev currently shares **live** payment keys — a mistaken dev checkout would charge real money).
4. Verify/establish a **database backup & restore routine** for production.

**Medium**
5. Fix the 3 web `tsc` errors; add a top-level web error boundary.
6. Versioned migrations (`drizzle-kit generate`) instead of `push` before more contributors join.
7. External uptime monitoring/alerting on `https://thaddi.app/api/healthz`.
8. Android build & release.
9. Add competition selector to challenge creation (known backend gap).

**Low**
10. Code-split the admin panel; break up the 4 oversized files.
11. Real-time chat (WebSockets or faster polling) — current 15s polling is acceptable.
12. Avatar upload via object storage; broader player search; offline niceties on mobile.
13. Remove unrouted `placeholder.tsx`; bump `expo` to ~54.0.36.

---

# 16. Authentication Deep Debug (specifics)

- **Why production works:** thaddi.app runs on the **production Clerk instance** (`pk_live…` → clerk.thaddi.app) where your real accounts live; the FAPI proxy, Apple/Google OAuth production credentials (configured in the Auth pane), cookies and session validation are all wired against that instance and pass end-to-end (56 live users, working sign-ins in logs).
- **Why development fails:** the dev preview runs on the **development Clerk instance** (`pk_test…`/`sk_test…`, verified in the environment and in the browser console). It has a **separate, empty-of-your-account user store**. Signing in with a production email returns Clerk error `form_identifier_not_found` → "Couldn't find your account."
- **Which file:** none is at fault. `artifacts/thaddi/src/components/auth/ClerkConfig.tsx` correctly reads `VITE_CLERK_PUBLISHABLE_KEY` (test key in dev, live key in prod — swapped automatically by Replit on publish).
- **Which environment variable:** `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` differ by environment **by design** (Replit-managed).
- **Which middleware / redirect / cookie / token validation / API:** all traced healthy in dev — `clerkProxyMiddleware` deliberately no-ops outside production (dev connects to Clerk's dev instance directly, which is correct), dev API auth passes (regression suites mint dev Clerk sessions and get 200s), no cookie or CORS failure appears in any log.
- **Fix:** create a development test account (sign up in the preview, or via the Auth pane). Do not change keys or code.

---

# 17. Final Report

| Metric | Score |
|---|---|
| Overall project completion | **~92%** |
| Web completion | **~97%** |
| Mobile completion | **~90%** (iOS scope ~97%; Android 0%) |
| Backend completion | **~95%** |
| Production readiness | **~90%** |
| Security | **~92%** |
| Performance | **~90%** |
| Technical debt | **~12%** (low) |
| Estimated time remaining | ~2–4 weeks to "fully polished + Android in review" |

**Top remaining tasks** (there are not 20 real ones; padding the list would be dishonest): push notifications, api-server typecheck gate, per-environment Moyasar keys, backup routine, web tsc fixes + error boundary, versioned migrations, uptime alerting, Android release, challenge-create competition selector, admin code-splitting, real-time chat, avatar upload, player search, offline handling, expo version bump, remove placeholder page, external CI, Business tier, dev seed parity script, oversized-file refactors. *(20 items, priority-ordered in §15.)*

**Top bugs:** essentially none open. The only user-visible "bug" reported — dev sign-in failing — is by-design environment isolation (§5/§16). Historical bugs (ESPN 100-event cap, Safari verifying loop, Apple prod OAuth, Hall-of-Fame duplicates, session-exists dead-end) were fixed in earlier work; their guards remain in code and the current regression suites pass, though this audit did not re-reproduce each original bug.

**Top improvements:** covered in §15 — the highest-leverage three are push notifications, the api-server typecheck gate, and environment-scoped payment keys.

### The five questions

1. **Can this project be deployed for real customers today?** It already is — thaddi.app is live and healthy with 56 real users, 13 challenges and 1,254 predictions, and today's probe passed all 7 production checks.
2. **What is stopping it from being fully production ready?** Nothing blocking; the gaps are operational hardening (backups, uptime alerting, CI typecheck) and engagement features (push notifications, Android).
3. **Why does authentication fail only in development?** Because development and production use two isolated Clerk instances with separate user stores (Replit-managed, by design). Your account exists only in production. Create a dev test account; change nothing else.
4. **What should be fixed first?** Push notifications (product impact), then the api-server typecheck gate and environment-scoped Moyasar keys (risk reduction), then a verified backup routine.
5. **What can safely be postponed?** Real-time chat, avatar upload, admin code-splitting, offline support, the Business tier, and broader player search — none affect current users.
