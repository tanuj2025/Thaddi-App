// Backstop reconciler for Moyasar purchases.
//
// The browser callback (/payments/moyasar/callback) and the server-to-server
// webhook (/payments/moyasar/webhook) both activate a paid purchase. If BOTH
// are missed — the buyer never returns AND the webhook never lands (endpoint
// down, secret rotated, delivery failure) — the buyer is charged with nothing
// granted. This periodic job closes that gap: it lists recent paid invoices
// from Moyasar and activates any that have no local record yet, reusing the
// exact same idempotent/monotonic activation path as the callback. Best-effort:
// it never throws and never blocks boot.

import { and, eq } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  challengePurchasedBadgesTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import {
  isPaymentsConfigured,
  listRecentInvoices,
  verifyPayment,
} from "./moyasar";
import { activateVerifiedPayment } from "./activate";

function intervalFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

// Tunable for ops/testing. Defaults suit a single-tournament app: poll every
// 15 minutes and only consider invoices created in the last 72 hours, reading a
// single (newest) page of invoices per pass.
const RECONCILE_INTERVAL_MS = intervalFromEnv(
  "MOYASAR_RECONCILE_INTERVAL_MS",
  15 * 60 * 1000,
);
const RECONCILE_LOOKBACK_MS = intervalFromEnv(
  "MOYASAR_RECONCILE_LOOKBACK_MS",
  72 * 60 * 60 * 1000,
);
const RECONCILE_PAGES = Math.max(
  1,
  Math.min(Number(process.env.MOYASAR_RECONCILE_PAGES) || 1, 20),
);

// Whether a Moyasar payment reference is already recorded locally (as a
// subscription or a challenge badge), so the pass can skip re-verifying it.
async function referenceAlreadyRecorded(reference: string): Promise<boolean> {
  const sub = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.paymentProvider, "moyasar"),
        eq(subscriptionsTable.paymentReference, reference),
      ),
    )
    .limit(1);
  if (sub[0]) return true;
  const badge = await db
    .select({ id: challengePurchasedBadgesTable.id })
    .from(challengePurchasedBadgesTable)
    .where(
      and(
        eq(challengePurchasedBadgesTable.paymentProvider, "moyasar"),
        eq(challengePurchasedBadgesTable.paymentReference, reference),
      ),
    )
    .limit(1);
  return Boolean(badge[0]);
}

// One reconciliation pass. Returns a small summary for logging/tests.
export async function reconcilePendingPayments(): Promise<{
  scanned: number;
  activated: number;
  skipped: number;
}> {
  let scanned = 0;
  let activated = 0;
  let skipped = 0;

  const invoices = await listRecentInvoices({ pages: RECONCILE_PAGES });
  const cutoff = Date.now() - RECONCILE_LOOKBACK_MS;

  for (const inv of invoices) {
    if (inv.status !== "paid") continue;
    if (inv.createdAt) {
      const created = Date.parse(inv.createdAt);
      if (Number.isFinite(created) && created < cutoff) continue;
    }
    scanned += 1;

    // Prefer the paid payment id so the recorded reference matches the browser
    // callback's; fall back to the invoice id (still safe: the activator's
    // user+edition lock + monotonic guard + unique indexes prevent any double
    // grant even when the references differ).
    const reference = inv.paidPaymentId ?? inv.invoiceId;
    if (await referenceAlreadyRecorded(reference)) {
      skipped += 1;
      continue;
    }

    try {
      const verified = await verifyPayment(reference);
      if (!verified.found || !verified.paid) {
        skipped += 1;
        continue;
      }
      const result = await activateVerifiedPayment(verified);
      if (result.activated) activated += 1;
      else skipped += 1;
    } catch (err) {
      logger.error(
        { err, invoiceId: inv.invoiceId },
        "reconcile: failed to activate invoice",
      );
      skipped += 1;
    }
  }

  if (scanned > 0) {
    logger.info(
      { scanned, activated, skipped },
      "Moyasar reconcile pass complete",
    );
  }
  return { scanned, activated, skipped };
}

// Starts the recurring reconciler. No-op (with a log) when payments aren't
// configured. Self-scheduling timer so passes never overlap; best-effort so a
// transient failure never kills the loop. Returns a stop function.
export function startMoyasarReconciler(): () => void {
  if (!isPaymentsConfigured()) {
    logger.info("Moyasar reconciler not started (payments not configured)");
    return () => {};
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(tick, RECONCILE_INTERVAL_MS);
  };

  const tick = async () => {
    try {
      await reconcilePendingPayments();
    } catch (err) {
      logger.error({ err }, "Moyasar reconcile tick failed");
    }
    scheduleNext();
  };

  logger.info(
    {
      intervalMs: RECONCILE_INTERVAL_MS,
      lookbackMs: RECONCILE_LOOKBACK_MS,
      pages: RECONCILE_PAGES,
    },
    "Moyasar reconciler started",
  );
  // First pass after one interval (startup already does its own work; no need to
  // hammer Moyasar immediately on boot).
  scheduleNext();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    logger.info("Moyasar reconciler stopped");
  };
}
