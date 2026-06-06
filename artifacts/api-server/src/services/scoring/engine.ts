// Scoring engine. Applies the configurable rule set (rules.ts) when a match is
// final: scores each prediction once globally, then attributes points to every
// challenge that includes the match via the append-only points ledger, and
// recomputes affected participant standings.
//
// Idempotent: re-running for a match deletes its prior ledger rows and recomputes
// participant aggregates from the ledger + scored predictions, so repeated runs
// (e.g. a correction) converge without double counting.
//
// Concurrency-safe: the whole per-match operation runs inside a transaction
// guarded by a Postgres advisory lock (FOOTBALL_LOCK_KEY) shared with the sync
// service, so the delete-then-insert ledger rewrite and the recompute can never
// interleave with another scoring or sync run and duplicate ledger rows.

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  matchesTable,
  predictionsTable,
  pointsLedgerTable,
  challengeParticipantsTable,
  type Match,
  type Challenge,
} from "@workspace/db";
import {
  scorePrediction,
  DEFAULT_SCORING_RULES,
  type ScoringRules,
} from "./rules";
import {
  challengesIncludingMatch,
  matchIdsForChallenge,
} from "../../lib/challengeMatches";
import { acquireFootballLock } from "../football/lock";
import {
  snapshotChallengeRanking,
  snapshotGlobalRanking,
} from "./rankings";

// Transaction client type derived from db.transaction's callback parameter.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface MatchScoringResult {
  matchId: string;
  scored: boolean;
  predictionsScored: number;
  challengesAffected: number;
  reason?: string;
}

function isFinal(match: Match): boolean {
  return (
    (match.status === "finished" || match.status === "full_time") &&
    match.homeScore !== null &&
    match.awayScore !== null
  );
}

// Score every prediction for a final match and update standings across all
// challenges that include it.
export async function applyScoringForMatch(
  matchId: string,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
): Promise<MatchScoringResult> {
  const match = await db.query.matchesTable.findFirst({
    where: eq(matchesTable.id, matchId),
  });
  if (!match) {
    return {
      matchId,
      scored: false,
      predictionsScored: 0,
      challengesAffected: 0,
      reason: "match not found",
    };
  }
  if (!isFinal(match)) {
    return {
      matchId,
      scored: false,
      predictionsScored: 0,
      challengesAffected: 0,
      reason: "match not final",
    };
  }

  const actual = { home: match.homeScore!, away: match.awayScore! };

  // Run the whole rewrite atomically under the football advisory lock so a
  // concurrent scoring/sync run cannot interleave and duplicate ledger rows.
  return db.transaction(async (tx) => {
    await acquireFootballLock(tx);

    // 1) Score predictions globally (canonical outcome + points per prediction).
    const predictions = await tx
      .select()
      .from(predictionsTable)
      .where(eq(predictionsTable.matchId, matchId));

    const now = new Date();
    for (const p of predictions) {
      const { outcome, points } = scorePrediction(
        { home: p.homeScore, away: p.awayScore },
        actual,
        rules,
      );
      await tx
        .update(predictionsTable)
        .set({ outcome, pointsAwarded: points, scoredAt: now, updatedAt: now })
        .where(eq(predictionsTable.id, p.id));
    }

    // 2) Attribute points to every challenge that includes this match.
    const challenges = await challengesIncludingMatch(matchId);

    // Idempotency: clear this match's prior ledger rows for the affected
    // challenges before re-inserting.
    if (challenges.length) {
      await tx
        .delete(pointsLedgerTable)
        .where(
          and(
            eq(pointsLedgerTable.matchId, matchId),
            inArray(
              pointsLedgerTable.challengeId,
              challenges.map((c) => c.id),
            ),
          ),
        );
    }

    const predictionByUser = new Map(predictions.map((p) => [p.userId, p]));
    const affectedParticipants = new Set<string>(); // `${challengeId}:${userId}`

    for (const challenge of challenges) {
      const activeParticipants = await tx
        .select({ userId: challengeParticipantsTable.userId })
        .from(challengeParticipantsTable)
        .where(
          and(
            eq(challengeParticipantsTable.challengeId, challenge.id),
            eq(challengeParticipantsTable.status, "active"),
          ),
        );

      for (const { userId } of activeParticipants) {
        const pred = predictionByUser.get(userId);
        if (!pred) continue; // No prediction => 0 points, no ledger entry.
        const { outcome, points } = scorePrediction(
          { home: pred.homeScore, away: pred.awayScore },
          actual,
          rules,
        );
        await tx.insert(pointsLedgerTable).values({
          userId,
          challengeId: challenge.id,
          matchId,
          predictionId: pred.id,
          points,
          reason: outcome,
        });
        affectedParticipants.add(`${challenge.id}:${userId}`);
      }
    }

    // 3) Recompute aggregates for each affected (challenge, user).
    for (const key of affectedParticipants) {
      const [challengeId, userId] = key.split(":");
      const challenge = challenges.find((c) => c.id === challengeId);
      if (!challenge) continue;
      await recomputeParticipant(tx, challenge, userId);
    }

    // 4) Snapshot standings (challenge + global) so reads can report rank
    // movement since this scoring run.
    const affectedChallengeIds = new Set(
      [...affectedParticipants].map((k) => k.split(":")[0]),
    );
    for (const challengeId of affectedChallengeIds) {
      await snapshotChallengeRanking(tx, challengeId);
    }
    if (predictions.length > 0) {
      await snapshotGlobalRanking(tx);
    }

    return {
      matchId,
      scored: true,
      predictionsScored: predictions.length,
      challengesAffected: challenges.length,
    };
  });
}

// Recompute a participant's points/exact/total from the ledger + scored
// predictions within the challenge's match set.
async function recomputeParticipant(
  tx: Tx,
  challenge: Challenge,
  userId: string,
): Promise<void> {
  const [{ points }] = await tx
    .select({
      points: sql<number>`coalesce(cast(sum(${pointsLedgerTable.points}) as int), 0)`,
    })
    .from(pointsLedgerTable)
    .where(
      and(
        eq(pointsLedgerTable.challengeId, challenge.id),
        eq(pointsLedgerTable.userId, userId),
      ),
    );

  const matchIds = await matchIdsForChallenge(challenge);
  let total = 0;
  let exact = 0;
  if (matchIds.length) {
    const rows = await tx
      .select({
        outcome: predictionsTable.outcome,
      })
      .from(predictionsTable)
      .where(
        and(
          eq(predictionsTable.userId, userId),
          inArray(predictionsTable.matchId, matchIds),
          sql`${predictionsTable.scoredAt} is not null`,
        ),
      );
    total = rows.length;
    exact = rows.filter((r) => r.outcome === "exact").length;
  }

  await tx
    .update(challengeParticipantsTable)
    .set({ points, exactPredictions: exact, totalPredictions: total })
    .where(
      and(
        eq(challengeParticipantsTable.challengeId, challenge.id),
        eq(challengeParticipantsTable.userId, userId),
      ),
    );
}

// Convenience: score all currently-final matches (used by sync/cron and the
// admin/dev trigger). Returns per-match results.
export async function applyScoringForFinalMatches(): Promise<
  MatchScoringResult[]
> {
  const finals = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(
      inArray(matchesTable.status, ["finished", "full_time"]),
    );
  const results: MatchScoringResult[] = [];
  for (const m of finals) {
    results.push(await applyScoringForMatch(m.id));
  }
  return results;
}
