---
name: THADDI live demo-data harness
description: Admin-only testing harness that seeds dummy matches on a compressed clock and drives them through the real scoring engine.
---

# Live demo-data harness

Admin-only feature so an owner can fully test predict → live → scoring → rankings without waiting for real World Cup matches. Lives in `artifacts/api-server/src/services/demo/` (config/engine/harness) + `/admin/demo/*` routes + `artifacts/thaddi/src/pages/admin/demo.tsx`.

## Core design decisions

- **Stateless deterministic progression.** No extra columns store demo state. Each demo match's current status/score is recomputed every tick purely from its index (seeded PRNG → predetermined final score) + elapsed real time against a compressed lifecycle clock. Survives server restarts and is reproducible.
  **Why:** avoids schema changes and makes the engine idempotent — a restart resumes mid-demo correctly.

- **Tagged-row isolation, not a separate DB.** Everything carries a `demo:` marker (external_id prefix on tournament/stage/teams/matches; `createdViaCode = 'demo:harness'` on challenges; `clerkUserId` prefix `demo:user:` on users). Teardown is an exact sweep by these markers.
  **How to apply:** the real provider sync (`football/sync.ts`) prune queries MUST exclude `notLike(externalId, 'demo:%')`, or a real sync would delete demo rows (or vice-versa). Any new prune/sweep over matches/teams must keep this guard.

- **Reuses the REAL scoring path.** The progression engine calls `applyScoringForMatch` + `runPostScoring` exactly like production — never a parallel scoring impl. Demo tournament uses `type: 'other'` so it never becomes the active WC (`activeTournamentId` stays real), but demo matches still show in the global `/matches` feed (no tournament filter there).

- **Prod-disabled both ends.** Backend routes 403 when `NODE_ENV==='production'`; frontend hides nav + route via `import.meta.env.PROD`. Engine auto-resumes on boot only if `!prod && demoDataExists()`.

- **Teardown re-derives, never time-windows.** Teardown deletes ONLY demo-tagged rows; it then restores affected real users by re-deriving their state from the now-clean (demo-free) data — `recomputeUserTotals`, `reconcileUserBadges` (revoke earnable threshold badges no longer met), `reconcileTopPredictor` + a fresh global-ranking snapshot.
  **Why:** an earlier version deleted real users' badges/achievements/ranking history by a time window (`awardedAt >= seedTime`), which silently destroyed legitimately-earned real data whenever a real award happened to fall after the seed. Time-of-creation is NOT a reliable proxy for "demo-caused" — only re-derivation from clean data is safe.
  **How to apply:** never delete gamification rows by timestamp to "undo" a demo/import. Delete the tagged source rows, then recompute the derived state. Demo challenges cascade; achievements earned inside them are deleted (not null'd) since they'd otherwise orphan.

## Live activity feed (read-only derivation)
`getDemoActivity()` powers the admin demo page's live feed. It adds NO scoring logic — it merges recent rows the real engine already wrote, all tagged to demo data: live/finished demo matches (by `updatedAt`), `points_ledger` entries on demo matches (`points > 0`), and global `rankings` snapshot rows whose rank changed. **Ranking changes are scoped to demo users only** (join users on `clerkUserId like demo:user:%`) so the feed stays clearly "demo" and never surfaces real-user rank noise caused as a side effect. Served at `/admin/demo/activity` (same prod-403 guard), frontend polls it via react-query while `active`.
  **How to apply:** keep the feed a pure derivation — never persist demo "event" rows; if a new demo-tagged source table appears, add it here as another merged category, don't invent state.

## Tagging constants
All in `services/demo/config.ts`. Timeline is env-overridable (`DEMO_LIFECYCLE_MS`, `DEMO_SPACING_MS`, `DEMO_MATCH_COUNT`, `DEMO_USER_COUNT`, `DEMO_TICK_MS`, `DEMO_FINISHED_COUNT`). Seeding rejects with `DemoAlreadyActiveError` (→ 409) if data already exists.

## Fast-forwarding the clock
Because the engine is stateless (state = f(stored kickoffAt, now)), the ONLY clock knob is shifting demo matches' stored `kickoffAt`/`predictionLockAt` earlier — never a separate "demo time offset" column. `advanceDemoClock({minutes,finishLive})` shifts the whole timeline (minutes) and/or parks live matches a full `DEMO_LIFECYCLE_MS` in the past (finishLive), then calls `runDemoTick()` so the REAL scoring path runs. Admin-only, prod-gated, audited as `demo.advance`. Don't add a parallel scoring/advance impl.

## Test coverage
`test/demoHarness.e2e.ts` (wired into the `test` validation chain) mints a Clerk admin session, seeds → asserts status+audit → double-seed 409 → teardown clean sweep. It also asserts the activity feed (match + points events present, newest-first) right after seed. It also proves the re-derivation contract: a real (admin) user is made "affected" (prediction on a demo match) and planted with a demo-derived earnable badge + global Top Predictor achievement plus a legit decorative badge — after teardown the demo-derived awards are revoked while the decorative one survives. Self-heals leftover demo data at start. Follows the same in-process app-boot + Bearer pattern as `adminPanel.e2e.ts`.
