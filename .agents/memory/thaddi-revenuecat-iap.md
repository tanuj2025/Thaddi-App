---
name: THADDI RevenueCat IAP (mobile)
description: Non-obvious constraints for the mobile in-app-purchase flow — orval naming, connectors-proxy fetch shape for tests, and the supersede/idempotency rule.
---

# RevenueCat IAP (mobile)

RevenueCat is "just another paymentProvider" alongside Moyasar. Mobile NEVER links
Moyasar (Apple 3.1.1). The server verifies entitlements out-of-band and is the
source of truth — the client is never trusted for what it bought. Activation
mirrors the Moyasar callback (advisory lock on a stable ref, supersede-in-one-tx,
monotonic price guard).

## orval mangles "revenuecat" in path/schema names
Any path segment or schema name containing the literal token `revenuecat` is
mangled by orval codegen to `n` (e.g. an operationId `revenuecatSync` or a path
`/payments/revenuecat/sync` come out broken). `moyasar` is fine — it's specific to
`revenuecat`.
**How to apply:** name IAP operations/schemas WITHOUT the word revenuecat. We use
operationId `iapSync`, schema `IapSyncResult`, path `/payments/iap/sync`.

## E2E: RevenueCat is reached through the Replit connectors proxy, not api.revenuecat.com
`services/payments/revenuecat.ts` builds the SDK client with
`connectors.createProxyFetch("revenuecat")`. That wrapper REWRITES every outbound
URL from `https://api.revenuecat.com/v2/...` to
`${connectorsHost}/api/v2/proxy/v2/...` before calling `fetch`. So a `globalThis.fetch`
stub in an e2e must match the **proxy** path, not `api.revenuecat.com`:
- catalog: URL matches `/entitlements(\?|$)` under `/api/v2/proxy/`
- per-customer: URL matches `/customers/<id>/active_entitlements`
The proxy also calls `buildHeaders()` → `replit identity create`, which is a CHILD
PROCESS (execFile), NOT fetch — so it is untouched by the fetch stub and works in
the real Repl. An unknown customer returns RevenueCat 404 → treated as "no
entitlements". Catalog `lookup_key` == our plan `code`; customer entitlements only
carry an opaque `entitlement_id`, joined back to the code via the catalog.
See `artifacts/api-server/test/iapSync.e2e.ts`.

## Idempotency lookup must filter status='active'
The `subscriptions_payment_ref_unique` index is a FULL unique index on
`(payment_provider, payment_reference)` (only partial on `reference is not null`),
so a SUPERSEDED pass keeps its row (status=cancelled) with the same ref forever.
The iap/sync idempotency check (`existing ref → return its plan code`) MUST filter
`status='active'`, or after an upgrade (PRO cancelled, LEGEND active) a later sync
that targets the cancelled PRO ref would falsely report `{activated:true,
planCode:pro}` while LEGEND is the live pass.
**Why:** a cancelled ref is a superseded pass, not a replay. Falling through to the
active-pass + monotonic guard reports the truly active plan and never downgrades.
**How to apply:** safe because a cancelled ref always implies a higher active pass
(monotonic invariant), so the fall-through always hits `target <= current` and
returns the active code without attempting a conflicting re-insert.
