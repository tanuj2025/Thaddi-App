// Post-commit side effects of scoring: gamification (levels/badges/achievements)
// and event notifications. These run AFTER the scoring transaction has committed
// so they read the final committed state (mirrors the rankings snapshot baseline
// rule). Everything here is best-effort and must never throw to the caller.

import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  rankingsTable,
  matchesTable,
  challengesTable,
  challengeParticipantsTable,
  predictionsTable,
  teamsTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import {
  recomputeUserTotals,
  awardBadges,
  evaluateChallengeCompletion,
  evaluateTopPredictor,
} from "../../lib/gamification";
import { notify, notifyOnce } from "../notifications";
import { matchIdsForChallenge } from "../../lib/challengeMatches";
import type { MatchScoringResult } from "./engine";

// Latest global rank per user from the rankings snapshots.
async function latestGlobalRanks(
  userIds: string[],
): Promise<Map<string, { rank: number; previousRank: number | null }>> {
  const map = new Map<string, { rank: number; previousRank: number | null }>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      userId: rankingsTable.userId,
      rank: rankingsTable.rank,
      previousRank: rankingsTable.previousRank,
      computedAt: rankingsTable.computedAt,
    })
    .from(rankingsTable)
    .where(
      and(
        eq(rankingsTable.scope, "global"),
        inArray(rankingsTable.userId, userIds),
      ),
    )
    .orderBy(desc(rankingsTable.computedAt));
  for (const r of rows) {
    if (!map.has(r.userId)) {
      map.set(r.userId, { rank: r.rank, previousRank: r.previousRank });
    }
  }
  return map;
}

// Orchestrates all post-scoring side effects for a batch of match results.
export async function runPostScoring(
  results: MatchScoringResult[],
): Promise<void> {
  try {
    const scoredResults = results.filter((r) => r.scored);
    if (scoredResults.length === 0) return;

    const userIds = [
      ...new Set(scoredResults.flatMap((r) => r.scoredUserIds)),
    ];
    const challengeIds = [
      ...new Set(scoredResults.flatMap((r) => r.affectedChallengeIds)),
    ];

    // 1) Direct prediction_scored notifications for every user who predicted on a scored match.
    for (const r of scoredResults) {
      try {
        const labels = await teamLabels(r.matchId);
        const preds = await db
          .select({
            userId: predictionsTable.userId,
            outcome: predictionsTable.outcome,
            pointsAwarded: predictionsTable.pointsAwarded,
          })
          .from(predictionsTable)
          .where(eq(predictionsTable.matchId, r.matchId));

        for (const p of preds) {
          try {
            await notifyOnce(p.userId, "prediction_scored", "matchId", r.matchId, {
              pointsAwarded: p.pointsAwarded,
              outcome: p.outcome,
              matchId: r.matchId,
              ...labels,
            });
          } catch (err) {
            logger.error(
              { err, matchId: r.matchId, userId: p.userId },
              "post-scoring prediction notification failed",
            );
          }
        }
      } catch (err) {
        logger.error(
          { err, matchId: r.matchId },
          "post-scoring match notification loop failed",
        );
      }
    }

    // 2) Recompute totals/levels and award badges; notify badge unlocks.
    for (const userId of userIds) {
      try {
        await recomputeUserTotals(userId);
        const newBadges = await awardBadges(userId);
        for (const b of newBadges) {
          await notify(userId, "badge_unlocked", {
            badgeCode: b.code,
            badgeNameEn: b.nameEn,
            badgeNameAr: b.nameAr,
          });
        }
      } catch (err) {
        logger.error({ err, userId }, "post-scoring gamification (user) failed");
      }
    }

    // 3) Ranking-change notifications (global + challenge) for affected users.
    const ranks = await latestGlobalRanks(userIds);
    for (const userId of userIds) {
      const r = ranks.get(userId);
      if (r && r.previousRank != null && r.rank !== r.previousRank) {
        await notify(userId, "ranking_updated", {
          scope: "global",
          rank: r.rank,
        });
      }
    }

    for (const challengeId of challengeIds) {
      try {
        const challenge = await db.query.challengesTable.findFirst({
          where: eq(challengesTable.id, challengeId),
        });
        if (!challenge) continue;
        const cRanks = await db
          .select({
            userId: rankingsTable.userId,
            rank: rankingsTable.rank,
            previousRank: rankingsTable.previousRank,
          })
          .from(rankingsTable)
          .where(
            and(
              eq(rankingsTable.scope, "challenge"),
              eq(rankingsTable.challengeId, challengeId),
              inArray(rankingsTable.userId, userIds),
            ),
          )
          .orderBy(desc(rankingsTable.computedAt));
        const seen = new Set<string>();
        for (const cr of cRanks) {
          if (seen.has(cr.userId)) continue;
          seen.add(cr.userId);
          if (cr.previousRank != null && cr.rank !== cr.previousRank) {
            await notify(cr.userId, "ranking_updated", {
              scope: "challenge",
              challengeId: challenge.id,
              challengeName: challenge.name,
              rank: cr.rank,
            });
          }
        }
      } catch (err) {
        logger.error(
          { err, challengeId },
          "post-scoring challenge ranking notification failed",
        );
      }
    }

    // 4) Challenge completion → competition_won achievements + notifications.
    for (const challengeId of challengeIds) {
      try {
        const wins = await evaluateChallengeCompletion(challengeId);
        for (const w of wins) {
          await notify(w.userId, "competition_won", {
            challengeId: w.challengeId,
            challengeName: w.challengeName,
          });
        }
      } catch (err) {
        logger.error(
          { err, challengeId },
          "post-scoring challenge completion failed",
        );
      }
    }

    // 5) Global Top Predictor Hall of Fame achievement.
    await evaluateTopPredictor();
  } catch (err) {
    logger.error({ err }, "runPostScoring failed");
  }
}

// ---------------------------------------------------------------------------
// Time-based notifications, driven by the refresh cycle (no scheduler exists).
// Each reminder is one-shot per (user, entity) via notifyOnce.
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;

async function teamLabels(matchId: string): Promise<{
  homeEn?: string;
  homeAr?: string;
  awayEn?: string;
  awayAr?: string;
}> {
  const match = await db.query.matchesTable.findFirst({
    where: eq(matchesTable.id, matchId),
  });
  if (!match) return {};
  const ids = [match.homeTeamId, match.awayTeamId].filter(
    (x): x is string => !!x,
  );
  if (ids.length === 0) return {};
  const teams = await db
    .select({
      id: teamsTable.id,
      nameEn: teamsTable.nameEn,
      nameAr: teamsTable.nameAr,
    })
    .from(teamsTable)
    .where(inArray(teamsTable.id, ids));
  const byId = new Map(teams.map((t) => [t.id, t]));
  const home = match.homeTeamId ? byId.get(match.homeTeamId) : undefined;
  const away = match.awayTeamId ? byId.get(match.awayTeamId) : undefined;
  return {
    homeEn: home?.nameEn,
    homeAr: home?.nameAr,
    awayEn: away?.nameEn,
    awayAr: away?.nameAr,
  };
}

// Active participants across all challenges that include the given match.
async function participantsForMatch(matchId: string): Promise<string[]> {
  const challenges = await db
    .select()
    .from(challengesTable)
    .where(eq(challengesTable.status, "active"));
  const userIds = new Set<string>();
  for (const c of challenges) {
    const ids = await matchIdsForChallenge(c);
    if (!ids.includes(matchId)) continue;
    const parts = await db
      .select({ userId: challengeParticipantsTable.userId })
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, c.id),
          eq(challengeParticipantsTable.status, "active"),
        ),
      );
    for (const p of parts) userIds.add(p.userId);
  }
  return [...userIds];
}

export async function runScheduledNotifications(): Promise<void> {
  try {
    const now = new Date();

    // --- prediction_closing: lock within next hour, still upcoming. Nudge
    // participants who have not yet predicted. ---
    const closingSoon = await db
      .select({ id: matchesTable.id, lockAt: matchesTable.predictionLockAt })
      .from(matchesTable)
      .where(
        and(
          eq(matchesTable.status, "scheduled"),
          gte(matchesTable.predictionLockAt, now),
          lte(matchesTable.predictionLockAt, new Date(now.getTime() + HOUR)),
        ),
      );
    for (const m of closingSoon) {
      const labels = await teamLabels(m.id);
      const participants = await participantsForMatch(m.id);
      for (const userId of participants) {
        const predicted = await db
          .select({ id: predictionsTable.id })
          .from(predictionsTable)
          .where(
            and(
              eq(predictionsTable.userId, userId),
              eq(predictionsTable.matchId, m.id),
            ),
          )
          .limit(1);
        if (predicted.length > 0) continue;
        await notifyOnce(userId, "prediction_closing", "matchId", m.id, labels);
      }
    }

    // --- match_starting: kickoff within next 30 minutes. ---
    const startingSoon = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(
        and(
          inArray(matchesTable.status, ["scheduled"]),
          gte(matchesTable.kickoffAt, now),
          lte(matchesTable.kickoffAt, new Date(now.getTime() + 30 * 60 * 1000)),
        ),
      );
    for (const m of startingSoon) {
      const labels = await teamLabels(m.id);
      const participants = await participantsForMatch(m.id);
      for (const userId of participants) {
        await notifyOnce(userId, "match_starting", "matchId", m.id, labels);
      }
    }

    // --- competition_ending: active challenge whose last match kicks off within
    // the next 24 hours. ---
    const active = await db
      .select()
      .from(challengesTable)
      .where(eq(challengesTable.status, "active"));
    for (const c of active) {
      const ids = await matchIdsForChallenge(c);
      if (ids.length === 0) continue;
      const [agg] = await db
        .select({ lastKickoff: sql<Date | null>`max(${matchesTable.kickoffAt})` })
        .from(matchesTable)
        .where(inArray(matchesTable.id, ids));
      const last = agg?.lastKickoff ? new Date(agg.lastKickoff) : null;
      if (!last) continue;
      if (last >= now && last <= new Date(now.getTime() + 24 * HOUR)) {
        const parts = await db
          .select({ userId: challengeParticipantsTable.userId })
          .from(challengeParticipantsTable)
          .where(
            and(
              eq(challengeParticipantsTable.challengeId, c.id),
              eq(challengeParticipantsTable.status, "active"),
            ),
          );
        for (const p of parts) {
          await notifyOnce(p.userId, "competition_ending", "challengeId", c.id, {
            challengeName: c.name,
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "runScheduledNotifications failed");
  }
}
