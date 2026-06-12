import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  levelsTable,
  badgesTable,
  userBadgesTable,
  achievementsTable,
  userAchievementsTable,
  challengesTable,
  challengeParticipantsTable,
  predictionsTable,
  matchesTable,
  teamsTable,
  profilesTable,
  type Badge,
  type Level,
  type Achievement,
} from "@workspace/db";
import { matchIdsForChallenge } from "./challengeMatches";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Gamification engine: levels, badges, and Hall of Fame achievements.
//
// Levels and the per-user totalPoints column are derived from GLOBAL stats —
// the sum of pointsAwarded across all of a user's scored predictions — which
// mirrors the global ranking semantics in services/scoring/rankings.ts.
//
// Badge award rules are deterministic thresholds (no "top N" comparisons) so a
// user either qualifies or not. Achievements are permanent and awarded once:
// challenge-scoped awards are idempotent via the composite UNIQUE constraint;
// global (challengeId IS NULL) awards are deduped by a check-then-insert under
// the advisory lock below (Postgres UNIQUE does not dedupe NULLs).
// ---------------------------------------------------------------------------

// Advisory-lock namespace for serializing global (challengeId IS NULL)
// achievement awards per (user, achievement). Uses the TWO-key advisory space
// (int4, int4) via pg_advisory_xact_lock(ns, hashtext(key)) — distinct from the
// single-key football lock and the participant-pool namespace, so none collide.
const GLOBAL_ACHIEVEMENT_LOCK_NS = 471708;

// Earnable badge thresholds. Kept here (not in the DB criteria column) so the
// rules live next to the code that evaluates them.
export const BADGE_THRESHOLDS = {
  prediction_king: { exact: 10 },
  goal_master: { goalDifference: 10 },
  saudi_expert: { saudiCorrect: 5 },
  elite_predictor: { minTotal: 20, minAccuracy: 0.5 },
} as const;

export interface GlobalUserStats {
  totalPoints: number;
  totalPredictions: number;
  exactPredictions: number;
  correctPredictions: number;
  goalDifferencePredictions: number;
  saudiCorrect: number;
}

type LevelCode = Level["level"];

// Global per-user prediction stats from scored predictions only.
export async function computeGlobalUserStats(
  userId: string,
): Promise<GlobalUserStats> {
  const [row] = await db
    .select({
      points: sql<number>`cast(coalesce(sum(${predictionsTable.pointsAwarded}),0) as int)`,
      total: sql<number>`cast(count(*) as int)`,
      exact: sql<number>`cast(count(*) filter (where ${predictionsTable.outcome} = 'exact') as int)`,
      correct: sql<number>`cast(count(*) filter (where ${predictionsTable.outcome} in ('exact','winner')) as int)`,
      goalDiff: sql<number>`cast(count(*) filter (where ${predictionsTable.outcome} = 'goal_difference') as int)`,
    })
    .from(predictionsTable)
    .where(
      and(
        eq(predictionsTable.userId, userId),
        sql`${predictionsTable.scoredAt} is not null`,
      ),
    );

  // Correct predictions on Saudi matches (team countryCode 'sa' or code 'ksa').
  const [saudi] = await db
    .select({
      saudiCorrect: sql<number>`cast(count(*) as int)`,
    })
    .from(predictionsTable)
    .innerJoin(matchesTable, eq(predictionsTable.matchId, matchesTable.id))
    .leftJoin(
      teamsTable,
      sql`${teamsTable.id} = ${matchesTable.homeTeamId} or ${teamsTable.id} = ${matchesTable.awayTeamId}`,
    )
    .where(
      and(
        eq(predictionsTable.userId, userId),
        sql`${predictionsTable.scoredAt} is not null`,
        sql`${predictionsTable.outcome} in ('exact','winner')`,
        sql`lower(coalesce(${teamsTable.countryCode}, '')) = 'sa' or lower(coalesce(${teamsTable.code}, '')) in ('sa','ksa')`,
      ),
    );

  return {
    totalPoints: row?.points ?? 0,
    totalPredictions: row?.total ?? 0,
    exactPredictions: row?.exact ?? 0,
    correctPredictions: row?.correct ?? 0,
    goalDifferencePredictions: row?.goalDiff ?? 0,
    saudiCorrect: saudi?.saudiCorrect ?? 0,
  };
}

// Ordered levels (Bronze..Legend), cached for the lifetime of the process is
// unnecessary — there are only five rows and they are read rarely.
async function orderedLevels(): Promise<Level[]> {
  return db.select().from(levelsTable).orderBy(levelsTable.orderIndex);
}

export function levelForPoints(levels: Level[], points: number): Level {
  let current = levels[0];
  for (const l of levels) {
    if (points >= l.minPoints) current = l;
  }
  return current;
}

export interface LevelProgress {
  level: LevelCode;
  nameEn: string;
  nameAr: string;
  minPoints: number;
  nextLevel: LevelCode | null;
  nextLevelNameEn: string | null;
  nextLevelNameAr: string | null;
  nextLevelMinPoints: number | null;
  pointsIntoLevel: number;
  pointsToNextLevel: number | null;
  progressPercent: number;
}

export async function buildLevelProgress(points: number): Promise<LevelProgress> {
  const levels = await orderedLevels();
  const current = levelForPoints(levels, points);
  const idx = levels.findIndex((l) => l.level === current.level);
  const next = idx >= 0 && idx < levels.length - 1 ? levels[idx + 1] : null;

  const pointsIntoLevel = Math.max(0, points - current.minPoints);
  let pointsToNextLevel: number | null = null;
  let progressPercent = 100;
  if (next) {
    const span = next.minPoints - current.minPoints;
    pointsToNextLevel = Math.max(0, next.minPoints - points);
    progressPercent =
      span > 0 ? Math.min(100, Math.round((pointsIntoLevel / span) * 100)) : 0;
  }

  return {
    level: current.level,
    nameEn: current.nameEn,
    nameAr: current.nameAr,
    minPoints: current.minPoints,
    nextLevel: next?.level ?? null,
    nextLevelNameEn: next?.nameEn ?? null,
    nextLevelNameAr: next?.nameAr ?? null,
    nextLevelMinPoints: next?.minPoints ?? null,
    pointsIntoLevel,
    pointsToNextLevel,
    progressPercent,
  };
}

export interface RecomputeResult {
  totalPoints: number;
  previousLevel: LevelCode;
  newLevel: LevelCode;
  leveledUp: boolean;
}

// Recompute the user's denormalized totalPoints + level from global stats.
export async function recomputeUserTotals(
  userId: string,
): Promise<RecomputeResult | null> {
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });
  if (!user) return null;

  const stats = await computeGlobalUserStats(userId);
  const levels = await orderedLevels();
  const newLevel = levelForPoints(levels, stats.totalPoints).level;
  const previousLevel = user.level;

  if (user.totalPoints !== stats.totalPoints || user.level !== newLevel) {
    await db
      .update(usersTable)
      .set({ totalPoints: stats.totalPoints, level: newLevel, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  const order = (lvl: LevelCode) =>
    levels.find((l) => l.level === lvl)?.orderIndex ?? 0;

  return {
    totalPoints: stats.totalPoints,
    previousLevel,
    newLevel,
    leveledUp: order(newLevel) > order(previousLevel),
  };
}

export function eligibleBadgeCodes(stats: GlobalUserStats): string[] {
  const codes: string[] = [];
  if (stats.exactPredictions >= BADGE_THRESHOLDS.prediction_king.exact)
    codes.push("prediction_king");
  if (
    stats.goalDifferencePredictions >= BADGE_THRESHOLDS.goal_master.goalDifference
  )
    codes.push("goal_master");
  if (stats.saudiCorrect >= BADGE_THRESHOLDS.saudi_expert.saudiCorrect)
    codes.push("saudi_expert");
  const accuracy =
    stats.totalPredictions > 0
      ? stats.correctPredictions / stats.totalPredictions
      : 0;
  if (
    stats.totalPredictions >= BADGE_THRESHOLDS.elite_predictor.minTotal &&
    accuracy >= BADGE_THRESHOLDS.elite_predictor.minAccuracy
  )
    codes.push("elite_predictor");
  return codes;
}

// Award any newly-earned badges for a user. Returns the badges that were just
// awarded (empty if none) so the caller can emit notifications.
export async function awardBadges(userId: string): Promise<Badge[]> {
  const stats = await computeGlobalUserStats(userId);
  const eligible = eligibleBadgeCodes(stats);
  if (eligible.length === 0) return [];

  const badges = await db
    .select()
    .from(badgesTable)
    .where(
      and(inArray(badgesTable.code, eligible), eq(badgesTable.isActive, true)),
    );
  if (badges.length === 0) return [];

  const already = await db
    .select({ badgeId: userBadgesTable.badgeId })
    .from(userBadgesTable)
    .where(
      and(
        eq(userBadgesTable.userId, userId),
        inArray(
          userBadgesTable.badgeId,
          badges.map((b) => b.id),
        ),
      ),
    );
  const have = new Set(already.map((a) => a.badgeId));
  const toAward = badges.filter((b) => !have.has(b.id));
  if (toAward.length === 0) return [];

  const inserted = await db
    .insert(userBadgesTable)
    .values(toAward.map((b) => ({ userId, badgeId: b.id })))
    .onConflictDoNothing({ target: [userBadgesTable.userId, userBadgesTable.badgeId] })
    .returning({ badgeId: userBadgesTable.badgeId });
  const insertedIds = new Set(inserted.map((r) => r.badgeId));
  return toAward.filter((b) => insertedIds.has(b.id));
}

async function achievementByCode(code: string): Promise<Achievement | undefined> {
  return db.query.achievementsTable.findFirst({
    where: eq(achievementsTable.code, code),
  });
}

// Award a single achievement to a user (idempotent). Returns the achievement
// when it was newly awarded, otherwise null.
async function awardAchievement(
  userId: string,
  code: string,
  challengeId: string | null,
): Promise<Achievement | null> {
  const ach = await achievementByCode(code);
  if (!ach) return null;
  // Global achievements (challengeId IS NULL) cannot rely on the composite
  // UNIQUE constraint for dedupe: Postgres treats NULLs as distinct, so
  // onConflictDoNothing never matches and each call would insert a new row.
  // Guard with a check-then-insert serialized by a transaction-scoped advisory
  // lock keyed on (user, achievement). This is necessary because the awarders
  // (evaluateTopPredictor via runPostScoring) run AFTER the football scoring
  // lock is released and from several entry points (scheduler, /matches/refresh,
  // /admin/sync, demo engine), so two could otherwise race the existence check
  // and both insert. The two-key advisory space is distinct from the football
  // and participant-pool locks, so they never collide.
  if (challengeId === null) {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${GLOBAL_ACHIEVEMENT_LOCK_NS}, hashtext(${`${userId}:${ach.id}`}))`,
      );
      const existing = await tx
        .select({ id: userAchievementsTable.id })
        .from(userAchievementsTable)
        .where(
          and(
            eq(userAchievementsTable.userId, userId),
            eq(userAchievementsTable.achievementId, ach.id),
            isNull(userAchievementsTable.challengeId),
          ),
        )
        .limit(1);
      if (existing.length > 0) return null;
      const inserted = await tx
        .insert(userAchievementsTable)
        .values({ userId, achievementId: ach.id, challengeId: null })
        .returning({ id: userAchievementsTable.id });
      return inserted.length > 0 ? ach : null;
    });
  }
  const inserted = await db
    .insert(userAchievementsTable)
    .values({ userId, achievementId: ach.id, challengeId })
    .onConflictDoNothing({
      target: [
        userAchievementsTable.userId,
        userAchievementsTable.achievementId,
        userAchievementsTable.challengeId,
      ],
    })
    .returning({ id: userAchievementsTable.id });
  return inserted.length > 0 ? ach : null;
}

export interface CompetitionWin {
  userId: string;
  challengeId: string;
  challengeName: string;
  achievements: Achievement[];
}

// Detect whether a challenge is finished (all its matches are final) and, if so,
// mark it completed and award winner achievements. Returns the wins (one per
// rank-1 participant) for notification emission. Safe to call repeatedly.
export async function evaluateChallengeCompletion(
  challengeId: string,
): Promise<CompetitionWin[]> {
  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, challengeId),
  });
  if (!challenge || challenge.status === "completed" || challenge.status === "cancelled")
    return [];

  const matchIds = await matchIdsForChallenge(challenge);
  if (matchIds.length === 0) return [];

  const [{ pending }] = await db
    .select({
      pending: sql<number>`cast(count(*) filter (where ${matchesTable.status} not in ('finished','full_time')) as int)`,
    })
    .from(matchesTable)
    .where(inArray(matchesTable.id, matchIds));
  if ((pending ?? 0) > 0) return []; // Still in progress.

  // Mark completed atomically; only the transition winner proceeds to awards.
  const transitioned = await db
    .update(challengesTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(
      and(eq(challengesTable.id, challengeId), eq(challengesTable.status, "active")),
    )
    .returning({ id: challengesTable.id });
  if (transitioned.length === 0) return []; // Lost the race / not active.

  // Winner(s): top points among active participants (ties share rank 1).
  const participants = await db
    .select({
      userId: challengeParticipantsTable.userId,
      points: challengeParticipantsTable.points,
    })
    .from(challengeParticipantsTable)
    .where(
      and(
        eq(challengeParticipantsTable.challengeId, challengeId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    )
    .orderBy(desc(challengeParticipantsTable.points));

  if (participants.length === 0) return [];
  const topPoints = participants[0].points;
  if (topPoints <= 0) return []; // Nobody scored — no winner.
  const winners = participants.filter((p) => p.points === topPoints);

  const wins: CompetitionWin[] = [];
  for (const w of winners) {
    const awarded: Achievement[] = [];
    const cw = await awardAchievement(w.userId, "competition_winner", challengeId);
    if (cw) awarded.push(cw);
    if (challenge.scope === "entire_tournament") {
      const wc = await awardAchievement(w.userId, "world_cup_champion", challengeId);
      if (wc) awarded.push(wc);
    }
    wins.push({
      userId: w.userId,
      challengeId,
      challengeName: challenge.name,
      achievements: awarded,
    });
  }
  return wins;
}

// Award the Top Predictor Hall of Fame achievement to the current global #1
// (requires a positive point total). Returns the userId when newly awarded.
export async function evaluateTopPredictor(): Promise<string | null> {
  const [top] = await db
    .select({
      userId: predictionsTable.userId,
      points: sql<number>`cast(coalesce(sum(${predictionsTable.pointsAwarded}),0) as int)`,
    })
    .from(predictionsTable)
    .where(sql`${predictionsTable.scoredAt} is not null`)
    .groupBy(predictionsTable.userId)
    .orderBy(sql`coalesce(sum(${predictionsTable.pointsAwarded}),0) desc`)
    .limit(1);
  if (!top || top.points <= 0) return null;
  const awarded = await awardAchievement(top.userId, "top_predictor", null);
  return awarded ? top.userId : null;
}

// Reconcile a user's EARNABLE badges against their CURRENT global stats: revoke
// any deterministic-threshold badge they no longer qualify for. This is the
// inverse of awardBadges and is used to roll back badges that were earned only
// via data that has since been removed (e.g. live demo-harness teardown), so the
// outcome is identical to re-deriving the user's badges from scratch on the
// remaining data — never a time-window guess. Permanent achievements are not
// touched here (see reconcileTopPredictor for the one global achievement).
export async function reconcileUserBadges(userId: string): Promise<void> {
  const stats = await computeGlobalUserStats(userId);
  const eligible = new Set(eligibleBadgeCodes(stats));
  const toRevoke = (Object.keys(BADGE_THRESHOLDS) as string[]).filter(
    (code) => !eligible.has(code),
  );
  if (toRevoke.length === 0) return;
  const badges = await db
    .select({ id: badgesTable.id })
    .from(badgesTable)
    .where(inArray(badgesTable.code, toRevoke));
  if (badges.length === 0) return;
  await db.delete(userBadgesTable).where(
    and(
      eq(userBadgesTable.userId, userId),
      inArray(
        userBadgesTable.badgeId,
        badges.map((b) => b.id),
      ),
    ),
  );
}

// Reconcile the global Top Predictor achievement after data removal. Among the
// given candidate users, revoke `top_predictor` from anyone who is NOT the
// current global #1 (they only held it because of since-removed data), then
// re-award it to the genuine current leader. Revocation is strictly scoped to
// `candidateUserIds`, so unrelated holders' permanent awards are never touched.
export async function reconcileTopPredictor(
  candidateUserIds: string[],
): Promise<void> {
  const [top] = await db
    .select({
      userId: predictionsTable.userId,
      points: sql<number>`cast(coalesce(sum(${predictionsTable.pointsAwarded}),0) as int)`,
    })
    .from(predictionsTable)
    .where(sql`${predictionsTable.scoredAt} is not null`)
    .groupBy(predictionsTable.userId)
    .orderBy(sql`coalesce(sum(${predictionsTable.pointsAwarded}),0) desc`)
    .limit(1);
  const currentTopId = top && top.points > 0 ? top.userId : null;

  const toRevoke = candidateUserIds.filter((id) => id !== currentTopId);
  if (toRevoke.length > 0) {
    const ach = await achievementByCode("top_predictor");
    if (ach) {
      await db.delete(userAchievementsTable).where(
        and(
          inArray(userAchievementsTable.userId, toRevoke),
          eq(userAchievementsTable.achievementId, ach.id),
          isNull(userAchievementsTable.challengeId),
        ),
      );
    }
  }
  await evaluateTopPredictor();
}

export interface PublicProfile {
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export async function publicProfile(userId: string): Promise<PublicProfile> {
  const p = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.userId, userId),
  });
  return {
    displayName: p?.displayName ?? null,
    username: p?.username ?? null,
    avatarUrl: p?.avatarUrl ?? null,
  };
}

export interface AggregateStats {
  totalPoints: number;
  competitionsJoined: number;
  competitionsWon: number;
  totalPredictions: number;
  exactPredictions: number;
  accuracy: number;
}

export async function aggregateStats(userId: string): Promise<AggregateStats> {
  const stats = await computeGlobalUserStats(userId);

  const [{ joined }] = await db
    .select({ joined: sql<number>`cast(count(*) as int)` })
    .from(challengeParticipantsTable)
    .where(
      and(
        eq(challengeParticipantsTable.userId, userId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    );

  const [{ won }] = await db
    .select({
      won: sql<number>`cast(count(distinct ${userAchievementsTable.challengeId}) as int)`,
    })
    .from(userAchievementsTable)
    .innerJoin(
      achievementsTable,
      eq(userAchievementsTable.achievementId, achievementsTable.id),
    )
    .where(
      and(
        eq(userAchievementsTable.userId, userId),
        eq(achievementsTable.code, "competition_winner"),
      ),
    );

  const accuracy =
    stats.totalPredictions > 0
      ? Math.round((stats.correctPredictions / stats.totalPredictions) * 1000) / 10
      : 0;

  return {
    totalPoints: stats.totalPoints,
    competitionsJoined: joined ?? 0,
    competitionsWon: won ?? 0,
    totalPredictions: stats.totalPredictions,
    exactPredictions: stats.exactPredictions,
    accuracy,
  };
}

export interface EarnedBadgeRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  iconUrl: string | null;
  awardedAt: Date;
}

export async function earnedBadges(userId: string): Promise<EarnedBadgeRow[]> {
  const rows = await db
    .select({
      id: badgesTable.id,
      code: badgesTable.code,
      nameEn: badgesTable.nameEn,
      nameAr: badgesTable.nameAr,
      descriptionEn: badgesTable.descriptionEn,
      descriptionAr: badgesTable.descriptionAr,
      iconUrl: badgesTable.iconUrl,
      awardedAt: userBadgesTable.awardedAt,
    })
    .from(userBadgesTable)
    .innerJoin(badgesTable, eq(userBadgesTable.badgeId, badgesTable.id))
    .where(eq(userBadgesTable.userId, userId))
    .orderBy(desc(userBadgesTable.awardedAt));
  return rows;
}

export interface EarnedAchievementRow {
  id: string;
  code: string;
  type: Achievement["type"];
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  iconUrl: string | null;
  challengeId: string | null;
  awardedAt: Date;
}

export async function earnedAchievements(
  userId: string,
): Promise<EarnedAchievementRow[]> {
  const rows = await db
    .select({
      id: achievementsTable.id,
      code: achievementsTable.code,
      type: achievementsTable.type,
      nameEn: achievementsTable.nameEn,
      nameAr: achievementsTable.nameAr,
      descriptionEn: achievementsTable.descriptionEn,
      descriptionAr: achievementsTable.descriptionAr,
      iconUrl: achievementsTable.iconUrl,
      challengeId: userAchievementsTable.challengeId,
      awardedAt: userAchievementsTable.awardedAt,
    })
    .from(userAchievementsTable)
    .innerJoin(
      achievementsTable,
      eq(userAchievementsTable.achievementId, achievementsTable.id),
    )
    .where(eq(userAchievementsTable.userId, userId))
    .orderBy(desc(userAchievementsTable.awardedAt));
  return rows;
}

// Wrapper that never throws: gamification is a side effect of scoring and must
// not break the scoring transaction's caller.
export async function safeRecomputeUserTotals(userId: string): Promise<void> {
  try {
    await recomputeUserTotals(userId);
  } catch (err) {
    logger.error({ err, userId }, "recomputeUserTotals failed");
  }
}
