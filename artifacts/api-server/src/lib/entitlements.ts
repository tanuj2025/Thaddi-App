import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  plansTable,
  planEntitlementsTable,
  subscriptionsTable,
  type Plan,
} from "@workspace/db";
import {
  editionAliases,
  resolveCurrentPassEdition,
} from "../services/payments/passSeason";

// Capability keys the app actually enforces. Admins toggle these per plan; the
// catalog itself stays code-defined because each key maps to enforcement logic.
// `max_participants` is intentionally excluded — the participant limit is stored
// on the plan's `participantLimit` column (and kept in sync as an entitlement).
export const ENFORCED_ENTITLEMENT_KEYS = [
  "advanced_stats",
  "custom_prizes",
  "premium_features",
  "priority_support",
] as const;

export type EnforcedEntitlementKey = (typeof ENFORCED_ENTITLEMENT_KEYS)[number];

export interface UserPlan {
  planCode: Plan["code"];
  planNameEn: string;
  planNameAr: string;
  participantLimit: number | null;
  status: string;
  edition: string | null;
  entitlements: { key: string; value: string }[];
  displayFeatures: { en: string; ar: string }[];
}

async function loadEntitlements(planId: string) {
  const rows = await db
    .select({
      key: planEntitlementsTable.key,
      value: planEntitlementsTable.value,
    })
    .from(planEntitlementsTable)
    .where(eq(planEntitlementsTable.planId, planId));
  return rows;
}

// Resolves the user's effective plan. Falls back to the seeded Free plan when
// the user has no active subscription. Limits/capabilities are always read from
// the plans + plan_entitlements tables so payment wiring (Phase 5) needs no
// changes to feature code.
export async function getUserPlan(userId: string): Promise<UserPlan> {
  // A pass grants premium only for the CURRENT season. Scope active
  // subscriptions to the current edition's aliases (legacy world_cup_2026 ==
  // season_2026) so an ended season's pass no longer grants premium. Editionless
  // rows (manual/legacy grants) are season-agnostic and always honored.
  const currentEdition = await resolveCurrentPassEdition();
  const aliases = editionAliases(currentEdition);
  const sub = await db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.status, "active"),
        or(
          inArray(subscriptionsTable.edition, aliases),
          isNull(subscriptionsTable.edition),
        ),
      ),
    )
    .orderBy(desc(subscriptionsTable.startedAt))
    .limit(1);

  let plan: Plan | undefined;
  let status = "active";
  let edition: string | null = null;

  if (sub[0]) {
    plan = await db.query.plansTable.findFirst({
      where: eq(plansTable.id, sub[0].planId),
    });
    status = sub[0].status;
    edition = sub[0].edition ?? null;
  }

  if (!plan) {
    plan = await db.query.plansTable.findFirst({
      where: eq(plansTable.code, "free"),
    });
  }

  if (!plan) {
    // The Free plan must always be seeded; this is a hard misconfiguration.
    throw new Error("No plan available (seed the Free plan).");
  }

  const entitlements = await loadEntitlements(plan.id);

  return {
    planCode: plan.code,
    planNameEn: plan.nameEn,
    planNameAr: plan.nameAr,
    participantLimit: plan.participantLimit ?? null,
    status,
    edition,
    entitlements,
    displayFeatures: plan.displayFeatures ?? [],
  };
}

export function hasEntitlement(
  plan: UserPlan,
  key: string,
  truthy = "true",
): boolean {
  const e = plan.entitlements.find((x) => x.key === key);
  return e?.value === truthy;
}
