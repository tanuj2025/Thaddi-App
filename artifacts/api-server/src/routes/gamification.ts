import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  levelsTable,
  badgesTable,
  achievementsTable,
  userAchievementsTable,
  challengesTable,
} from "@workspace/db";
import { requireCurrentUser } from "../lib/currentUser";
import {
  buildLevelProgress,
  aggregateStats,
  earnedBadges,
  earnedAchievements,
  publicProfile,
} from "../lib/gamification";

const router: IRouter = Router();

function serializeBadge(b: Awaited<ReturnType<typeof earnedBadges>>[number]) {
  return {
    id: b.id,
    code: b.code,
    nameEn: b.nameEn,
    nameAr: b.nameAr,
    descriptionEn: b.descriptionEn ?? null,
    descriptionAr: b.descriptionAr ?? null,
    iconUrl: b.iconUrl ?? null,
    awardedAt: b.awardedAt,
  };
}

function serializeAchievement(
  a: Awaited<ReturnType<typeof earnedAchievements>>[number],
) {
  return {
    id: a.id,
    code: a.code,
    type: a.type,
    nameEn: a.nameEn,
    nameAr: a.nameAr,
    descriptionEn: a.descriptionEn ?? null,
    descriptionAr: a.descriptionAr ?? null,
    iconUrl: a.iconUrl ?? null,
    challengeId: a.challengeId ?? null,
    awardedAt: a.awardedAt,
  };
}

router.get("/me/gamification", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const userId = record.user.id;
  const stats = await aggregateStats(userId);
  const [levelProgress, badges, achievements] = await Promise.all([
    buildLevelProgress(stats.totalPoints),
    earnedBadges(userId),
    earnedAchievements(userId),
  ]);
  res.json({
    userId,
    levelProgress,
    stats,
    badges: badges.map(serializeBadge),
    achievements: achievements.map(serializeAchievement),
  });
});

router.get("/users/:id/gamification", async (req, res) => {
  const userId = req.params.id;
  const profile = await publicProfile(userId);
  const stats = await aggregateStats(userId);
  // A user with no profile and no activity does not exist publicly.
  if (
    !profile.displayName &&
    !profile.username &&
    stats.totalPredictions === 0 &&
    stats.competitionsJoined === 0
  ) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const [levelProgress, badges, achievements] = await Promise.all([
    buildLevelProgress(stats.totalPoints),
    earnedBadges(userId),
    earnedAchievements(userId),
  ]);
  res.json({
    userId,
    displayName: profile.displayName,
    username: profile.username,
    avatarUrl: profile.avatarUrl,
    levelProgress,
    stats,
    badges: badges.map(serializeBadge),
    achievements: achievements.map(serializeAchievement),
  });
});

router.get("/hall-of-fame", async (_req, res) => {
  // Collapse duplicates per (user, achievement, challenge). Global achievements
  // (challengeId IS NULL) can accumulate multiple rows because a UNIQUE
  // constraint does not dedupe NULLs in Postgres; GROUP BY does treat NULLs as
  // equal, so grouping yields one entry per distinct award and keeps the latest
  // awardedAt. The limit then applies to distinct entries, so no user is pushed
  // out by another user's duplicate rows.
  const rows = await db
    .select({
      userId: userAchievementsTable.userId,
      achievementCode: achievementsTable.code,
      achievementNameEn: achievementsTable.nameEn,
      achievementNameAr: achievementsTable.nameAr,
      challengeId: userAchievementsTable.challengeId,
      awardedAt: sql<string>`max(${userAchievementsTable.awardedAt})`,
    })
    .from(userAchievementsTable)
    .innerJoin(
      achievementsTable,
      eq(userAchievementsTable.achievementId, achievementsTable.id),
    )
    .where(eq(achievementsTable.type, "hall_of_fame"))
    .groupBy(
      userAchievementsTable.userId,
      achievementsTable.code,
      achievementsTable.nameEn,
      achievementsTable.nameAr,
      userAchievementsTable.challengeId,
    )
    .orderBy(desc(sql`max(${userAchievementsTable.awardedAt})`))
    .limit(50);

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const challengeIds = [
    ...new Set(rows.map((r) => r.challengeId).filter((x): x is string => !!x)),
  ];

  const profiles = new Map<
    string,
    { displayName: string | null; username: string | null; avatarUrl: string | null }
  >();
  await Promise.all(
    userIds.map(async (id) => profiles.set(id, await publicProfile(id))),
  );

  const challengeNames = new Map<string, string>();
  if (challengeIds.length) {
    const cs = await db
      .select({ id: challengesTable.id, name: challengesTable.name })
      .from(challengesTable);
    for (const c of cs) challengeNames.set(c.id, c.name);
  }

  res.json({
    entries: rows.map((r) => {
      const p = profiles.get(r.userId);
      return {
        userId: r.userId,
        displayName: p?.displayName ?? null,
        username: p?.username ?? null,
        avatarUrl: p?.avatarUrl ?? null,
        achievementCode: r.achievementCode,
        achievementNameEn: r.achievementNameEn,
        achievementNameAr: r.achievementNameAr,
        challengeId: r.challengeId ?? null,
        challengeName: r.challengeId
          ? challengeNames.get(r.challengeId) ?? null
          : null,
        awardedAt: r.awardedAt,
      };
    }),
  });
});

router.get("/badges", async (_req, res) => {
  const rows = await db
    .select()
    .from(badgesTable)
    .where(eq(badgesTable.isActive, true));
  res.json(
    rows.map((b) => ({
      id: b.id,
      code: b.code,
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      descriptionEn: b.descriptionEn ?? null,
      descriptionAr: b.descriptionAr ?? null,
      iconUrl: b.iconUrl ?? null,
    })),
  );
});

router.get("/levels", async (_req, res) => {
  const rows = await db
    .select()
    .from(levelsTable)
    .orderBy(levelsTable.orderIndex);
  res.json(
    rows.map((l) => ({
      level: l.level,
      nameEn: l.nameEn,
      nameAr: l.nameAr,
      minPoints: l.minPoints,
      orderIndex: l.orderIndex,
      iconUrl: l.iconUrl ?? null,
    })),
  );
});

export default router;
