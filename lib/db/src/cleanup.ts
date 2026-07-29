/**
 * One-time, idempotent removal of the discontinued "International Friendlies"
 * feature data. Safe to run on every boot: once the data is gone it is a no-op.
 *
 * Scoped strictly to friendlies-tagged rows so it can NEVER touch World Championship
 * data:
 *   - tournament slug "friendlies-2026" (and its stages + matches)
 *   - teams whose external_id is namespaced "espnf-" (ESPN friendlies only)
 *   - the "international-friendlies" challenge template
 * Any user predictions / prediction history / points on friendlies matches are
 * deleted too (the feature, and all scoring tied to it, is being removed).
 *
 * This runs as deployed code because production data can only be changed from
 * within the deployed environment — the prod friendlies rows are cleaned up on
 * the next deploy.
 */
import { eq, inArray, like } from "drizzle-orm";
import { db } from "./index";
import {
  tournamentsTable,
  stagesTable,
  matchesTable,
  teamsTable,
  predictionsTable,
  predictionHistoryTable,
  pointsLedgerTable,
  challengeMatchesTable,
  challengeTemplatesTable,
} from "./schema";

export interface FriendliesCleanupSummary {
  predictions: number;
  predictionHistory: number;
  pointsLedger: number;
  challengeMatches: number;
  matches: number;
  stages: number;
  teams: number;
  tournaments: number;
  templates: number;
}

const EMPTY: FriendliesCleanupSummary = {
  predictions: 0,
  predictionHistory: 0,
  pointsLedger: 0,
  challengeMatches: 0,
  matches: 0,
  stages: 0,
  teams: 0,
  tournaments: 0,
  templates: 0,
};

export async function removeFriendliesData(): Promise<FriendliesCleanupSummary> {
  return db.transaction(async (tx) => {
    const summary: FriendliesCleanupSummary = { ...EMPTY };

    const tournaments = await tx
      .select({ id: tournamentsTable.id })
      .from(tournamentsTable)
      .where(eq(tournamentsTable.slug, "friendlies-2026"));
    const tournamentIds = tournaments.map((t) => t.id);

    if (tournamentIds.length > 0) {
      const matches = await tx
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(inArray(matchesTable.tournamentId, tournamentIds));
      const matchIds = matches.map((m) => m.id);

      if (matchIds.length > 0) {
        summary.predictionHistory = (
          await tx
            .delete(predictionHistoryTable)
            .where(inArray(predictionHistoryTable.matchId, matchIds))
            .returning({ id: predictionHistoryTable.id })
        ).length;
        summary.predictions = (
          await tx
            .delete(predictionsTable)
            .where(inArray(predictionsTable.matchId, matchIds))
            .returning({ id: predictionsTable.id })
        ).length;
        summary.pointsLedger = (
          await tx
            .delete(pointsLedgerTable)
            .where(inArray(pointsLedgerTable.matchId, matchIds))
            .returning({ id: pointsLedgerTable.id })
        ).length;
        summary.challengeMatches = (
          await tx
            .delete(challengeMatchesTable)
            .where(inArray(challengeMatchesTable.matchId, matchIds))
            .returning({ id: challengeMatchesTable.id })
        ).length;
        summary.matches = (
          await tx
            .delete(matchesTable)
            .where(inArray(matchesTable.id, matchIds))
            .returning({ id: matchesTable.id })
        ).length;
      }

      summary.stages = (
        await tx
          .delete(stagesTable)
          .where(inArray(stagesTable.tournamentId, tournamentIds))
          .returning({ id: stagesTable.id })
      ).length;
      summary.tournaments = (
        await tx
          .delete(tournamentsTable)
          .where(inArray(tournamentsTable.id, tournamentIds))
          .returning({ id: tournamentsTable.id })
      ).length;
    }

    // ESPN friendlies teams are namespaced with an "espnf-" external_id and are
    // never shared with the World Championship tournament, so they are safe to remove.
    summary.teams = (
      await tx
        .delete(teamsTable)
        .where(like(teamsTable.externalId, "espnf-%"))
        .returning({ id: teamsTable.id })
    ).length;

    summary.templates = (
      await tx
        .delete(challengeTemplatesTable)
        .where(eq(challengeTemplatesTable.slug, "international-friendlies"))
        .returning({ id: challengeTemplatesTable.id })
    ).length;

    return summary;
  });
}
