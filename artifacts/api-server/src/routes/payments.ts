import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  plansTable,
  subscriptionsTable,
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

const PAID_PLAN_CODES = new Set(["professional", "legend"]);

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
  if (!PAID_PLAN_CODES.has(planCode)) {
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

  if (await activeSubscriptionForEdition(record.user.id)) {
    res.status(409).json({ error: "You already have an active pass" });
    return;
  }

  const plan = await db.query.plansTable.findFirst({
    where: eq(plansTable.code, planCode as Plan["code"]),
  });
  if (!plan || !plan.isActive) {
    res.status(400).json({ error: "Plan unavailable" });
    return;
  }
  const amountHalalas = priceToHalalas(plan.priceSar);
  if (amountHalalas <= 0) {
    res.status(400).json({ error: "Plan is not purchasable" });
    return;
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

  // Idempotent: a repeated callback for the same payment must not create a
  // second subscription.
  const existing = await db
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
    const plan = await db.query.plansTable.findFirst({
      where: eq(plansTable.id, existing[0].planId),
    });
    res.json({
      paymentId: verified.reference,
      status: verified.status,
      activated: true,
      planCode: plan?.code ?? null,
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

  // Concurrency-safe idempotency. Two partial unique indexes back this:
  //  - (payment_provider, payment_reference): one subscription per payment, so
  //    a replayed/racing callback for the same payment is a no-op.
  //  - (user_id, edition) WHERE active: at most one active pass per edition, so
  //    a second completed payment for an already-active edition cannot grant a
  //    duplicate entitlement.
  // A bare onConflictDoNothing catches either index; inserted.length === 0 means
  // the caller already holds an active pass for this edition (still a success).
  const inserted = await db
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

  if (inserted.length > 0) {
    logger.info(
      { userId: record.user.id, planCode: plan.code, edition },
      "subscription activated",
    );
  }

  res.json({
    paymentId: verified.reference,
    status: verified.status,
    activated: true,
    planCode: plan.code,
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
