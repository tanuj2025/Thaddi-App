// One-shot match-refresh cycle for a Replit Scheduled Deployment.
//
// WHY THIS EXISTS
// Production runs on an `autoscale` deployment target, which suspends the
// instance between requests. The in-process self-scheduling sync timer
// (services/football/scheduler.ts) therefore never ticks when nobody is hitting
// the API, so a finished match can stay "live" until the next cold boot or a
// read-driven opportunistic refresh (services/football/liveRefresh.ts). This
// entry point lets a *scheduled* deployment settle the data even when there are
// zero viewers.
//
// WHAT IT DOES
// Runs ONE full cycle against the same database + football provider as the live
// server (it inherits the deployment's secrets, e.g. DATABASE_URL /
// FOOTBALL_PROVIDER), then exits. No HTTP server, no long-lived scheduler. It
// reuses the exact code path the in-process scheduler uses — runMatchSyncCycle
// = sync every active competition + score finished matches + post-scoring
// gamification/notifications — and then runs the time-based reminder sweep
// (runScheduledNotifications), matching POST /matches/refresh.
//
// HOW TO RUN (production)
//   node --enable-source-maps artifacts/api-server/dist/refresh.mjs
// Configure it as a Replit Scheduled Deployment (build: the api-server build;
// run: the command above; schedule: e.g. every 5 minutes).

import { logger } from "./lib/logger";
import { runMatchSyncCycle } from "./services/football/scheduler";
import { runScheduledNotifications } from "./services/scoring/afterScoring";

async function main(): Promise<void> {
  const startedAt = Date.now();
  logger.info("Scheduled refresh cycle starting");

  // Sync every active competition + score finals + post-scoring side effects.
  // runMatchSyncCycle is best-effort internally (it logs and never throws).
  await runMatchSyncCycle();

  // Time-based reminder sweep (kickoff reminders, etc.), mirroring the manual
  // refresh endpoint. Best-effort: a failure here must not fail the job.
  try {
    await runScheduledNotifications();
  } catch (err) {
    logger.error({ err }, "Scheduled refresh: notification sweep failed");
  }

  logger.info(
    { durationMs: Date.now() - startedAt },
    "Scheduled refresh cycle complete",
  );
}

// Explicit exit: open handles (e.g. the pg pool) would otherwise keep the
// process alive after the cycle finishes.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Scheduled refresh cycle failed");
    process.exit(1);
  });
