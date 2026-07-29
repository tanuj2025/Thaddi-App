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

import { and, eq, gt, inArray, lte, or } from "drizzle-orm";
import { db, matchesTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { syncAllCompetitions } from "./sync";
import { applyScoringForPendingMatches } from "../scoring/engine";
import { runPostScoring } from "../scoring/afterScoring";
import { runSystemMonitoringChecks } from "../monitoring/healthMonitor";

// Statuses that mean a match is in progress right now.
const LIVE_STATUSES = ["live", "half_time"] as const;

// A scheduled match whose kickoff has passed but which the provider hasn't yet
// flipped to "live" is treated as hot (we must keep fetching to catch the
// transition), up to this cutoff after kickoff. Matches liveRefresh's overdue
// window so the request-driven gate and the sync scope agree.
const OVERDUE_WINDOW_MS = 4 * 60 * 60 * 1000;

// The tournaments with a match that is live now, or scheduled-but-overdue (so
// about to flip live). During live play the hot cycle fetches ONLY these,
// instead of fanning out to every active competition each tick — with N active
// competitions a blanket refresh would be N× the provider load at the 3s
// cadence and risk rate-limiting the keyless ESPN feed.
async function liveOrOverdueTournamentIds(
  now = new Date(),
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ tournamentId: matchesTable.tournamentId })
    .from(matchesTable)
    .where(
      or(
        inArray(matchesTable.status, [...LIVE_STATUSES]),
        and(
          eq(matchesTable.status, "scheduled"),
          lte(matchesTable.kickoffAt, now),
          gt(
            matchesTable.kickoffAt,
            new Date(now.getTime() - OVERDUE_WINDOW_MS),
          ),
        ),
      ),
    );
  return new Set(rows.map((r) => r.tournamentId));
}

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

// One sync + score cycle. The tournament is synced first so that the scorer
// sees the freshest status before it decides what to score.
// Best-effort: errors are logged, never thrown, so a transient failure doesn't
// kill the scheduler loop.
export async function runMatchSyncCycle(): Promise<void> {
  // --- Step 1: Sync ---
  // While anything is live/overdue, do the cheap narrow "live" fetch for ONLY
  // those competitions (bounds provider load to what's actually in play at the
  // fast cadence). Otherwise walk the full season window across every active
  // competition so newly published fixtures and corrections are picked up.
  const liveOrOverdue = await liveOrOverdueTournamentIds();
  const narrow = liveOrOverdue.size > 0;
  const mode = narrow ? "live" : "full";

  let syncResults: Awaited<ReturnType<typeof syncAllCompetitions>> = [];
  try {
    syncResults = await syncAllCompetitions(
      narrow
        ? { mode: "live", onlyTournamentIds: liveOrOverdue }
        : { mode: "full" },
    );
  } catch (err) {
    logger.error({ err }, "Scheduled football sync failed");
  }

  // --- Step 2: Score matches that just finished (incremental) ---
  // Only final matches whose scoring watermark is missing or stale are touched,
  // so a cycle is O(newly-final) rather than re-scoring every finished match.
  try {
    const scored = await applyScoringForPendingMatches();
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

  // --- Step 3: Run system monitoring & alerts ---
  try {
    await runSystemMonitoringChecks();
  } catch (err) {
    logger.error({ err }, "Background health monitoring check failed");
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
    await runMatchSyncCycle();
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
