// Live progression engine for the demo-data harness. On a fast cadence it walks
// every demo match along the compressed clock (scheduled -> live -> finished)
// based on elapsed real time, and when a match reaches full time it hands off to
// the REAL scoring path (applyScoringForMatch + runPostScoring) so demo scoring
// behaves exactly like production. It only ever touches demo-tagged rows and
// never calls the real football provider.
//
// Self-scheduling timer (not setInterval) so ticks never overlap. Singleton:
// start() on seed/boot, stop() on teardown.

import { and, count, eq, isNull, like } from "drizzle-orm";
import { db, matchesTable, predictionsTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { applyScoringForMatch } from "../scoring/engine";
import { runPostScoring } from "../scoring/afterScoring";
import type { MatchScoringResult } from "../scoring/engine";
import {
  DEMO_EXTERNAL_PREFIX,
  DEMO_MATCH_EXTERNAL_PREFIX,
  DEMO_TICK_MS,
  computeDesiredState,
  demoFinalScore,
  demoMatchIndex,
} from "./config";

let stopped = true;
let timer: ReturnType<typeof setTimeout> | null = null;

// All demo matches (tagged `demo:m:<i>`).
async function loadDemoMatches() {
  return db
    .select()
    .from(matchesTable)
    .where(like(matchesTable.externalId, `${DEMO_MATCH_EXTERNAL_PREFIX}%`));
}

// One progression cycle. Best-effort: errors are logged, never thrown, so a
// transient failure doesn't kill the loop.
export async function runDemoTick(): Promise<void> {
  try {
    const now = new Date();
    const matches = await loadDemoMatches();
    const toScore: string[] = [];

    for (const m of matches) {
      const index = demoMatchIndex(m.externalId);
      if (index === null) continue;
      const final = demoFinalScore(index);
      const d = computeDesiredState(m.kickoffAt, final, now);

      const changed =
        m.status !== d.status ||
        m.homeScore !== d.homeScore ||
        m.awayScore !== d.awayScore ||
        m.minute !== d.minute;
      if (changed) {
        await db
          .update(matchesTable)
          .set({
            status: d.status,
            homeScore: d.homeScore,
            awayScore: d.awayScore,
            minute: d.minute,
            updatedAt: now,
          })
          .where(eq(matchesTable.id, m.id));
      }

      // A finished match with any unscored predictions needs scoring. This is
      // naturally idempotent (already-scored predictions are skipped) and also
      // catches up after a restart that missed the transition.
      if (d.status === "finished") {
        const [pending] = await db
          .select({ value: count() })
          .from(predictionsTable)
          .where(
            and(
              eq(predictionsTable.matchId, m.id),
              isNull(predictionsTable.scoredAt),
            ),
          );
        if ((pending?.value ?? 0) > 0) toScore.push(m.id);
      }
    }

    if (toScore.length > 0) {
      const results: MatchScoringResult[] = [];
      for (const id of toScore) {
        results.push(await applyScoringForMatch(id));
      }
      await runPostScoring(results);
      logger.info(
        { scored: results.filter((r) => r.scored).length },
        "demo progression scored finished matches",
      );
    }
  } catch (err) {
    logger.error({ err }, "demo progression tick failed");
  }
}

export function isDemoEngineRunning(): boolean {
  return !stopped;
}

// Start the progression loop. Runs an immediate tick (so already-finished demo
// matches are scored at once) then schedules subsequent ticks. No-op if already
// running.
export function startDemoEngine(): void {
  if (!stopped) return;
  stopped = false;

  const loop = async () => {
    if (stopped) return;
    await runDemoTick();
    if (stopped) return;
    timer = setTimeout(loop, DEMO_TICK_MS);
  };

  logger.info({ tickMs: DEMO_TICK_MS }, "demo progression engine started");
  void loop();
}

export function stopDemoEngine(): void {
  if (stopped) return;
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  logger.info("demo progression engine stopped");
}

// Whether any demo match data exists (drives auto-start on boot + status).
export async function demoDataExists(): Promise<boolean> {
  const [row] = await db
    .select({ value: count() })
    .from(matchesTable)
    .where(like(matchesTable.externalId, `${DEMO_EXTERNAL_PREFIX}%`));
  return (row?.value ?? 0) > 0;
}
