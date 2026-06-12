/**
 * RevenueCat in-app-purchase sync activation regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync), mints
 * real Clerk session tokens for activated users, and stubs the RevenueCat REST
 * API at the `fetch` layer. RevenueCat is reached through the Replit connectors
 * proxy (createProxyFetch), which rewrites every SDK call from
 * https://api.revenuecat.com/v2/... to ${connectorsHost}/api/v2/proxy/v2/...
 * before it hits fetch — so the stub intercepts the two proxied entitlement
 * endpoints (catalog `/entitlements` and per-customer `/active_entitlements`)
 * and lets all other URLs (Clerk, the in-process server) pass through. The
 * connectors proxy resolves its identity token via `replit identity create`
 * (a child process, not fetch), so that is untouched.
 *
 * The REAL resolveActivePlanCodes() + activation transaction run against canned
 * entitlement responses, exercising the IAP money-handling journey and its
 * server-side guards (the client is never trusted for what it purchased):
 *
 *   1. Auth: an unauthenticated sync -> 401.
 *   2. No entitlements (RevenueCat 404 for an unknown customer) -> activated:false.
 *   3. Non-purchasable filter: a customer entitled only to a "coming soon" plan
 *      never activates.
 *   4. Happy path: a customer entitled to PRO activates PRO, writing exactly one
 *      active subscription with a stable revenuecat:<user>:<code>:<edition> ref.
 *   5. Idempotency: re-syncing the same active entitlement is a clean no-op.
 *   6. Upgrade/supersede: a customer who later also holds LEGEND is upgraded to
 *      LEGEND in one tx (the PRO pass is cancelled; still exactly one active).
 *   7. Monotonic guard: a customer whose first pass was LEGEND and who now only
 *      reports a cheaper PRO entitlement is NOT downgraded (stays LEGEND).
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `paymentsCallback.e2e.ts`).
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
const USER_AGENT = "thaddi-iap-e2e/1.0";
const EDITION = "world_cup_2026";

const SECRET = process.env.CLERK_SECRET_KEY;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!SECRET) throw new Error("CLERK_SECRET_KEY is required");

// RevenueCat must look configured for the route to attempt verification. A dummy
// project id is enough because every RevenueCat HTTP call is intercepted below.
const priorProjectId = process.env.REVENUECAT_PROJECT_ID;
process.env.REVENUECAT_PROJECT_ID = "test_proj_dummy";

// ---- RevenueCat connectors-proxy fetch stub --------------------------------
// The catalog maps each plan code to a synthetic entitlement id (id == ent_<code>,
// lookup_key == <code>, mirroring our seed convention). `customerHoldings` maps a
// RevenueCat customer id (== Clerk user id) to the plan codes it currently holds.
// The SDK's listEntitlements hits /projects/:id/entitlements; the per-customer
// listCustomerActiveEntitlements hits /projects/:id/customers/:cid/active_entitlements.

const catalogCodes = new Set<string>();
const customerHoldings = new Map<string, string[]>();

function entitlementId(code: string): string {
  return `ent_${code}`;
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input?.url ?? String(input));

  // Only intercept RevenueCat traffic flowing through the connectors proxy.
  if (url.includes("/api/v2/proxy/")) {
    // Per-customer active entitlements: /customers/:customerId/active_entitlements
    const customerMatch = url.match(/\/customers\/([^/?]+)\/active_entitlements/);
    if (customerMatch) {
      const customerId = decodeURIComponent(customerMatch[1]);
      const codes = customerHoldings.get(customerId);
      // Unknown customer (never purchased) -> 404, exactly like RevenueCat.
      if (!codes || codes.length === 0) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          items: codes.map((code) => ({
            object: "customer.active_entitlement",
            entitlement_id: entitlementId(code),
            expires_at: null,
          })),
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Project entitlement catalog: /projects/:id/entitlements
    if (/\/entitlements(\?|$)/.test(url)) {
      return new Response(
        JSON.stringify({
          items: [...catalogCodes].map((code) => ({
            object: "entitlement",
            id: entitlementId(code),
            lookup_key: code,
            display_name: code,
          })),
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Any other proxied RevenueCat call is unexpected in this test.
    return new Response(JSON.stringify({ items: [], next_page: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
// + favourite team) so requireActivatedUser passes for the sync route.
async function seedActivatedUser(
  label: string,
  stamp: number,
  favoriteTeamId: string | null,
): Promise<{ clerkId: string; userId: string; token: string }> {
  const email = `thaddi-iap-e2e-${label}-${stamp}@example.com`;
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
    displayName: `IAP ${label} ${stamp}`,
    username: `e2e_iap_${label}_${stamp}`,
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
    // A team for activation (favourite team). Reuse an existing team if present.
    const existingTeam = await db.query.teamsTable.findFirst();
    let favoriteTeamId: string;
    if (existingTeam) {
      favoriteTeamId = existingTeam.id;
    } else {
      const [team] = await db
        .insert(teamsTable)
        .values({
          nameEn: "IAP E2E Team",
          nameAr: "فريق اختبار الشراء",
          externalId: `iap-e2e-team-${stamp}`,
        })
        .returning();
      favoriteTeamId = team.id;
      created.teamId = team.id;
    }

    // Three purchasable tiers (PRO < LEGEND, plus a cheap BASIC) and one
    // "coming soon" tier that must never activate even when entitled.
    const proCode = `e2e_iap_pro_${stamp}`;
    const legendCode = `e2e_iap_legend_${stamp}`;
    const soonCode = `e2e_iap_soon_${stamp}`;
    const [pro] = await db
      .insert(plansTable)
      .values({
        code: proCode,
        nameEn: "IAP Pro",
        nameAr: "احترافي",
        priceSar: "200",
        participantLimit: 50,
        isActive: true,
        isComingSoon: false,
      })
      .returning();
    const [legend] = await db
      .insert(plansTable)
      .values({
        code: legendCode,
        nameEn: "IAP Legend",
        nameAr: "أسطوري",
        priceSar: "1000",
        participantLimit: 200,
        isActive: true,
        isComingSoon: false,
      })
      .returning();
    const [soon] = await db
      .insert(plansTable)
      .values({
        code: soonCode,
        nameEn: "IAP Soon",
        nameAr: "قريباً",
        priceSar: "500",
        participantLimit: 100,
        isActive: true,
        isComingSoon: true,
      })
      .returning();
    created.planIds.push(pro.id, legend.id, soon.id);

    // Register the catalog the stub reports from listEntitlements().
    catalogCodes.add(proCode);
    catalogCodes.add(legendCode);
    catalogCodes.add(soonCode);

    const buyer = await seedActivatedUser("buyer", stamp, favoriteTeamId);
    const mono = await seedActivatedUser("mono", stamp, favoriteTeamId);
    created.clerkIds.push(buyer.clerkId, mono.clerkId);
    created.userIds.push(buyer.userId, mono.userId);

    const proRef = `revenuecat:${buyer.clerkId}:${proCode}:${EDITION}`;
    const legendRef = `revenuecat:${buyer.clerkId}:${legendCode}:${EDITION}`;

    // 1. Auth.
    console.log("\n[1] Auth");
    const unauth = await api("POST", "/payments/iap/sync", {});
    check("sync unauth -> 401", unauth.status === 401, `got ${unauth.status}`);

    // 2. No entitlements (RevenueCat 404 for an unknown customer).
    console.log("\n[2] No entitlements");
    const none = await api("POST", "/payments/iap/sync", { token: buyer.token });
    check(
      "no entitlements -> activated:false, planCode null",
      none.status === 200 && none.data?.activated === false && none.data?.planCode === null,
      JSON.stringify(none.data),
    );
    check("no active sub yet", (await activeSubsFor(buyer.userId)).length === 0);

    // 3. Non-purchasable filter: entitled only to a coming-soon plan.
    console.log("\n[3] Non-purchasable (coming soon) filter");
    customerHoldings.set(buyer.clerkId, [soonCode]);
    const soonOnly = await api("POST", "/payments/iap/sync", { token: buyer.token });
    check(
      "coming-soon entitlement -> activated:false",
      soonOnly.status === 200 && soonOnly.data?.activated === false,
      JSON.stringify(soonOnly.data),
    );
    check("still no active sub", (await activeSubsFor(buyer.userId)).length === 0);

    // 4. Happy path: entitled to PRO activates PRO.
    console.log("\n[4] Happy path activation");
    customerHoldings.set(buyer.clerkId, [proCode]);
    const proSync = await api("POST", "/payments/iap/sync", { token: buyer.token });
    check(
      "entitled to PRO -> activated PRO",
      proSync.status === 200 &&
        proSync.data?.activated === true &&
        proSync.data?.planCode === proCode,
      JSON.stringify(proSync.data),
    );
    const afterPro = await activeSubsFor(buyer.userId);
    check("exactly one active subscription", afterPro.length === 1, `got ${afterPro.length}`);
    check(
      "active sub is PRO with revenuecat reference",
      afterPro[0]?.planId === pro.id &&
        afterPro[0]?.paymentProvider === "revenuecat" &&
        afterPro[0]?.paymentReference === proRef,
      JSON.stringify(afterPro[0]),
    );

    // 5. Idempotent re-sync of the same active entitlement.
    console.log("\n[5] Idempotent re-sync");
    const proReplay = await api("POST", "/payments/iap/sync", { token: buyer.token });
    check(
      "re-sync -> 200 still PRO",
      proReplay.status === 200 && proReplay.data?.planCode === proCode,
      JSON.stringify(proReplay.data),
    );
    const afterReplay = await activeSubsFor(buyer.userId);
    check("still exactly one active subscription", afterReplay.length === 1, `got ${afterReplay.length}`);

    // 6. Upgrade/supersede: now also holds LEGEND -> upgrade to LEGEND.
    console.log("\n[6] Upgrade + supersede");
    customerHoldings.set(buyer.clerkId, [proCode, legendCode]);
    const legendSync = await api("POST", "/payments/iap/sync", { token: buyer.token });
    check(
      "also holds LEGEND -> upgraded to LEGEND",
      legendSync.status === 200 &&
        legendSync.data?.activated === true &&
        legendSync.data?.planCode === legendCode,
      JSON.stringify(legendSync.data),
    );
    const afterLegend = await activeSubsFor(buyer.userId);
    check(
      "exactly one active sub, now LEGEND with legend reference",
      afterLegend.length === 1 &&
        afterLegend[0]?.planId === legend.id &&
        afterLegend[0]?.paymentReference === legendRef,
      JSON.stringify(afterLegend.map((s) => ({ planId: s.planId, ref: s.paymentReference }))),
    );

    // 6b. Regression: after an upgrade, a STALE cheaper-only entitlement (the
    //     superseded PRO pass is now cancelled in our table) must still report
    //     the ACTIVE LEGEND pass, not the old PRO code. This guards the
    //     idempotency lookup against matching a cancelled reference row.
    console.log("\n[6b] Stale superseded reference after upgrade");
    customerHoldings.set(buyer.clerkId, [proCode]);
    const staleAfterUpgrade = await api("POST", "/payments/iap/sync", {
      token: buyer.token,
    });
    check(
      "cheaper-only entitlement after upgrade still reports LEGEND",
      staleAfterUpgrade.status === 200 && staleAfterUpgrade.data?.planCode === legendCode,
      JSON.stringify(staleAfterUpgrade.data),
    );
    const afterStale = await activeSubsFor(buyer.userId);
    check(
      "buyer still exactly one active sub, still LEGEND",
      afterStale.length === 1 && afterStale[0]?.planId === legend.id,
      JSON.stringify(afterStale.map((s) => s.planId)),
    );

    // 7. Monotonic guard: a fresh user whose FIRST pass was LEGEND and who now
    //    only reports a cheaper PRO entitlement is NOT downgraded.
    console.log("\n[7] Monotonic downgrade guard");
    customerHoldings.set(mono.clerkId, [legendCode]);
    const monoLegend = await api("POST", "/payments/iap/sync", { token: mono.token });
    check(
      "mono first sync -> LEGEND",
      monoLegend.status === 200 && monoLegend.data?.planCode === legendCode,
      JSON.stringify(monoLegend.data),
    );
    // Legend "revoked"; only the cheaper PRO entitlement remains.
    customerHoldings.set(mono.clerkId, [proCode]);
    const monoDown = await api("POST", "/payments/iap/sync", { token: mono.token });
    check(
      "cheaper entitlement does NOT downgrade (still LEGEND)",
      monoDown.status === 200 && monoDown.data?.planCode === legendCode,
      JSON.stringify(monoDown.data),
    );
    const afterMono = await activeSubsFor(mono.userId);
    check(
      "mono still exactly one active sub, still LEGEND",
      afterMono.length === 1 && afterMono[0]?.planId === legend.id,
      JSON.stringify(afterMono.map((s) => s.planId)),
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
    for (const id of created.clerkIds) await deleteClerkUser(id);

    globalThis.fetch = realFetch;
    if (priorProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProjectId;

    await safe("server close", () => new Promise((r) => server.close(() => r(null))));
    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`RevenueCat IAP sync regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`RevenueCat IAP sync regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("RevenueCat IAP sync regression crashed:", err);
    process.exit(1);
  });
