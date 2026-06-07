import { Router, type IRouter } from "express";
import { eq, count, asc } from "drizzle-orm";
import {
  db,
  featureFlagsTable,
  usersTable,
  challengesTable,
  predictionsTable,
  matchesTable,
  tournamentsTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/feature-flags", async (_req, res) => {
  const flags = await db.select().from(featureFlagsTable);
  res.json(
    flags.map((f) => ({
      key: f.key,
      name: f.name,
      description: f.description ?? null,
      enabled: f.enabled,
    })),
  );
});

router.get("/platform-stats", async (_req, res) => {
  const [users] = await db.select({ value: count() }).from(usersTable);
  const [challenges] = await db
    .select({ value: count() })
    .from(challengesTable);
  const [predictions] = await db
    .select({ value: count() })
    .from(predictionsTable);
  const [active] = await db
    .select({ value: count() })
    .from(challengesTable)
    .where(eq(challengesTable.status, "active"));

  // Earliest scheduled match of the active tournament — drives the public
  // World Cup countdown so it tracks the real, authoritative schedule.
  const [firstMatch] = await db
    .select({ kickoffAt: matchesTable.kickoffAt })
    .from(matchesTable)
    .innerJoin(
      tournamentsTable,
      eq(matchesTable.tournamentId, tournamentsTable.id),
    )
    .where(eq(tournamentsTable.isActive, true))
    .orderBy(asc(matchesTable.kickoffAt))
    .limit(1);

  res.json({
    totalUsers: users?.value ?? 0,
    totalChallenges: challenges?.value ?? 0,
    totalPredictions: predictions?.value ?? 0,
    activeChallenges: active?.value ?? 0,
    firstMatchKickoff: firstMatch?.kickoffAt
      ? firstMatch.kickoffAt.toISOString()
      : null,
  });
});

export default router;
