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
