import app from "./app";
import { logger } from "./lib/logger";
import { removeFriendliesData, seedReferenceData } from "@workspace/db";
import { syncTournament } from "./services/football/sync";
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

  // Sync WC2026 on boot, then score any matches that finished while the server
  // was down. Non-fatal: the API stays up if this fails.
  void (async () => {
    // --- Idempotent reference-data seed (runs every boot, safe to repeat) ---
    // Inserts any missing catalog rows (tournaments, stages, plans, badges,
    // feature flags, etc.) using onConflictDoNothing, so existing production
    // rows are never overwritten.
    try {
      const seedSummary = await seedReferenceData();
      logger.info({ seedSummary }, "Reference-data seed complete");
    } catch (e) {
      logger.error({ err: e }, "Reference-data seed failed (non-fatal)");
    }

    // --- One-time cleanup of the removed International Friendlies feature ---
    // Idempotent: a no-op once the friendlies data is gone. Runs here so the
    // production friendlies rows are removed on deploy (prod data can only be
    // changed from within the deployed environment).
    try {
      const friendliesCleanup = await removeFriendliesData();
      const removed = Object.values(friendliesCleanup).reduce(
        (a, b) => a + b,
        0,
      );
      if (removed > 0) {
        logger.info({ friendliesCleanup }, "Removed friendlies feature data");
      }
    } catch (e) {
      logger.error({ err: e }, "Friendlies cleanup failed (non-fatal)");
    }

    // --- WC2026 sync ---
    let wcSync: Awaited<ReturnType<typeof syncTournament>> | null = null;
    try {
      wcSync = await syncTournament();
    } catch (e) {
      logger.error({ err: e }, "Startup WC football sync failed");
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
