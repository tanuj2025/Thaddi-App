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
import { syncTournament } from "./sync";
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

// One sync + score cycle. Best-effort: errors are logged, never thrown, so a
// transient provider/database failure doesn't kill the scheduler loop.
async function runSyncTick(): Promise<void> {
  try {
    const sync = await syncTournament();
    const scored = await applyScoringForFinalMatches();
    const matchesScored = scored.filter((s) => s.scored).length;
    // Post-commit side effects (gamification + notifications) for any matches
    // that were just scored. Best-effort and never throws.
    await runPostScoring(scored);
    logger.info(
      {
        provider: sync.provider,
        teamsUpserted: sync.teamsUpserted,
        matchesUpserted: sync.matchesUpserted,
        matchesScored,
        skipped: sync.skipped,
      },
      "Scheduled football sync complete",
    );
  } catch (err) {
    logger.error({ err }, "Scheduled football sync failed");
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
