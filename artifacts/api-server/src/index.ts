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

  // Sync both WC2026 and International Friendlies on boot, then score any
  // matches that finished while the server was down. Running both syncs before
  // scoring ensures that a friendlies match that ended during downtime is
  // picked up in the same pass. Non-fatal: the API stays up if this fails.
  void (async () => {
    // --- WC2026 sync ---
    let wcSync: Awaited<ReturnType<typeof syncTournament>> | null = null;
    try {
      wcSync = await syncTournament();
    } catch (e) {
      logger.error({ err: e }, "Startup WC football sync failed");
    }

    // --- International friendlies sync (ESPN, best-effort) ---
    let friendliesSync: Awaited<ReturnType<typeof syncTournament>> | null = null;
    try {
      friendliesSync = await syncTournament(
        "friendlies-2026",
        createEspnFriendliesProvider(),
      );
    } catch (e) {
      logger.warn({ err: e }, "Startup friendlies sync failed (non-fatal)");
    }

    // --- Score all finished matches across every tournament ---
    try {
      const scored = await applyScoringForFinalMatches();
      logger.info(
        {
          wcProvider: wcSync?.provider,
          wcTeamsUpserted: wcSync?.teamsUpserted,
          wcMatchesUpserted: wcSync?.matchesUpserted,
          wcSkipped: wcSync?.skipped,
          friendliesTeamsUpserted: friendliesSync?.teamsUpserted,
          friendliesMatchesUpserted: friendliesSync?.matchesUpserted,
          friendliesSkipped: friendliesSync?.skipped,
          matchesScored: scored.filter((s) => s.scored).length,
        },
        "Startup sync complete",
      );
    } catch (e) {
      logger.error({ err: e }, "Startup scoring failed");
    }
    // Start the recurring scheduler after both syncs so live match scores,
    // status, and minute stay fresh during games.
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
  })();
});
