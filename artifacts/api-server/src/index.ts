import app from "./app";
import { logger } from "./lib/logger";
import { syncTournament } from "./services/football/sync";
import { applyScoringForFinalMatches } from "./services/scoring/engine";
import { startMatchSyncScheduler } from "./services/football/scheduler";

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
    } finally {
      // Start the recurring scheduler after the initial sync so live match
      // scores, status, and minute stay fresh during games.
      startMatchSyncScheduler();
    }
  })();
});
