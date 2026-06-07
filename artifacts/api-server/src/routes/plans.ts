import { Router, type IRouter } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  plansTable,
  planEntitlementsTable,
  challengeTemplatesTable,
} from "@workspace/db";
import { requireCurrentUser } from "../lib/currentUser";
import { getUserPlan } from "../lib/entitlements";

const router: IRouter = Router();

router.get("/plans", async (_req, res) => {
  const plans = await db
    .select()
    .from(plansTable)
    .orderBy(asc(plansTable.orderIndex));

  const entitlements = plans.length
    ? await db
        .select()
        .from(planEntitlementsTable)
        .where(
          inArray(
            planEntitlementsTable.planId,
            plans.map((p) => p.id),
          ),
        )
    : [];

  const byPlan = new Map<string, { key: string; value: string }[]>();
  for (const e of entitlements) {
    const list = byPlan.get(e.planId) ?? [];
    list.push({ key: e.key, value: e.value });
    byPlan.set(e.planId, list);
  }

  res.json(
    plans.map((p) => ({
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      priceSar: p.priceSar,
      participantLimit: p.participantLimit ?? null,
      isActive: p.isActive,
      isComingSoon: p.isComingSoon,
      orderIndex: p.orderIndex,
      entitlements: byPlan.get(p.id) ?? [],
      displayFeatures: p.displayFeatures ?? [],
    })),
  );
});

router.get("/me/subscription", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const plan = await getUserPlan(record.user.id);
  res.json(plan);
});

router.get("/challenge-templates", async (_req, res) => {
  const templates = await db
    .select()
    .from(challengeTemplatesTable)
    .where(eq(challengeTemplatesTable.isActive, true))
    .orderBy(asc(challengeTemplatesTable.orderIndex));

  res.json(
    templates.map((t) => ({
      id: t.id,
      slug: t.slug,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      descriptionEn: t.descriptionEn ?? null,
      descriptionAr: t.descriptionAr ?? null,
      scope: t.scope,
      orderIndex: t.orderIndex,
    })),
  );
});

export default router;
