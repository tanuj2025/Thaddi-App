/**
 * Moyasar webhook + reconciler regression test.
 *
 * Covers the two backstops that recover a paid purchase when the buyer never
 * returns to the browser callback:
 *
 *   Webhook (POST /api/payments/moyasar/webhook, public):
 *     1. Missing MOYASAR_WEBHOOK_SECRET -> 503.
 *     2. Bad secret token -> 403 (no activation).
 *     3. Good secret but no resource id -> 200 {activated:false}.
 *     4. Good secret + unpaid payment -> 200 {activated:false}, no subscription.
 *     5. Good secret + paid payment owned (by verified metadata.userId) ->
 *        200 {activated:true}, exactly one active subscription.
 *     6. Replay of the same payment -> still exactly one subscription.
 *
 *   Reconciler (reconcilePendingPayments):
 *     7. A PAID invoice whose buyer never hit the callback is activated, keyed on
 *        the paid child payment id (so the reference matches the callback).
 *     8. A second pass is idempotent (no second subscription).
 *     9. A PAID invoice WITHOUT a child payment in the list payload is still
 *        activated via the invoice-id verify fallback.
 *
 * Like paymentsCallback.e2e.ts this boots the Express app in-process on an
 * ephemeral port and stubs the Moyasar REST API at the `fetch` layer so the REAL
 * verifyPayment / listRecentInvoices / activateVerifiedPayment code runs against
 * canned responses. Local users are seeded directly (no Clerk needed — the
 * webhook is public and activation resolves the buyer from Moyasar-verified
 * metadata.userId via a local DB lookup). Every fixture is reverted at the end.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  teamsTable,
  plansTable,
  subscriptionsTable,
} from "@workspace/db";

const USER_AGENT = "thaddi-webhook-e2e/1.0";
// Canonical current pass edition. The activation path canonicalizes the
// metadata edition to this; we also pin PASS_SEASON_KEY for determinism.
const EDITION = "season_2026";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// Payments must look configured for the routes to attempt verification. A dummy
// key is enough because every Moyasar HTTP call is intercepted below.
const priorSecret = process.env.MOYASAR_SECRET_KEY;
process.env.MOYASAR_SECRET_KEY = "test_sk_dummy";
// Start with the webhook secret UNSET so the 503-not-configured case is exercised
// before we install it.
const priorWebhookSecret = process.env.MOYASAR_WEBHOOK_SECRET;
delete process.env.MOYASAR_WEBHOOK_SECRET;
// Pin the current pass season so the activation path's edition resolution is
// deterministic regardless of wall clock.
const priorPassSeason = process.env.PASS_SEASON_KEY;
process.env.PASS_SEASON_KEY = "season_2026";

// ---- Moyasar fetch stub -----------------------------------------------------

interface StubPayment {
  status: string; // "paid" | "initiated" | ...
  metadata: Record<string, string>;
  amount: number;
}
interface StubInvoiceResource {
  status: string;
  metadata: Record<string, string>;
  amount: number;
}
interface StubListInvoice {
  id: string;
  status: string;
  created_at: string;
  payments?: { id: string; status: string }[];
}

const moyasarPayments = new Map<string, StubPayment>();
const moyasarInvoiceById = new Map<string, StubInvoiceResource>();
let moyasarListInvoices: StubListInvoice[] = [];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input?.url ?? String(input));
  if (url.startsWith("https://api.moyasar.com/v1/")) {
    const method = (init?.method ?? "GET").toUpperCase();
    // listRecentInvoices: GET /v1/invoices?page=N (must be checked before the
    // /invoices/:id resource match — this path has no id segment).
    if (/\/v1\/invoices(\?|$)/.test(url) && method === "GET") {
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return json({ invoices: page === 1 ? moyasarListInvoices : [] });
    }
    // verifyPayment: GET /v1/payments/:id with /v1/invoices/:id fallback.
    const m = url.match(/\/v1\/(payments|invoices)\/([^/?]+)/);
    if (m) {
      const id = decodeURIComponent(m[2]);
      if (m[1] === "payments") {
        const rec = moyasarPayments.get(id);
        if (!rec) return new Response("", { status: 404 });
        return json({
          id,
          status: rec.status,
          amount: rec.amount,
          metadata: rec.metadata,
        });
      }
      const inv = moyasarInvoiceById.get(id);
      if (!inv) return new Response("", { status: 404 });
      return json({
        id,
        status: inv.status,
        amount: inv.amount,
        metadata: inv.metadata,
      });
    }
    return new Response("", { status: 404 });
  }
  return realFetch(input, init);
}) as typeof fetch;

// The app + reconciler must be imported AFTER the env + fetch stub are installed.
const app = (await import("../src/app")).default;
const { reconcilePendingPayments } = await import(
  "../src/services/payments/reconcile"
);

// ---- Tiny assertion harness -------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } else {
    const msg = detail ? `${label} \u2014 ${detail}` : label;
    failures.push(msg);
    console.error(`  \u2717 ${msg}`);
  }
}

// ---- API request helper -----------------------------------------------------

let baseUrl = "";

async function api(
  method: string,
  path: string,
  opts: { body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await realFetch(baseUrl + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

let seq = 0;
async function seedUser(
  label: string,
  stamp: number,
  favoriteTeamId: string | null,
): Promise<string> {
  seq += 1;
  const email = `thaddi-webhook-e2e-${label}-${stamp}-${seq}@example.com`;
  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: `webhook_e2e_${label}_${stamp}_${seq}`,
      email,
      emailVerified: true,
      mobileVerified: true,
      favoriteTeamId,
      status: "active",
    })
    .returning();
  await db.insert(profilesTable).values({
    userId: row.id,
    displayName: `E2E ${label} ${stamp}`,
    username: `e2e_wh_${label}_${stamp}_${seq}`,
  });
  return row.id;
}

async function activeSubsFor(userId: string) {
  return db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        eq(subscriptionsTable.status, "active"),
        eq(subscriptionsTable.edition, EDITION),
      ),
    );
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();
  const WEBHOOK_SECRET = `whsec_test_${stamp}`;

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  const created: { userIds: string[]; planIds: string[]; teamId?: string } = {
    userIds: [],
    planIds: [],
  };

  try {
    const existingTeam = await db.query.teamsTable.findFirst();
    let favoriteTeamId: string;
    if (existingTeam) {
      favoriteTeamId = existingTeam.id;
    } else {
      const [team] = await db
        .insert(teamsTable)
        .values({
          nameEn: "Webhook E2E Team",
          nameAr: "فريق اختبار",
          externalId: `webhook-e2e-team-${stamp}`,
        })
        .returning();
      favoriteTeamId = team.id;
      created.teamId = team.id;
    }

    const [basic] = await db
      .insert(plansTable)
      .values({
        code: `e2e_wh_basic_${stamp}`,
        nameEn: "E2E Basic",
        nameAr: "أساسي",
        priceSar: "10",
        participantLimit: 20,
        isActive: true,
        isComingSoon: false,
      })
      .returning();
    const [pro] = await db
      .insert(plansTable)
      .values({
        code: `e2e_wh_pro_${stamp}`,
        nameEn: "E2E Pro",
        nameAr: "احترافي",
        priceSar: "30",
        participantLimit: 50,
        isActive: true,
        isComingSoon: false,
      })
      .returning();
    created.planIds.push(basic.id, pro.id);

    const buyerWebhook = await seedUser("webhook", stamp, favoriteTeamId);
    const buyerReconPay = await seedUser("reconpay", stamp, favoriteTeamId);
    const buyerReconInv = await seedUser("reconinv", stamp, favoriteTeamId);
    created.userIds.push(buyerWebhook, buyerReconPay, buyerReconInv);

    // 1. Secret gating.
    console.log("\n[1] Webhook secret gating");
    const noSecretCfg = await api("POST", "/payments/moyasar/webhook", {
      body: { secret_token: "anything", data: { id: "x" } },
    });
    check(
      "webhook with MOYASAR_WEBHOOK_SECRET unset -> 503",
      noSecretCfg.status === 503,
      `got ${noSecretCfg.status}`,
    );

    process.env.MOYASAR_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const badToken = await api("POST", "/payments/moyasar/webhook", {
      body: { secret_token: "wrong", data: { id: "x" } },
    });
    check(
      "webhook with bad token -> 403",
      badToken.status === 403,
      `got ${badToken.status}`,
    );

    const noId = await api("POST", "/payments/moyasar/webhook", {
      body: { secret_token: WEBHOOK_SECRET },
    });
    check(
      "webhook good token, no resource id -> 200 activated:false",
      noId.status === 200 && noId.data?.activated === false,
      JSON.stringify(noId.data),
    );

    // 2. Unpaid payment never activates.
    console.log("\n[2] Webhook unpaid");
    moyasarPayments.set(`wh_unpaid_${stamp}`, {
      status: "initiated",
      amount: 3000,
      metadata: { userId: buyerWebhook, planCode: pro.code, edition: EDITION },
    });
    const unpaid = await api("POST", "/payments/moyasar/webhook", {
      body: { secret_token: WEBHOOK_SECRET, data: { id: `wh_unpaid_${stamp}` } },
    });
    check(
      "unpaid webhook -> 200 activated:false",
      unpaid.status === 200 && unpaid.data?.activated === false,
      JSON.stringify(unpaid.data),
    );
    check(
      "no active sub from unpaid webhook",
      (await activeSubsFor(buyerWebhook)).length === 0,
    );

    // 3. Paid webhook activates, replay idempotent.
    console.log("\n[3] Webhook happy path + replay");
    moyasarPayments.set(`wh_paid_${stamp}`, {
      status: "paid",
      amount: 3000,
      metadata: { userId: buyerWebhook, planCode: pro.code, edition: EDITION },
    });
    const paid = await api("POST", "/payments/moyasar/webhook", {
      body: { secret_token: WEBHOOK_SECRET, data: { id: `wh_paid_${stamp}` } },
    });
    check(
      "paid webhook -> 200 activated:true",
      paid.status === 200 && paid.data?.activated === true,
      JSON.stringify(paid.data),
    );
    const afterPaid = await activeSubsFor(buyerWebhook);
    check(
      "exactly one active PRO sub from webhook with payment reference",
      afterPaid.length === 1 &&
        afterPaid[0]?.planId === pro.id &&
        afterPaid[0]?.paymentProvider === "moyasar" &&
        afterPaid[0]?.paymentReference === `wh_paid_${stamp}`,
      JSON.stringify(afterPaid[0]),
    );

    const replay = await api("POST", "/payments/moyasar/webhook", {
      body: { secret_token: WEBHOOK_SECRET, data: { id: `wh_paid_${stamp}` } },
    });
    check(
      "webhook replay -> 200 activated:true",
      replay.status === 200 && replay.data?.activated === true,
      JSON.stringify(replay.data),
    );
    check(
      "still exactly one active sub after replay",
      (await activeSubsFor(buyerWebhook)).length === 1,
    );

    // 4. Reconciler: paid invoice keyed on paid child payment id.
    console.log("\n[4] Reconciler — paid payment id path");
    moyasarPayments.set(`rp_pay_${stamp}`, {
      status: "paid",
      amount: 3000,
      metadata: { userId: buyerReconPay, planCode: pro.code, edition: EDITION },
    });
    moyasarListInvoices = [
      {
        id: `rp_inv_${stamp}`,
        status: "paid",
        created_at: new Date().toISOString(),
        payments: [{ id: `rp_pay_${stamp}`, status: "paid" }],
      },
    ];
    check(
      "buyer has no sub before reconcile",
      (await activeSubsFor(buyerReconPay)).length === 0,
    );
    const pass1 = await reconcilePendingPayments();
    check(
      "reconcile activated at least one purchase",
      pass1.activated >= 1,
      JSON.stringify(pass1),
    );
    const reconPaySubs = await activeSubsFor(buyerReconPay);
    check(
      "reconciled sub is PRO, keyed on the paid PAYMENT id",
      reconPaySubs.length === 1 &&
        reconPaySubs[0]?.planId === pro.id &&
        reconPaySubs[0]?.paymentReference === `rp_pay_${stamp}`,
      JSON.stringify(reconPaySubs[0]),
    );

    // 5. Reconciler idempotency.
    console.log("\n[5] Reconciler idempotency");
    const pass2 = await reconcilePendingPayments();
    check(
      "second pass activates nothing new",
      pass2.activated === 0,
      JSON.stringify(pass2),
    );
    check(
      "still exactly one sub after second pass",
      (await activeSubsFor(buyerReconPay)).length === 1,
    );

    // 6. Reconciler: invoice WITHOUT a child payment -> invoice-id fallback.
    console.log("\n[6] Reconciler — invoice id fallback path");
    moyasarInvoiceById.set(`ri_inv_${stamp}`, {
      status: "paid",
      amount: 1000,
      metadata: { userId: buyerReconInv, planCode: basic.code, edition: EDITION },
    });
    moyasarListInvoices.push({
      id: `ri_inv_${stamp}`,
      status: "paid",
      created_at: new Date().toISOString(),
      // no `payments` -> paidPaymentId null -> reference falls back to invoice id
    });
    const pass3 = await reconcilePendingPayments();
    check(
      "reconcile activated the invoice-id-only purchase",
      pass3.activated >= 1,
      JSON.stringify(pass3),
    );
    const reconInvSubs = await activeSubsFor(buyerReconInv);
    check(
      "reconciled sub is BASIC, keyed on the INVOICE id",
      reconInvSubs.length === 1 &&
        reconInvSubs[0]?.planId === basic.id &&
        reconInvSubs[0]?.paymentReference === `ri_inv_${stamp}`,
      JSON.stringify(reconInvSubs[0]),
    );
  } finally {
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`cleanup ${label} failed:`, err);
      }
    };

    if (created.userIds.length) {
      await safe("subscriptions", () =>
        db
          .delete(subscriptionsTable)
          .where(inArray(subscriptionsTable.userId, created.userIds)),
      );
    }
    if (created.planIds.length) {
      await safe("plans", () =>
        db.delete(plansTable).where(inArray(plansTable.id, created.planIds)),
      );
    }
    if (created.userIds.length) {
      await safe("profiles", () =>
        db
          .delete(profilesTable)
          .where(inArray(profilesTable.userId, created.userIds)),
      );
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, created.userIds)),
      );
    }
    if (created.teamId) {
      await safe("team", () =>
        db.delete(teamsTable).where(eq(teamsTable.id, created.teamId!)),
      );
    }

    globalThis.fetch = realFetch;
    if (priorSecret === undefined) delete process.env.MOYASAR_SECRET_KEY;
    else process.env.MOYASAR_SECRET_KEY = priorSecret;
    if (priorWebhookSecret === undefined)
      delete process.env.MOYASAR_WEBHOOK_SECRET;
    else process.env.MOYASAR_WEBHOOK_SECRET = priorWebhookSecret;
    if (priorPassSeason === undefined) delete process.env.PASS_SEASON_KEY;
    else process.env.PASS_SEASON_KEY = priorPassSeason;

    await safe("server close", () => new Promise((r) => server.close(() => r(null))));
    await safe("pool end", () => pool.end());
  }

  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Webhook + reconciler regression: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Webhook + reconciler regression: ${failures.length} FAILED, ${passed} passed.`,
    );
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Webhook + reconciler regression crashed:", err);
    process.exit(1);
  });
