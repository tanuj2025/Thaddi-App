---
name: THADDI platform foundation
description: Durable architecture decisions and gotchas for the THADDI prediction platform (api-server + thaddi web + shared db).
---

# THADDI platform

Arabic-first FIFA World Cup 2026 prediction challenge platform (Saudi market, NOT gambling). Bilingual AR/EN, RTL default. Monorepo: `artifacts/api-server` (Express), `artifacts/thaddi` (React+Vite), shared `lib/db` (Drizzle), `lib/api-spec` (OpenAPI → generated `@workspace/api-client-react`).

## API routing
The api-server is mounted at `/api` (see its `artifact.toml` `paths = ["/api"]`). Inside the app, route files mount their routers at the **root** of that prefix, so OpenAPI paths map directly: `/feature-flags` → `/api/feature-flags`, `/platform-stats` → `/api/platform-stats`, `/me/...` → `/api/me/...`. The OpenAPI spec (`lib/api-spec/openapi.yaml`) is the source of truth — route handler paths must match spec paths exactly or the generated client 404s.
**Why:** easy to assume a `/platform/...` sub-prefix that doesn't exist and waste time debugging 404s.

## Web auth model
Web app talks to the API **same-origin** through the Replit proxy with cookie-based Clerk sessions. No Bearer tokens / `getToken` on web. CORS is therefore not needed for the web app; cross-origin (future mobile) must use an env allow-list (`ALLOWED_ORIGINS`) — never reflect arbitrary origins with `credentials: true`.

## Clerk JIT provisioning sync safety
`getOrProvisionUser` syncs email/emailVerified from Clerk on every read. The Clerk identity read returns `null` on transient failure (not `{email:null, emailVerified:false}`), and the sync is **skipped** when identity is null so a verified user is never downgraded by an upstream blip.
**Why:** a transient Clerk outage was overwriting valid users to unverified/null email.
**How to apply:** any "sync from external source of truth on read" must distinguish "definitively changed" from "couldn't fetch".

## Activation flow ordering
Activation sequence is `email verified → profile complete → mobile verified → activated`. The mobile OTP endpoints (`/me/mobile/send-otp`, `/me/mobile/verify-otp`) enforce the prerequisites server-side (409 unless emailVerified && profileComplete), not just via the frontend `ActivationGate`. verify-otp also checks `expiresAt` and marks stale attempts `expired` before calling the provider.

## SMS verification
Mobile OTP uses a swappable provider service (`services/smsVerification.ts`, Authentica via `AUTHENTICA_API_KEY`). Missing key → service is null → endpoints return 503 gracefully (rest of app unaffected). `mobile_verification_status` enum: `pending|verified|failed|expired`. One verified mobile number per account (anti-cheating, unique guard at send + verify + DB constraint).

## Seeded foundation
World Cup 2026 tournament/stages, plans (free/professional/legend/business) + entitlements, levels, badges, achievements, challenge templates, feature flags are **seeded data** (`lib/db/src/seed.ts`), never hardcoded in app logic. Seed is idempotent.

## Challenge writes: entitlement gating & atomicity
- Validate plan entitlements (e.g. custom_prizes) BEFORE any DB write in update handlers, and wrap multi-table writes (challenge + prizes) in a single `db.transaction`. Otherwise a rejected request can still persist partial non-prize updates.
- Participant-limit enforcement on join must be atomic: inside a transaction, `SELECT ... FOR UPDATE` the challenge row, re-count active participants, then insert/reactivate — a check-then-insert in separate statements lets concurrent joins exceed the limit. Use a sentinel error class thrown inside the tx to roll back and map to 409.
- Invite codes are generated UPPERCASE (unambiguous alphabet, no 0/O/1/I). Always normalize submitted codes with `.trim().toUpperCase()` before comparing for private joins; the public preview already uppercases, so a mismatch breaks lowercase invite URLs.
