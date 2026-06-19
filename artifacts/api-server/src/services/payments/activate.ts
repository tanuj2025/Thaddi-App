// Shared activation for a SERVER-VERIFIED Moyasar purchase.
//
// The buyer is taken solely from `verified.metadata.userId` (set by us at
// checkout, read back from Moyasar's verified record — never from a browser
// session or a client/webhook body). That makes this safe to call from three
// places that all converge here:
//   1. the browser callback  (/payments/moyasar/callback),
//   2. the server-to-server webhook (/payments/moyasar/webhook),
//   3. the periodic reconciler (services/payments/reconcile.ts).
//
// It reproduces the callback's original guarantees exactly: idempotent by
// (provider, reference); upgrade-aware with a monotonic "never downgrade an
// active pass" guard; and race-safe under concurrency.

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  plansTable,
  subscriptionsTable,
  challengePurchasedBadgesTable,
  usersTable,
  type Plan,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import type { VerifiedPayment } from "./moyasar";
import {
  canonicalizePassEdition,
  editionAliases,
  LEGACY_WORLD_CUP_EDITION,
} from "./passSeason";

export type ActivationKind = "subscription" | "challenge_badge" | "none";

export interface ActivationResult {
  activated: boolean;
  planCode: string | null;
  kind: ActivationKind;
}

// Activates a verified, paid Moyasar purchase. Returns {activated:false} for
// anything that isn't a paid purchase owned by a known local user.
export async function activateVerifiedPayment(
  verified: VerifiedPayment,
): Promise<ActivationResult> {
  const none: ActivationResult = {
    activated: false,
    planCode: null,
    kind: "none",
  };

  if (!verified.found || !verified.paid) return none;

  // Ownership comes from Moyasar-verified metadata, not any session.
  const userId = verified.metadata.userId;
  if (!userId) {
    logger.warn(
      { paymentRef: verified.reference },
      "activation skipped: verified payment has no userId in metadata",
    );
    return none;
  }

  // The buyer must still exist locally (JIT-provisioned at checkout time).
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });
  if (!user) {
    logger.warn(
      { paymentRef: verified.reference, userId },
      "activation skipped: verified payment userId has no local user",
    );
    return none;
  }

  // --- Decorative challenge badge ---
  if (verified.metadata.kind === "challenge_badge") {
    const challengeId = verified.metadata.challengeId;
    const badgeId = verified.metadata.badgeId;
    if (!challengeId || !badgeId) return none;

    // Idempotent attach in one transaction. A transaction-scoped advisory lock
    // keyed on the reference serializes concurrent activations for the SAME
    // payment, so a replay is a clean no-op. Uniqueness on (challengeId,badgeId)
    // and on (provider,reference) makes the insert safe under any race.
    const attached = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`moyasar:${verified.reference}`}))`,
      );

      const existing = await tx
        .select({ id: challengePurchasedBadgesTable.id })
        .from(challengePurchasedBadgesTable)
        .where(
          and(
            eq(challengePurchasedBadgesTable.paymentProvider, "moyasar"),
            eq(
              challengePurchasedBadgesTable.paymentReference,
              verified.reference,
            ),
          ),
        )
        .limit(1);
      if (existing[0]) return true;

      // Insert may no-op if the badge is already attached to the challenge
      // (shared per-challenge set) — that still counts as success for the buyer.
      await tx
        .insert(challengePurchasedBadgesTable)
        .values({
          challengeId,
          badgeId,
          purchasedByUserId: userId,
          paymentProvider: "moyasar",
          paymentReference: verified.reference,
        })
        .onConflictDoNothing();
      return true;
    });

    if (attached) {
      logger.info(
        { userId, challengeId, badgeId },
        "challenge badge attached",
      );
    }
    return { activated: attached, planCode: null, kind: "challenge_badge" };
  }

  // --- Subscription pass ---
  // Canonicalize the edition so a delayed LEGACY callback (metadata.edition =
  // "world_cup_2026", or none at all) lands on the same canonical season_2026 as
  // new purchases — no double-grant, correct supersede via the edition aliases.
  const planCode = verified.metadata.planCode;
  const edition = canonicalizePassEdition(
    verified.metadata.edition ?? LEGACY_WORLD_CUP_EDITION,
  );
  const editionKeys = editionAliases(edition);
  if (!planCode) return none;

  const plan = await db.query.plansTable.findFirst({
    where: eq(plansTable.code, planCode as Plan["code"]),
  });
  if (!plan) return none;

  // Activation is idempotent AND supports upgrades, in one transaction:
  //  - Idempotency: one subscription per (payment_provider, payment_reference).
  //    A transaction-scoped advisory lock keyed on the reference serializes
  //    concurrent activations for the SAME payment, so a replay is a clean
  //    no-op.
  //  - Cross-reference serialization: the browser callback records the PAYMENT
  //    id while the reconciler may record the INVOICE id, so two FIRST-TIME
  //    activations of the same purchase can arrive under DIFFERENT references
  //    with no current active pass. A second advisory lock keyed on
  //    (user, edition) serializes those too, so the monotonic guard below
  //    reliably keeps the highest plan instead of the (user,edition) unique
  //    index picking an arbitrary winner.
  //  - Upgrade: the partial unique index (user_id, edition) WHERE active forbids
  //    two active passes, so we lock (FOR UPDATE) and cancel the current active
  //    pass before inserting the new one — but only when strictly upgrading.
  const activatedCode = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`moyasar:${verified.reference}`}))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`moyasar:user-edition:${userId}:${edition}`}))`,
    );

    const existing = await tx
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.paymentProvider, "moyasar"),
          eq(subscriptionsTable.paymentReference, verified.reference),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const existingPlan = await tx.query.plansTable.findFirst({
        where: eq(plansTable.id, existing[0].planId),
      });
      return existingPlan?.code ?? null;
    }

    // Supersede the current active pass for this edition (the upgrade path).
    // Monotonic guard: never downgrade. Compare against the *currently active*
    // plan's price, not just what checkout allowed when the invoice was created.
    const current = await tx
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.userId, userId),
          inArray(subscriptionsTable.edition, editionKeys),
          eq(subscriptionsTable.status, "active"),
        ),
      )
      .for("update");
    if (current[0]) {
      const currentPlan = await tx.query.plansTable.findFirst({
        where: eq(plansTable.id, current[0].planId),
      });
      const currentPrice = currentPlan ? Number(currentPlan.priceSar) : 0;
      if (Number(plan.priceSar) <= currentPrice) {
        logger.warn(
          {
            userId,
            paymentRef: verified.reference,
            attemptedPlan: plan.code,
            currentPlan: currentPlan?.code ?? null,
          },
          "skipping non-upgrade activation (would downgrade active pass)",
        );
        return currentPlan?.code ?? null;
      }
      await tx
        .update(subscriptionsTable)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(subscriptionsTable.userId, userId),
            eq(subscriptionsTable.edition, edition),
            eq(subscriptionsTable.status, "active"),
          ),
        );
    }

    const inserted = await tx
      .insert(subscriptionsTable)
      .values({
        userId,
        planId: plan.id,
        edition,
        status: "active",
        paymentProvider: "moyasar",
        paymentReference: verified.reference,
      })
      .onConflictDoNothing()
      .returning({ id: subscriptionsTable.id });
    if (inserted.length === 0) {
      // A concurrent activation won the race after our active-pass check; report
      // whatever is active now rather than claiming we activated this plan.
      const after = await tx
        .select()
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.userId, userId),
            eq(subscriptionsTable.edition, edition),
            eq(subscriptionsTable.status, "active"),
          ),
        )
        .limit(1);
      if (after[0]) {
        const afterPlan = await tx.query.plansTable.findFirst({
          where: eq(plansTable.id, after[0].planId),
        });
        return afterPlan?.code ?? null;
      }
      return null;
    }

    return plan.code;
  });

  if (activatedCode) {
    logger.info(
      { userId, planCode: activatedCode, edition },
      "subscription activated",
    );
  }

  return {
    activated: Boolean(activatedCode),
    planCode: activatedCode,
    kind: "subscription",
  };
}
