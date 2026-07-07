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

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
  // Users whose predictions were (re)scored — drives global gamification.
  scoredUserIds: string[];
  // Challenges touched by this match — drives challenge completion detection.
  affectedChallengeIds: string[];
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
      scoredUserIds: [],
      affectedChallengeIds: [],
      reason: "match not found",
    };
  }
  if (!isFinal(match)) {
    return {
      matchId,
      scored: false,
      predictionsScored: 0,
      challengesAffected: 0,
      scoredUserIds: [],
      affectedChallengeIds: [],
      reason: "match not final",
    };
  }

  // Run the whole rewrite atomically under the football advisory lock so a
  // concurrent scoring/sync run cannot interleave and duplicate ledger rows.
  return db.transaction(async (tx) => {
    await acquireFootballLock(tx);

    // Re-read the match INSIDE the transaction so the scores we score against —
    // and the watermark we stamp below — reflect the row's committed state at
    // scoring time, never a value that changed between the pre-check read above
    // and acquiring the lock.
    const fresh = await tx.query.matchesTable.findFirst({
      where: eq(matchesTable.id, matchId),
    });
    if (!fresh || !isFinal(fresh)) {
      return {
        matchId,
        scored: false,
        predictionsScored: 0,
        challengesAffected: 0,
        scoredUserIds: [],
        affectedChallengeIds: [],
        reason: "match not final",
      };
    }
    const actual = { home: fresh.homeScore!, away: fresh.awayScore! };

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

    // 5) Stamp the scoring watermark (inside the tx, with the scores we scored
    // against) so the incremental scorer skips this match until its score
    // changes again — a post-final correction sets a different home/away and the
    // "IS DISTINCT FROM" predicate re-selects it.
    await tx
      .update(matchesTable)
      .set({
        scoredAt: now,
        scoredHomeScore: actual.home,
        scoredAwayScore: actual.away,
      })
      .where(eq(matchesTable.id, matchId));

    return {
      matchId,
      scored: true,
      predictionsScored: predictions.length,
      challengesAffected: challenges.length,
      scoredUserIds: [...new Set(predictions.map((p) => p.userId))],
      affectedChallengeIds: challenges.map((c) => c.id),
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

// Convenience: score ALL currently-final matches (used by boot and the
// admin/dev trigger as a full-rescan backstop). Heavy at scale — the hot
// request/scheduler path uses applyScoringForPendingMatches instead. Returns
// per-match results.
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

// Incremental scorer for the hot path (opportunistic refresh + scheduler cycle).
// Only touches final matches whose watermark is missing (never scored) or stale
// (a post-final score correction), so a cycle does O(newly-final) work instead
// of re-scoring every finished match. This is what makes points land the moment
// a match ends without the per-cycle cost growing with the fixture list.
export async function applyScoringForPendingMatches(): Promise<
  MatchScoringResult[]
> {
  const pending = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(
      and(
        inArray(matchesTable.status, ["finished", "full_time"]),
        // Only scorable rows: a finished match with null scores can never be
        // watermarked (isFinal is false), so without this guard it would match
        // the staleness predicate forever and keep the hot path busy for nothing.
        sql`${matchesTable.homeScore} is not null`,
        sql`${matchesTable.awayScore} is not null`,
        or(
          isNull(matchesTable.scoredAt),
          sql`${matchesTable.scoredHomeScore} is distinct from ${matchesTable.homeScore}`,
          sql`${matchesTable.scoredAwayScore} is distinct from ${matchesTable.awayScore}`,
        ),
      ),
    );
  const results: MatchScoringResult[] = [];
  for (const m of pending) {
    results.push(await applyScoringForMatch(m.id));
  }
  return results;
}

export interface ChallengeBackfillResult {
  challengeId: string;
  matchesBackfilled: number;
  participantsAffected: number;
}

// Best-effort backfill scoped to ONE challenge. Called after a challenge is
// created or a participant joins, so a member's pre-existing global predictions
// on matches that finished BEFORE they joined are attributed to this challenge.
// The incremental scorer can't do this (those matches are already watermarked),
// and the narrowed hot path no longer full-rescans every cycle to cover it.
//
// Unlike applyScoringForMatch (which re-scores EVERY challenge on the match plus
// the global ranking snapshot), this rewrites the ledger + standings for the
// GIVEN challenge only, so joining a whole-tournament challenge does O(finals)
// light writes under a single lock instead of O(finals) full per-match rewrites
// (which, unbounded, could time out the request or starve live scoring of the
// shared football lock). The other challenges and the global ranking were
// already correct from when each match first scored; a late join doesn't change
// global prediction scoring, only this challenge's attribution.
//
// Idempotent: delete-then-insert this challenge's ledger rows per match, all
// serialized with scoring/sync on the shared football advisory lock.
export async function backfillScoringForChallenge(
  challenge: Challenge,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
): Promise<ChallengeBackfillResult> {
  const matchIds = await matchIdsForChallenge(challenge);
  if (matchIds.length === 0) {
    return { challengeId: challenge.id, matchesBackfilled: 0, participantsAffected: 0 };
  }

  // Only matches that are final AND carry real scores can be attributed; a
  // finished row with null scores isn't scorable yet, so skip it.
  const finals = await db
    .select({
      id: matchesTable.id,
      homeScore: matchesTable.homeScore,
      awayScore: matchesTable.awayScore,
    })
    .from(matchesTable)
    .where(
      and(
        inArray(matchesTable.id, matchIds),
        inArray(matchesTable.status, ["finished", "full_time"]),
        sql`${matchesTable.homeScore} is not null`,
        sql`${matchesTable.awayScore} is not null`,
      ),
    );
  if (finals.length === 0) {
    return { challengeId: challenge.id, matchesBackfilled: 0, participantsAffected: 0 };
  }

  return db.transaction(async (tx) => {
    await acquireFootballLock(tx);

    const activeParticipants = await tx
      .select({ userId: challengeParticipantsTable.userId })
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, challenge.id),
          eq(challengeParticipantsTable.status, "active"),
        ),
      );
    const userIds = activeParticipants.map((p) => p.userId);
    if (userIds.length === 0) {
      return {
        challengeId: challenge.id,
        matchesBackfilled: finals.length,
        participantsAffected: 0,
      };
    }

    const affectedUsers = new Set<string>();
    for (const m of finals) {
      const actual = { home: m.homeScore!, away: m.awayScore! };
      const preds = await tx
        .select()
        .from(predictionsTable)
        .where(
          and(
            eq(predictionsTable.matchId, m.id),
            inArray(predictionsTable.userId, userIds),
          ),
        );

      // Idempotency: clear THIS challenge's prior ledger rows for the match
      // before re-inserting. Overlap with applyScoringForMatch's own
      // delete-then-insert converges — both hold the same advisory lock.
      await tx
        .delete(pointsLedgerTable)
        .where(
          and(
            eq(pointsLedgerTable.challengeId, challenge.id),
            eq(pointsLedgerTable.matchId, m.id),
          ),
        );

      for (const pred of preds) {
        const { outcome, points } = scorePrediction(
          { home: pred.homeScore, away: pred.awayScore },
          actual,
          rules,
        );
        await tx.insert(pointsLedgerTable).values({
          userId: pred.userId,
          challengeId: challenge.id,
          matchId: m.id,
          predictionId: pred.id,
          points,
          reason: outcome,
        });
        affectedUsers.add(pred.userId);
      }
    }

    for (const userId of affectedUsers) {
      await recomputeParticipant(tx, challenge, userId);
    }
    if (affectedUsers.size > 0) {
      await snapshotChallengeRanking(tx, challenge.id);
    }

    return {
      challengeId: challenge.id,
      matchesBackfilled: finals.length,
      participantsAffected: affectedUsers.size,
    };
  });
}
