/**
 * Payments (Moyasar) checkout + callback activation regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for activated users, and stubs
 * the Moyasar REST API at the `fetch` layer (intercepting api.moyasar.com so the
 * REAL verifyPayment/createInvoice code paths run against canned responses; all
 * other URLs — Clerk, the in-process server — pass through untouched). This
 * exercises the money-handling journey with its real ownership + idempotency +
 * monotonic-upgrade guards:
 *
 *   1. Checkout validation: missing planCode / bad callbackUrl / unknown plan
 *      all 400 before any network call; a valid request returns a transactionUrl.
 *   2. Callback auth + input: unauthenticated -> 401, missing paymentId -> 400.
 *   3. Verification outcomes: a not-found or unpaid payment never activates.
 *   4. Happy path: a paid payment whose verified metadata.userId matches the
 *      caller activates the pass, writing exactly one active subscription.
 *   5. Idempotency: replaying the same payment reference does NOT create a second
 *      subscription.
 *   6. Ownership: a paid payment whose metadata.userId is a DIFFERENT user never
 *      activates for the caller (no replay of someone else's reference).
 *   7. Monotonic guard: a callback for a CHEAPER plan never downgrades an active
 *      higher pass; checkout for a cheaper/equal plan is rejected 409.
 *   8. History: `GET /me/subscription/history` lists the active pass.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `playerFlows.e2e.ts`).
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

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-payments-e2e/1.0";
// Canonical current pass edition. Checkout resolves this via
// resolveCurrentPassEdition(); we pin PASS_SEASON_KEY below for determinism.
const EDITION = "season_2026";

const SECRET = process.env.CLERK_SECRET_KEY;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!SECRET) throw new Error("CLERK_SECRET_KEY is required");

// Payments must look configured for the route to attempt verification. A dummy
// key is enough because every Moyasar HTTP call is intercepted below.
const priorSecret = process.env.MOYASAR_SECRET_KEY;
process.env.MOYASAR_SECRET_KEY = "test_sk_dummy";

// Pin the current pass season so resolveCurrentPassEdition() (used by checkout
// and the activation path) is deterministic regardless of wall clock.
const priorPassSeason = process.env.PASS_SEASON_KEY;
process.env.PASS_SEASON_KEY = "season_2026";

// ---- Moyasar fetch stub -----------------------------------------------------
// Canned payment records keyed by id. The route's real verifyPayment() fetches
// https://api.moyasar.com/v1/payments/:id; createInvoice() POSTs /v1/invoices.

interface StubPayment {
  status: string; // "paid" | "initiated" | ...
  metadata: Record<string, string>;
  amount: number;
}
const moyasarPayments = new Map<string, StubPayment>();

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
    // createInvoice
    if (/\/v1\/invoices$/.test(url) && method === "POST") {
      const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return new Response(
        JSON.stringify({
          id,
          status: "initiated",
          url: `https://moyasar.test/pay/${id}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // verifyPayment: GET /v1/payments/:id (and /v1/invoices/:id fallback)
    const m = url.match(/\/v1\/(payments|invoices)\/([^/?]+)/);
    if (m) {
      const id = decodeURIComponent(m[2]);
      const rec = moyasarPayments.get(id);
      if (!rec) return new Response("", { status: 404 });
      // Always answer on the payments resource; no invoice fallback needed.
      if (m[1] === "payments") {
        return new Response(
          JSON.stringify({
            id,
            status: rec.status,
            amount: rec.amount,
            metadata: rec.metadata,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  }
  return realFetch(input, init);
}) as typeof fetch;

// The app must be imported AFTER the env + fetch stub are installed.
const app = (await import("../src/app")).default;

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

// ---- Clerk admin REST helpers ----------------------------------------------

async function clerk<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await realFetch(CLERK_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = text as unknown as T;
  }
  return { status: res.status, data };
}

async function createClerkUser(email: string): Promise<string> {
  const { status, data } = await clerk<{ id: string }>("POST", "/users", {
    email_address: [email],
    password: `Aa1!${email}${Date.now()}`,
    skip_password_checks: true,
    skip_legal_checks: true,
  });
  if (status >= 400) {
    throw new Error(`Clerk create user failed (${status}): ${JSON.stringify(data)}`);
  }
  return data.id;
}

async function mintSessionToken(clerkUserId: string): Promise<string> {
  const sess = await clerk<{ id: string }>("POST", "/sessions", {
    user_id: clerkUserId,
  });
  if (sess.status >= 400) {
    throw new Error(`Clerk create session failed (${sess.status}): ${JSON.stringify(sess.data)}`);
  }
  const tok = await clerk<{ jwt: string }>(
    "POST",
    `/sessions/${sess.data.id}/tokens`,
    {},
  );
  if (tok.status >= 400 || !tok.data.jwt) {
    throw new Error(`Clerk mint token failed (${tok.status}): ${JSON.stringify(tok.data)}`);
  }
  return tok.data.jwt;
}

async function deleteClerkUser(clerkUserId: string): Promise<void> {
  try {
    await clerk("DELETE", `/users/${clerkUserId}`);
  } catch (err) {
    console.warn(`Failed to delete Clerk user ${clerkUserId}:`, err);
  }
}

// ---- API request helper -----------------------------------------------------

let baseUrl = "";

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
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

// Seed a fully-activated local user (email + mobile verified + complete profile
// + favourite team) so requireActivatedUser passes for checkout/callback.
async function seedActivatedUser(
  label: string,
  stamp: number,
  favoriteTeamId: string | null,
): Promise<{ clerkId: string; userId: string; token: string }> {
  const email = `thaddi-payments-e2e-${label}-${stamp}@example.com`;
  const clerkId = await createClerkUser(email);
  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: clerkId,
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
    username: `e2e_pay_${label}_${stamp}`,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, token };
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

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  const created: {
    clerkIds: string[];
    userIds: string[];
    planIds: string[];
    teamId?: string;
  } = { clerkIds: [], userIds: [], planIds: [] };

  try {
    // A team for activation (favourite team). Reuse an existing team if present
    // to mirror the real catalog; otherwise seed one.
    const existingTeam = await db.query.teamsTable.findFirst();
    let favoriteTeamId: string;
    if (existingTeam) {
      favoriteTeamId = existingTeam.id;
    } else {
      const [team] = await db
        .insert(teamsTable)
        .values({
          nameEn: "Payments E2E Team",
          nameAr: "فريق اختبار الدفع",
          externalId: `payments-e2e-team-${stamp}`,
        })
        .returning();
      favoriteTeamId = team.id;
      created.teamId = team.id;
    }

    // Two purchasable plans of distinct price (BASIC < PRO).
    const [basic] = await db
      .insert(plansTable)
      .values({
        code: `e2e_basic_${stamp}`,
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
        code: `e2e_pro_${stamp}`,
        nameEn: "E2E Pro",
        nameAr: "احترافي",
        priceSar: "30",
        participantLimit: 50,
        isActive: true,
        isComingSoon: false,
      })
      .returning();
    created.planIds.push(basic.id, pro.id);

    const buyer = await seedActivatedUser("buyer", stamp, favoriteTeamId);
    const other = await seedActivatedUser("other", stamp, favoriteTeamId);
    created.clerkIds.push(buyer.clerkId, other.clerkId);
    created.userIds.push(buyer.userId, other.userId);

    const callbackUrl = "https://thaddi.example.com/pay/return";

    // 1. Checkout validation.
    console.log("\n[1] Checkout validation");
    const noPlan = await api("POST", "/me/subscription/checkout", {
      token: buyer.token,
      body: { callbackUrl },
    });
    check("checkout missing planCode -> 400", noPlan.status === 400, `got ${noPlan.status}`);
    const badCb = await api("POST", "/me/subscription/checkout", {
      token: buyer.token,
      body: { planCode: pro.code, callbackUrl: "not-a-url" },
    });
    check("checkout bad callbackUrl -> 400", badCb.status === 400, `got ${badCb.status}`);
    const unknownPlan = await api("POST", "/me/subscription/checkout", {
      token: buyer.token,
      body: { planCode: `nope_${stamp}`, callbackUrl },
    });
    check("checkout unknown plan -> 400", unknownPlan.status === 400, `got ${unknownPlan.status}`);
    const checkout = await api("POST", "/me/subscription/checkout", {
      token: buyer.token,
      body: { planCode: pro.code, callbackUrl },
    });
    check("checkout valid -> 200", checkout.status === 200, `got ${checkout.status}`);
    check(
      "checkout returns a transactionUrl + paymentId",
      typeof checkout.data?.transactionUrl === "string" &&
        typeof checkout.data?.paymentId === "string",
      JSON.stringify(checkout.data),
    );
    const checkoutUnauth = await api("POST", "/me/subscription/checkout", {
      body: { planCode: pro.code, callbackUrl },
    });
    check("checkout unauth -> 401", checkoutUnauth.status === 401, `got ${checkoutUnauth.status}`);

    // 2. Callback auth + input.
    console.log("\n[2] Callback auth + input");
    const cbUnauth = await api("POST", "/payments/moyasar/callback", {
      body: { paymentId: "x" },
    });
    check("callback unauth -> 401", cbUnauth.status === 401, `got ${cbUnauth.status}`);
    const cbNoId = await api("POST", "/payments/moyasar/callback", {
      token: buyer.token,
      body: {},
    });
    check("callback missing paymentId -> 400", cbNoId.status === 400, `got ${cbNoId.status}`);

    // 3. Not-found + unpaid never activate.
    console.log("\n[3] Not-found + unpaid");
    const cbMissing = await api("POST", "/payments/moyasar/callback", {
      token: buyer.token,
      body: { paymentId: `missing_${stamp}` },
    });
    check(
      "unknown payment -> activated:false",
      cbMissing.status === 200 && cbMissing.data?.activated === false,
      JSON.stringify(cbMissing.data),
    );
    moyasarPayments.set(`unpaid_${stamp}`, {
      status: "initiated",
      amount: 3000,
      metadata: { userId: buyer.userId, planCode: pro.code, edition: EDITION },
    });
    const cbUnpaid = await api("POST", "/payments/moyasar/callback", {
      token: buyer.token,
      body: { paymentId: `unpaid_${stamp}` },
    });
    check(
      "unpaid payment -> activated:false",
      cbUnpaid.status === 200 && cbUnpaid.data?.activated === false,
      JSON.stringify(cbUnpaid.data),
    );
    check("no active sub yet", (await activeSubsFor(buyer.userId)).length === 0);

    // 4. Ownership: a paid payment for a DIFFERENT user never activates.
    console.log("\n[4] Ownership enforcement");
    moyasarPayments.set(`foreign_${stamp}`, {
      status: "paid",
      amount: 3000,
      metadata: { userId: other.userId, planCode: pro.code, edition: EDITION },
    });
    const cbForeign = await api("POST", "/payments/moyasar/callback", {
      token: buyer.token,
      body: { paymentId: `foreign_${stamp}` },
    });
    check(
      "paid payment owned by another user -> activated:false",
      cbForeign.status === 200 && cbForeign.data?.activated === false,
      JSON.stringify(cbForeign.data),
    );
    check("buyer still has no active sub", (await activeSubsFor(buyer.userId)).length === 0);

    // 5. Happy path: paid + matching user activates PRO.
    console.log("\n[5] Happy path activation");
    moyasarPayments.set(`pay_pro_${stamp}`, {
      status: "paid",
      amount: 3000,
      metadata: { userId: buyer.userId, planCode: pro.code, edition: EDITION },
    });
    const cbPro = await api("POST", "/payments/moyasar/callback", {
      token: buyer.token,
      body: { paymentId: `pay_pro_${stamp}` },
    });
    check(
      "paid + matching -> activated PRO",
      cbPro.status === 200 &&
        cbPro.data?.activated === true &&
        cbPro.data?.planCode === pro.code,
      JSON.stringify(cbPro.data),
    );
    const afterPro = await activeSubsFor(buyer.userId);
    check("exactly one active subscription", afterPro.length === 1, `got ${afterPro.length}`);
    check(
      "active sub is PRO with moyasar reference",
      afterPro[0]?.planId === pro.id &&
        afterPro[0]?.paymentProvider === "moyasar" &&
        afterPro[0]?.paymentReference === `pay_pro_${stamp}`,
      JSON.stringify(afterPro[0]),
    );

    // 6. Idempotent replay of the same reference.
    console.log("\n[6] Idempotent replay");
    const cbReplay = await api("POST", "/payments/moyasar/callback", {
      token: buyer.token,
      body: { paymentId: `pay_pro_${stamp}` },
    });
    check("replay -> 200 still PRO", cbReplay.status === 200 && cbReplay.data?.planCode === pro.code, JSON.stringify(cbReplay.data));
    const afterReplay = await activeSubsFor(buyer.userId);
    check("still exactly one active subscription", afterReplay.length === 1, `got ${afterReplay.length}`);

    // 7. Monotonic guard: a CHEAPER callback must not downgrade.
    console.log("\n[7] Monotonic downgrade guard");
    moyasarPayments.set(`pay_basic_${stamp}`, {
      status: "paid",
      amount: 1000,
      metadata: { userId: buyer.userId, planCode: basic.code, edition: EDITION },
    });
    const cbBasic = await api("POST", "/payments/moyasar/callback", {
      token: buyer.token,
      body: { paymentId: `pay_basic_${stamp}` },
    });
    check(
      "cheaper callback does NOT downgrade (still PRO)",
      cbBasic.status === 200 && cbBasic.data?.planCode === pro.code,
      JSON.stringify(cbBasic.data),
    );
    const afterBasic = await activeSubsFor(buyer.userId);
    check(
      "still exactly one active sub, still PRO",
      afterBasic.length === 1 && afterBasic[0]?.planId === pro.id,
      JSON.stringify(afterBasic.map((s) => s.planId)),
    );

    // Checkout for a cheaper/equal plan is rejected while PRO is active.
    const checkoutDown = await api("POST", "/me/subscription/checkout", {
      token: buyer.token,
      body: { planCode: basic.code, callbackUrl },
    });
    check("checkout cheaper plan while active -> 409", checkoutDown.status === 409, `got ${checkoutDown.status}`);

    // 8. Subscription history lists the active pass.
    console.log("\n[8] Subscription history");
    const history = await api("GET", "/me/subscription/history", { token: buyer.token });
    check("history -> 200 array", history.status === 200 && Array.isArray(history.data), JSON.stringify(history.data));
    const proRow = Array.isArray(history.data)
      ? history.data.find((r: any) => r.planCode === pro.code && r.status === "active")
      : null;
    check("history includes active PRO pass", Boolean(proRow), JSON.stringify(history.data));
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
    for (const id of created.clerkIds) await deleteClerkUser(id);

    globalThis.fetch = realFetch;
    if (priorSecret === undefined) delete process.env.MOYASAR_SECRET_KEY;
    else process.env.MOYASAR_SECRET_KEY = priorSecret;
    if (priorPassSeason === undefined) delete process.env.PASS_SEASON_KEY;
    else process.env.PASS_SEASON_KEY = priorPassSeason;

    await safe("server close", () => new Promise((r) => server.close(() => r(null))));
    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Payments callback regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Payments callback regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Payments callback regression crashed:", err);
    process.exit(1);
  });
