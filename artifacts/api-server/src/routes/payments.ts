import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  plansTable,
  subscriptionsTable,
  challengesTable,
  challengeBadgeCatalogTable,
  type Plan,
} from "@workspace/db";
import { requireActivatedUser } from "../lib/currentUser";
import { logger } from "../lib/logger";
import {
  createInvoice,
  verifyPayment,
  isPaymentsConfigured,
} from "../services/payments/moyasar";
import { activateVerifiedPayment } from "../services/payments/activate";
import {
  resolveActivePlanCodes,
  isRevenueCatConfigured,
} from "../services/payments/revenuecat";

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
      description: `thaddi App ${plan.nameEn} — World Cup Pass`,
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

  // Activate the verified, owned purchase. The shared activator reproduces the
  // full idempotency / upgrade / monotonic guards and is the SAME path the
  // webhook and reconciler use, so all three stay in lockstep.
  const result = await activateVerifiedPayment(verified);
  res.json({
    paymentId: verified.reference,
    status: verified.status,
    activated: result.activated,
    planCode: result.planCode,
  });
});

// Server-to-server payment confirmation from Moyasar. This is the safety net for
// buyers who pay but never return to the browser callback (closed tab, lost
// connection): Moyasar POSTs here when a payment is captured, so the pass is
// granted without any browser session. Public (no Clerk auth) — authenticity is
// proven by the shared secret token Moyasar echoes from the webhook config, and
// the money truth is ALWAYS re-verified server-side (never trusted from this
// body). The buyer is taken from the Moyasar-verified metadata.userId.
router.post("/payments/moyasar/webhook", async (req, res) => {
  const expectedSecret = process.env.MOYASAR_WEBHOOK_SECRET;
  if (!expectedSecret) {
    logger.error(
      "moyasar webhook received but MOYASAR_WEBHOOK_SECRET is not configured",
    );
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }
  if (!isPaymentsConfigured()) {
    res.status(503).json({ error: "Payments are not configured" });
    return;
  }

  // Constant-time comparison of the echoed token. Length-check first because
  // timingSafeEqual throws on unequal-length buffers. Never log the token.
  const presented = Buffer.from(String(req.body?.secret_token ?? ""));
  const expected = Buffer.from(expectedSecret);
  const authentic =
    presented.length === expected.length &&
    timingSafeEqual(presented, expected);
  if (!authentic) {
    logger.warn("moyasar webhook rejected: invalid secret token");
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Take ONLY the resource id from the (now-authenticated) body, then re-verify
  // it against Moyasar before activating. Non-payment events or a missing id are
  // acknowledged with 200 so Moyasar does not retry them forever.
  const data = (req.body?.data ?? {}) as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) {
    res.json({ received: true, activated: false });
    return;
  }

  try {
    const verified = await verifyPayment(id);
    if (!verified.found || !verified.paid) {
      res.json({ received: true, activated: false });
      return;
    }
    const result = await activateVerifiedPayment(verified);
    logger.info(
      {
        paymentRef: verified.reference,
        activated: result.activated,
        kind: result.kind,
      },
      "moyasar webhook processed",
    );
    res.json({ received: true, activated: result.activated });
  } catch (err) {
    // 200 so Moyasar's retry policy doesn't hammer us; the reconciler is the
    // backstop that will catch anything missed here.
    logger.error({ err }, "moyasar webhook activation failed");
    res.json({ received: true, activated: false });
  }
});

router.post("/payments/iap/sync", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;

  if (!isRevenueCatConfigured()) {
    res.status(503).json({ error: "In-app purchases are not configured" });
    return;
  }

  // The mobile app logs the buyer into RevenueCat with their Clerk user id, so
  // the RevenueCat customer id == clerkUserId. Entitlements are read from
  // RevenueCat server-side; the client is never trusted for what it purchased.
  const appUserId = record.user.clerkUserId;
  const edition = EDITION;

  let activeCodes: string[];
  try {
    activeCodes = await resolveActivePlanCodes(appUserId);
  } catch (err) {
    logger.error({ err }, "revenuecat sync: failed to resolve entitlements");
    res.status(502).json({ error: "Could not verify purchase" });
    return;
  }

  if (activeCodes.length === 0) {
    res.json({ activated: false, planCode: null });
    return;
  }

  // Map the entitled codes to local plans and keep only the purchasable ones: a
  // plan is purchasable when active, not "coming soon", not the reserved free
  // tier, and priced above zero (mirrors the Moyasar checkout rule). This works
  // for any admin-created tier whose code matches an entitlement lookup_key.
  const plans = await db
    .select()
    .from(plansTable)
    .where(inArray(plansTable.code, activeCodes as Plan["code"][]));
  const purchasable = plans.filter(
    (p) =>
      p.isActive &&
      !p.isComingSoon &&
      p.code !== "free" &&
      Number(p.priceSar) > 0,
  );
  if (purchasable.length === 0) {
    res.json({ activated: false, planCode: null });
    return;
  }

  // A buyer may hold several one-time passes (e.g. bought Professional, later
  // upgraded to Legend — both entitlements stay active forever). Grant the
  // highest-priced one; the supersede logic below cancels any lower active pass.
  const target = purchasable.reduce((best, p) =>
    Number(p.priceSar) > Number(best.priceSar) ? p : best,
  );

  // Each (user, plan, edition) pair maps to one stable reference, so re-syncing
  // the same active entitlement is idempotent, while an upgrade to a different
  // plan produces a new reference (and a new subscription row).
  const ref = `revenuecat:${appUserId}:${target.code}:${edition}`;

  // Activation mirrors the Moyasar callback exactly:
  //  - Idempotency: one subscription per (payment_provider, payment_reference);
  //    a transaction-scoped advisory lock keyed on the reference serializes
  //    concurrent syncs for the SAME entitlement so a replay is a clean no-op.
  //  - Upgrade/supersede: the partial unique index (user_id, edition) WHERE
  //    active forbids two active passes, so we lock (FOR UPDATE) and cancel the
  //    current active pass before inserting, but only when strictly upgrading.
  //  - Monotonic guard: never downgrade an active pass to a cheaper one.
  const activatedCode = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ref}))`);

    // Idempotent replay: only an ACTIVE row for this exact reference means the
    // entitlement is already mirrored, so re-syncing it is a clean no-op. A
    // cancelled row with this reference is a *superseded* pass (the buyer later
    // upgraded away from it); it must NOT be treated as a replay, or we would
    // report the old, lower plan as active when a higher pass is live. Falling
    // through hands off to the active-pass + monotonic guard below, which reports
    // the truly active plan (and never downgrades it).
    const existing = await tx
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.paymentProvider, "revenuecat"),
          eq(subscriptionsTable.paymentReference, ref),
          eq(subscriptionsTable.status, "active"),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const existingPlan = await tx.query.plansTable.findFirst({
        where: eq(plansTable.id, existing[0].planId),
      });
      return existingPlan?.code ?? null;
    }

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
      if (Number(target.priceSar) <= currentPrice) {
        logger.info(
          {
            userId: record.user.id,
            attemptedPlan: target.code,
            currentPlan: currentPlan?.code ?? null,
          },
          "revenuecat sync: active pass already equal or higher; no change",
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
        planId: target.id,
        edition,
        status: "active",
        paymentProvider: "revenuecat",
        paymentReference: ref,
      })
      .onConflictDoNothing()
      .returning({ id: subscriptionsTable.id });
    if (inserted.length === 0) {
      // A concurrent sync won the race after our active-pass check; report
      // whatever is active now rather than claiming we activated this plan.
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

    return target.code;
  });

  if (activatedCode) {
    logger.info(
      { userId: record.user.id, planCode: activatedCode, edition },
      "revenuecat subscription synced",
    );
  }

  // no-store: per-user entitlement state must never be cached by any
  // intermediary, mirroring GET /me/subscription.
  res.set("Cache-Control", "no-store");
  res.json({ activated: Boolean(activatedCode), planCode: activatedCode });
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
