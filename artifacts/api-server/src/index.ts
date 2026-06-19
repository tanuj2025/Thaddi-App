import app from "./app";
import { logger } from "./lib/logger";
import { removeFriendliesData, seedReferenceData } from "@workspace/db";
import { syncAllCompetitions } from "./services/football/sync";
import { reconcileEspnExternalIds } from "./services/football/reconcile";
import { applyScoringForFinalMatches } from "./services/scoring/engine";
import { startMatchSyncScheduler } from "./services/football/scheduler";
import { startMoyasarReconciler } from "./services/payments/reconcile";
import { startClerkProxyErrorPruner } from "./lib/analytics";
import { demoDataExists, startDemoEngine } from "./services/demo/engine";
import { isDemoHarnessEnabled } from "./services/demo/config";
import { nudgeUsersForFavoriteClub } from "./services/notifications/favoriteClubNudge";

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

    // --- One-time favorite-club nudge for existing users (idempotent) ---
    // Now that clubs ship alongside national teams, prompt users who picked a
    // national team before clubs existed to also choose a favorite club. The
    // atomic per-user claim makes this safe to run on every boot and across
    // concurrent instances (at-most-once per user). Non-fatal.
    try {
      await nudgeUsersForFavoriteClub();
    } catch (e) {
      logger.error({ err: e }, "Favorite-club nudge failed (non-fatal)");
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

    // --- Realign existing rows onto the ESPN id scheme (idempotent) ---
    // No-op unless ESPN is the active provider. Must run BEFORE the sync so the
    // sync UPDATES the realigned rows in place (live score/status) instead of
    // inserting prediction-less duplicates. Converges in one run; a second run
    // is a no-op.
    try {
      const reconcile = await reconcileEspnExternalIds();
      if (
        reconcile.teamsRemapped > 0 ||
        reconcile.matchesRemapped > 0 ||
        reconcile.teamsUnmatched > 0 ||
        reconcile.matchesUnmatched > 0
      ) {
        logger.info({ reconcile }, "Realigned rows onto ESPN id scheme");
      }
    } catch (e) {
      logger.error({ err: e }, "ESPN id reconcile failed (non-fatal)");
    }

    // --- Sync every active competition (WC + active domestic leagues/cups) ---
    let syncResults: Awaited<ReturnType<typeof syncAllCompetitions>> = [];
    try {
      syncResults = await syncAllCompetitions({ mode: "full" });
    } catch (e) {
      logger.error({ err: e }, "Startup football sync failed");
    }

    // --- Score all finished matches across every tournament ---
    try {
      const scored = await applyScoringForFinalMatches();
      logger.info(
        {
          competitions: syncResults.map((r) => ({
            provider: r.provider,
            teamsUpserted: r.teamsUpserted,
            matchesUpserted: r.matchesUpserted,
            skipped: r.skipped,
          })),
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

    // Backstop reconciler: recover paid Moyasar purchases that missed BOTH the
    // browser callback and the webhook. Self-guards when payments aren't
    // configured; self-scheduling + best-effort, so it never blocks boot.
    startMoyasarReconciler();

    // Retention pruner: delete clerk_proxy_error analytics rows older than the
    // retention window so the table (and the admin breakdown query) stays
    // bounded as sign-in failures accumulate. Self-scheduling + best-effort.
    startClerkProxyErrorPruner();

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
