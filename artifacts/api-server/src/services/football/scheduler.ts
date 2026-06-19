// Background scheduler that keeps live match data fresh during games.
//
// Match data is synced once on startup, but during live matches the score,
// status (live/half_time/finished), and minute change continuously. This
// scheduler re-syncs the tournament from the active football provider on a
// recurring interval and scores any matches that have finished.
//
// Adaptive cadence keeps us well inside football-data.org's free-tier limit
// (10 requests/min): a single competition-wide fetch per tick. We poll fast
// (~60s) while any match is live and back off to a slow interval otherwise,
// waking up early when the next kickoff is approaching so we catch the
// transition into "live" promptly.
//
// Each tick reuses the same building blocks as the manual refresh endpoint, so
// re-sync runs under the shared football advisory lock + transaction (see
// services/football/lock.ts) and can never race the startup sync or a manual
// refresh.

import { and, gt, inArray } from "drizzle-orm";
import { db, matchesTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { syncAllCompetitions } from "./sync";
import { applyScoringForFinalMatches } from "../scoring/engine";
import { runPostScoring } from "../scoring/afterScoring";

// Statuses that mean a match is in progress right now.
const LIVE_STATUSES = ["live", "half_time"] as const;

function intervalFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

// Poll cadence (overridable via env for ops/testing).
const LIVE_INTERVAL_MS = intervalFromEnv(
  "MATCH_SYNC_LIVE_INTERVAL_MS",
  60 * 1000,
);
const IDLE_INTERVAL_MS = intervalFromEnv(
  "MATCH_SYNC_IDLE_INTERVAL_MS",
  5 * 60 * 1000,
);

// Decide how long to wait before the next sync tick. Fast while a match is
// live; otherwise wake at (or shortly before) the next kickoff if it falls
// within the idle window, so we don't sit idle through the start of a match.
async function computeNextDelayMs(): Promise<number> {
  const live = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(inArray(matchesTable.status, [...LIVE_STATUSES]))
    .limit(1);
  if (live.length > 0) return LIVE_INTERVAL_MS;

  const now = new Date();
  const [next] = await db
    .select({ kickoffAt: matchesTable.kickoffAt })
    .from(matchesTable)
    .where(
      and(
        inArray(matchesTable.status, ["scheduled"]),
        gt(matchesTable.kickoffAt, now),
      ),
    )
    .orderBy(matchesTable.kickoffAt)
    .limit(1);

  if (!next) return IDLE_INTERVAL_MS;

  const untilKickoff = next.kickoffAt.getTime() - now.getTime();
  if (untilKickoff >= IDLE_INTERVAL_MS) return IDLE_INTERVAL_MS;
  // Wake near kickoff, but never tighter than the live cadence.
  return Math.max(LIVE_INTERVAL_MS, untilKickoff);
}

// One sync + score cycle. The tournament is synced first so that
// `applyScoringForFinalMatches` (which is global — all tournaments) sees the
// freshest status before it decides what to score.
// Best-effort: errors are logged, never thrown, so a transient failure doesn't
// kill the scheduler loop.
async function runSyncTick(): Promise<void> {
  // --- Step 1: Sync every active competition ---
  // Use the cheap narrow "live" fetch for domestic competitions while any match
  // is live (the WC always does its single full fetch); otherwise walk the full
  // season window so newly published fixtures and corrections are picked up.
  const anyLive = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(inArray(matchesTable.status, [...LIVE_STATUSES]))
    .limit(1);
  const mode = anyLive.length > 0 ? "live" : "full";

  let syncResults: Awaited<ReturnType<typeof syncAllCompetitions>> = [];
  try {
    syncResults = await syncAllCompetitions({ mode });
  } catch (err) {
    logger.error({ err }, "Scheduled football sync failed");
  }

  // --- Step 2: Score any matches that just finished across ALL tournaments ---
  try {
    const scored = await applyScoringForFinalMatches();
    const matchesScored = scored.filter((s) => s.scored).length;
    // Post-commit side effects (gamification + notifications). Best-effort.
    await runPostScoring(scored);
    logger.info(
      {
        mode,
        competitions: syncResults.map((r) => ({
          provider: r.provider,
          teamsUpserted: r.teamsUpserted,
          matchesUpserted: r.matchesUpserted,
          skipped: r.skipped,
        })),
        matchesScored,
      },
      "Scheduled sync complete",
    );
  } catch (err) {
    logger.error({ err }, "Post-sync scoring failed");
  }
}

// Start the recurring match-sync scheduler. Returns a stop function. Uses a
// self-scheduling timer (not setInterval) so ticks never overlap and the next
// delay can adapt to whether matches are currently live.
export function startMatchSyncScheduler(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = async () => {
    if (stopped) return;
    let delay = LIVE_INTERVAL_MS;
    try {
      delay = await computeNextDelayMs();
    } catch (err) {
      logger.error(
        { err },
        "Failed to compute next sync delay; using live interval",
      );
    }
    if (stopped) return;
    timer = setTimeout(tick, delay);
  };

  const tick = async () => {
    await runSyncTick();
    await scheduleNext();
  };

  logger.info(
    { liveIntervalMs: LIVE_INTERVAL_MS, idleIntervalMs: IDLE_INTERVAL_MS },
    "Match sync scheduler started",
  );
  // Kick off the first adaptive delay (startup already ran an initial sync).
  void scheduleNext();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    logger.info("Match sync scheduler stopped");
  };
}
