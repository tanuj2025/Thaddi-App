# THADDI API — Production Health Check

A repeatable, read-only way to confirm the live deployment is healthy. Safe to run
anytime: no writes, no auth, no state mutation.

## Quick check

```bash
pnpm --filter @workspace/api-server run health:prod
```

Probes `https://thaddi.app/api` by default. Override the target:

```bash
node artifacts/api-server/scripts/health-probe.mjs https://thaddi-mvp-build.replit.app/api
HEALTH_BASE_URL=http://127.0.0.1:8080/api node artifacts/api-server/scripts/health-probe.mjs
```

Exit code `0` = all probes passed; `1` = at least one failed (CI-friendly).

## What it verifies

All endpoints are public and read-only:

| Endpoint | Confirms |
| --- | --- |
| `GET /api/healthz` | Express is up — the **configured startup health gate** (see `artifact.toml`). |
| `GET /api/platform-stats` | DB reachable; returns user/challenge/prediction counts. |
| `GET /api/feature-flags` | Flag catalog served. |
| `GET /api/plans` | Subscription plans + entitlements served. |
| `GET /api/teams` | Football team catalog present (sync ran). |
| `GET /api/schedule` | Full fixture list synced (`scheduleState` + matches). |
| `GET /api/upcoming-matches` | Next scheduled fixtures served. |

A healthy run reports live counts, e.g. `teams=48`, `schedule matches=100`, which
confirm the football sync has populated production data.

## Reading deployment logs

Use the deployment skill's `fetchDeploymentLogs` (or the workspace deployment-logs
tool) filtered by `(?i)error|exception|unhandled`.

**Expected cold-start noise:** the platform's generic port-readiness probe hits the
service root `/api` (which has no route, so `404` when healthy) and may log a few
`healthcheck /api returned status 500` lines in the brief (~hundreds of ms) window
while an autoscale instance boots and the port settles. This is normal and clears
once the instance is ready. The **real** readiness gate is `/api/healthz`
(configured under `[services.production.health.startup]` in `artifact.toml`), a
static handler with no DB/sync dependency that returns `200` the moment Express is
listening. Treat steady-state (post-boot) `5xx`/`Exception` lines as real; treat the
cold-start `healthcheck /api` cluster as benign.

## Sign-in failure monitoring (Clerk proxy)

The Clerk Frontend-API proxy (`src/middlewares/clerkProxyMiddleware.ts`) absorbs
transient upstream blips gracefully, but every upstream failure is now also made
visible two ways so the team can spot a regression after deploy.

### 1. Aggregated breakdown (admin dashboard)

`GET /api/analytics/clerk-proxy?days=30` (admin only) — also rendered as the
**"Sign-in Failures"** panel on the admin Analytics page. Each real upstream
failure is recorded in `analytics_events` (`type = clerk_proxy_error`,
metadata `{ code, willRetry, method, degraded }`), so the breakdown is durable
across autoscale instances and beyond log retention. The panel shows totals plus
breakdowns by error `code`, retry disposition (`willRetry`), and HTTP `method`,
and a daily trend of total vs. degraded failures.

### 2. Log-based alert (degraded Apple callbacks)

The residual risk: the keep-alive pool can hand the proxy a stale socket that the
upstream resets *after* connecting (`ECONNRESET`). For Apple's one-time
`form_post` POST callback this cannot be safely retried, so it degrades to a
sign-in redirect — the user has to tap "Sign in with Apple" again.

Every such degrade emits a distinct, severity-elevated log line:

```
ALERT clerk proxy callback degraded — un-retryable upstream reset on Apple form_post; user must retry sign-in
```

with structured field `event=clerk_proxy_callback_degraded`. Configure a
**log-based alert** on the deployment monitoring surface to fire when this event
exceeds a small baseline:

```
event=clerk_proxy_callback_degraded   →   alert if count > 5 per hour
```

Baseline expectation is **~0/hour**; an occasional one is normal pool churn. A
sustained climb (e.g. >5/hour) after a deploy means stale sockets are being handed
out faster than they're recycled.

### Runbook: if degraded callbacks spike

The next lever is the proxy's keep-alive connection pool (`keepAliveAgent` in
`clerkProxyMiddleware.ts`). Stale-socket resets come from reusing pooled
connections that the upstream closed while idle. In order of escalating impact:

1. **Tune the pool** — lower `keepAliveMsecs` (currently `10_000`) so idle sockets
   are recycled sooner, well under the upstream's idle timeout; optionally lower
   `maxFreeSockets`.
2. **Disable pooling** — set `keepAlive: false` (or drop the custom agent) so every
   request opens a fresh connection. This trades a little latency/handshake cost
   for eliminating stale-socket resets entirely. Safe to do as a mitigation while
   investigating.

After changing the agent, redeploy and watch the `clerk_proxy_callback_degraded`
rate and the admin breakdown panel to confirm the spike clears.
