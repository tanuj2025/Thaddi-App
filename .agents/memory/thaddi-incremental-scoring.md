---
name: THADDI incremental scoring & autoscale immediacy
description: How points land "immediately" after a match ends on Replit Autoscale — watermark-based incremental scoring, reader-triggered refresh, and the predicates that must stay in lockstep.
---

# Incremental scoring + autoscale immediacy

The requirement was: allocate points the moment a match ends, and reflect live
scores without perceptible delay — on Replit Autoscale, which has NO always-on
timer (instances suspend between requests; the setTimeout scheduler only ticks on
a cold boot).

## The model
- Scoring is INCREMENTAL, keyed by a per-match watermark (`matches.scoredAt`,
  `scoredHomeScore`, `scoredAwayScore`), stamped INSIDE the same advisory-locked
  transaction that scores the match, against the scores re-read inside that tx.
- The hot path (scheduler cycle + opportunistic reader refresh) scores via
  `applyScoringForPendingMatches` — selects only finals whose watermark is missing
  or `IS DISTINCT FROM` the live score (NULL-safe, so post-final corrections
  re-select and re-score, swapping exact↔winner without duplicating ledger rows).
- `applyScoringForFinalMatches` (full rescan of every finished match) is now ONLY
  a backstop for boot + admin sync + `/matches/refresh`. Do NOT put it back on the
  per-cycle path — that's the O(all-finals) cost the watermark exists to avoid.

## Autoscale immediacy comes from READS, not timers
Because nothing ticks between requests, scoring lands only when a read wakes the
instance. `liveRefresh.ts`'s necessity gate therefore has a "pending scoring"
branch: a final match with a missing/stale watermark makes a refresh *necessary*,
so a viewer's read triggers the score within one poll cycle. Clients poll at 3s
(`LIVE_REFRESH_MIN_INTERVAL_MS` default 3000) to pair with this.
**Consequence (inherent, not a bug):** with zero traffic, nothing scores until the
next read. If sub-minute zero-viewer freshness is ever required, the lever is a
Scheduled Deployment cron pinging `/matches/refresh` (or a Reserved VM), NOT
re-adding a per-cycle full rescan.

## Two non-obvious traps
1. **Null-score finished rows loop the gate forever.** A row with
   status=finished/full_time but NULL home/away score can never be watermarked
   (isFinal is false), yet it matches the "missing watermark" predicate on every
   pass — so the necessity gate stays true and every read past the throttle forces
   a full sweep. FIX: every pending predicate MUST also require
   `homeScore IS NOT NULL AND awayScore IS NOT NULL`.
2. **Three predicates must stay in lockstep**: the engine's
   `applyScoringForPendingMatches` WHERE, `liveRefresh.ts`'s necessity query, and
   the scoped mirror in `scoringEngine.e2e.ts`. Change one → change all three.

## Late-join backfill must be challenge-scoped
Narrowing removed the every-cycle full rescan that used to attribute an
already-final match to a challenge created/joined AFTER it ended. That's what
`backfillScoringForChallenge` restores (called best-effort on challenge
create/join/approve).
**Why it must be scoped:** delegating to `applyScoringForMatch` per final match
re-scores EVERY challenge on that match plus the global ranking snapshot — joining
a whole-tournament challenge (~all fixtures final) would fire that many heavy
advisory-locked transactions in the request path (timeout + lock starvation of
live scoring). So the backfill rewrites the ledger + standings for the GIVEN
challenge only, in one transaction under one lock. Other challenges and the global
snapshot were already correct from when each match first scored; a late join
changes only this challenge's attribution, never global prediction scoring.

## Verifying in dev
`api-server`'s `dev` script is `build && start` (runs `dist`, NO watch/reload), so
code edits don't take effect until you RESTART the workflow. Confirm incremental
behavior in the logs: first cycle after boot scores all finals (e.g.
`matchesScored: 94`), the NEXT scheduled cycle logs `matchesScored: 0` with a
narrowed (often empty) `competitions` list.
