import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import {
  db,
  featureFlagsTable,
  usersTable,
  challengesTable,
  predictionsTable,
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

  res.json({
    totalUsers: users?.value ?? 0,
    totalChallenges: challenges?.value ?? 0,
    totalPredictions: predictions?.value ?? 0,
    activeChallenges: active?.value ?? 0,
  });
});

export default router;
