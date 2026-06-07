import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  plansTable,
  subscriptionsTable,
  challengesTable,
  challengeBadgeCatalogTable,
  challengePurchasedBadgesTable,
  type Plan,
} from "@workspace/db";
import { requireActivatedUser } from "../lib/currentUser";
import { logger } from "../lib/logger";
import {
  createInvoice,
  verifyPayment,
  isPaymentsConfigured,
} from "../services/payments/moyasar";

const router: IRouter = Router();

// The World Cup Pass is sold per tournament edition. A single edition keeps the
// "already subscribed" check and entitlement resolution scoped to this event.
const EDITION = process.env.TOURNAMENT_EDITION ?? "world_cup_2026";

function priceToHalalas(priceSar: string): number {
  const sar = Number(priceSar);
  if (!Number.isFinite(sar) || sar <= 0) return 0;
  return Math.round(sar * 100);
}

async function activeSubscriptionForEdition(userId: string) {
  const rows = await db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.status, "active"),
        eq(subscriptionsTable.edition, EDITION),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

router.post("/me/subscription/checkout", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;

  const planCode = String(req.body?.planCode ?? "");
  const callbackUrl = String(req.body?.callbackUrl ?? "");
  if (!planCode) {
    res.status(400).json({ error: "Unsupported plan" });
    return;
  }
  if (!/^https?:\/\//.test(callbackUrl)) {
    res.status(400).json({ error: "A valid callbackUrl is required" });
    return;
  }

  if (!isPaymentsConfigured()) {
    res.status(503).json({ error: "Payments are not configured" });
    return;
  }

  const plan = await db.query.plansTable.findFirst({
    where: eq(plansTable.code, planCode as Plan["code"]),
  });
  // A plan is purchasable when it's active, not "coming soon", not the reserved
  // free tier, and has a positive price. This works for any admin-created tier.
  if (!plan || !plan.isActive || plan.isComingSoon || plan.code === "free") {
    res.status(400).json({ error: "Plan unavailable" });
    return;
  }
  const amountHalalas = priceToHalalas(plan.priceSar);
  if (amountHalalas <= 0) {
    res.status(400).json({ error: "Plan is not purchasable" });
    return;
  }

  // Upgrades are allowed: a buyer with an active pass may move to a strictly
  // higher-priced tier (the activation step supersedes the old pass). Buying the
  // same tier or a cheaper one (downgrade) is rejected — the current pass stays.
  const activeSub = await activeSubscriptionForEdition(record.user.id);
  if (activeSub) {
    const activePlan = await db.query.plansTable.findFirst({
      where: eq(plansTable.id, activeSub.planId),
    });
    const currentPrice = activePlan ? Number(activePlan.priceSar) : 0;
    if (Number(plan.priceSar) <= currentPrice) {
      res
        .status(409)
        .json({ error: "You already have this plan or a higher one" });
      return;
    }
  }

  try {
    const invoice = await createInvoice({
      amountHalalas,
      description: `THADDI ${plan.nameEn} — World Cup Pass`,
      callbackUrl,
      metadata: {
        userId: record.user.id,
        planCode,
        edition: EDITION,
      },
    });
    res.json({
      paymentId: invoice.id,
      status: invoice.status,
      transactionUrl: invoice.url,
      publishableKey: process.env.MOYASAR_PUBLISHABLE_KEY ?? null,
    });
  } catch (err) {
    logger.error({ err }, "checkout failed");
    res.status(502).json({ error: "Could not start payment" });
  }
});

router.post("/payments/moyasar/callback", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;

  const paymentId = String(req.body?.paymentId ?? "");
  if (!paymentId) {
    res.status(400).json({ error: "paymentId is required" });
    return;
  }
  if (!isPaymentsConfigured()) {
    res.status(503).json({ error: "Payments are not configured" });
    return;
  }

  const verified = await verifyPayment(paymentId);
  if (!verified.found) {
    res.json({
      paymentId,
      status: verified.status,
      activated: false,
      planCode: null,
    });
    return;
  }

  if (!verified.paid) {
    res.json({
      paymentId: verified.reference,
      status: verified.status,
      activated: false,
      planCode: null,
    });
    return;
  }

  // Only the buyer who started the checkout may activate it. Metadata is read
  // from Moyasar's verified record, never from the client. Ownership is strict:
  // a payment without a matching userId in its verified metadata is never
  // allowed to activate a pass, otherwise any paid reference could be replayed.
  if (
    !verified.metadata.userId ||
    verified.metadata.userId !== record.user.id
  ) {
    logger.warn(
      { paymentId: verified.reference },
      "payment metadata user missing or mismatched on callback",
    );
    res.json({
      paymentId: verified.reference,
      status: verified.status,
      activated: false,
      planCode: null,
    });
    return;
  }

  // Branch on the purchase kind recorded at checkout. Decorative challenge
  // badges are attached to a challenge rather than activating a subscription.
  if (verified.metadata.kind === "challenge_badge") {
    const challengeId = verified.metadata.challengeId;
    const badgeId = verified.metadata.badgeId;
    if (!challengeId || !badgeId) {
      res.json({
        paymentId: verified.reference,
        status: verified.status,
        activated: false,
        planCode: null,
      });
      return;
    }

    // Idempotent attach in one transaction. A transaction-scoped advisory lock
    // keyed on the reference serializes concurrent callbacks for the SAME
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
          purchasedByUserId: record.user.id,
          paymentProvider: "moyasar",
          paymentReference: verified.reference,
        })
        .onConflictDoNothing();
      return true;
    });

    if (attached) {
      logger.info(
        { userId: record.user.id, challengeId, badgeId },
        "challenge badge attached",
      );
    }
    res.json({
      paymentId: verified.reference,
      status: verified.status,
      activated: attached,
      planCode: null,
    });
    return;
  }

  const planCode = verified.metadata.planCode;
  const edition = verified.metadata.edition ?? EDITION;
  if (!planCode) {
    res.json({
      paymentId: verified.reference,
      status: verified.status,
      activated: false,
      planCode: null,
    });
    return;
  }

  const plan = await db.query.plansTable.findFirst({
    where: eq(plansTable.code, planCode as Plan["code"]),
  });
  if (!plan) {
    res.json({
      paymentId: verified.reference,
      status: verified.status,
      activated: false,
      planCode: null,
    });
    return;
  }

  // Activation is idempotent AND supports upgrades, in one transaction:
  //  - Idempotency: one subscription per (payment_provider, payment_reference).
  //    A transaction-scoped advisory lock keyed on the reference serializes
  //    concurrent callbacks for the SAME payment, so a replay is a clean no-op.
  //  - Upgrade: a buyer moving to a higher tier already holds an active pass for
  //    this edition. The partial unique index (user_id, edition) WHERE active
  //    forbids two active passes, so we lock (FOR UPDATE) and cancel the current
  //    active pass for the edition before inserting the new one. Checkout only
  //    allows a strictly higher-priced plan here, so this never downgrades.
  const activatedCode = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`moyasar:${verified.reference}`}))`,
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
    // Monotonic guard: never downgrade at activation. Out-of-order or stale
    // callbacks (e.g. two invoices both started from the free tier, the cheaper
    // one confirming last) must not replace a higher/equal active pass with a
    // cheaper one. We compare against the *currently active* plan's price here,
    // not just what checkout allowed when the invoice was created.
    const current = await tx
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.userId, record.user.id),
          eq(subscriptionsTable.edition, edition),
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
            userId: record.user.id,
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
            eq(subscriptionsTable.userId, record.user.id),
            eq(subscriptionsTable.edition, edition),
            eq(subscriptionsTable.status, "active"),
          ),
        );
    }

    const inserted = await tx
      .insert(subscriptionsTable)
      .values({
        userId: record.user.id,
        planId: plan.id,
        edition,
        status: "active",
        paymentProvider: "moyasar",
        paymentReference: verified.reference,
      })
      .onConflictDoNothing()
      .returning({ id: subscriptionsTable.id });
    if (inserted.length === 0) {
      // A concurrent activation (different payment, same user/edition) won the
      // race after our active-pass check; report whatever is active now rather
      // than claiming we activated this plan.
      const after = await tx
        .select()
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.userId, record.user.id),
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
      { userId: record.user.id, planCode: activatedCode, edition },
      "subscription activated",
    );
  }

  res.json({
    paymentId: verified.reference,
    status: verified.status,
    activated: Boolean(activatedCode),
    planCode: activatedCode,
  });
});

router.get("/me/subscription/history", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;

  const rows = await db
    .select({
      id: subscriptionsTable.id,
      status: subscriptionsTable.status,
      edition: subscriptionsTable.edition,
      startedAt: subscriptionsTable.startedAt,
      expiresAt: subscriptionsTable.expiresAt,
      planCode: plansTable.code,
      planNameEn: plansTable.nameEn,
      planNameAr: plansTable.nameAr,
      priceSar: plansTable.priceSar,
    })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.userId, record.user.id))
    .orderBy(desc(subscriptionsTable.startedAt));

  res.json(
    rows.map((r) => ({
      id: r.id,
      planCode: r.planCode,
      planNameEn: r.planNameEn,
      planNameAr: r.planNameAr,
      status: r.status,
      edition: r.edition ?? null,
      priceSar: r.priceSar ?? null,
      startedAt: r.startedAt.toISOString(),
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    })),
  );
});

export default router;
