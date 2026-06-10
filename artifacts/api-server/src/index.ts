import app from "./app";
import { logger } from "./lib/logger";
import { syncTournament } from "./services/football/sync";
import { createEspnFriendliesProvider } from "./services/football/espnFriendliesProvider";
import { applyScoringForFinalMatches } from "./services/scoring/engine";
import { startMatchSyncScheduler } from "./services/football/scheduler";
import { demoDataExists, startDemoEngine } from "./services/demo/engine";
import { isDemoHarnessEnabled } from "./services/demo/config";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Best-effort sync of fixtures from the active football provider on boot, then
  // score any final matches. Non-fatal: the API stays up if this fails.
  void (async () => {
    try {
      const sync = await syncTournament();
      const scored = await applyScoringForFinalMatches();
      logger.info(
        {
          provider: sync.provider,
          teamsUpserted: sync.teamsUpserted,
          matchesUpserted: sync.matchesUpserted,
          matchesScored: scored.filter((s) => s.scored).length,
          skipped: sync.skipped,
        },
        "Startup football sync complete",
      );
    } catch (e) {
      logger.error({ err: e }, "Startup football sync failed");
    }
    // International friendlies — best-effort, does not block the scheduler.
    try {
      const friendliesSync = await syncTournament(
        "friendlies-2026",
        createEspnFriendliesProvider(),
      );
      if (!friendliesSync.skipped) {
        logger.info(
          {
            teamsUpserted: friendliesSync.teamsUpserted,
            matchesUpserted: friendliesSync.matchesUpserted,
          },
          "Startup friendlies sync complete",
        );
      }
    } catch (e) {
      logger.warn({ err: e }, "Startup friendlies sync failed (non-fatal)");
    } finally {
      // Start the recurring scheduler after the initial sync so live match
      // scores, status, and minute stay fresh during games.
      startMatchSyncScheduler();

      // Resume the demo progression engine if demo data survived a restart
      // (only when the harness is enabled — always outside production, and in
      // production only with the DEMO_HARNESS_PROD_ENABLED opt-in flag).
      if (isDemoHarnessEnabled()) {
        try {
          if (await demoDataExists()) {
            startDemoEngine();
            logger.info("Resumed demo progression engine on boot");
          }
        } catch (e) {
          logger.error({ err: e }, "Demo engine boot check failed");
        }
      }
    }
  })();
});
