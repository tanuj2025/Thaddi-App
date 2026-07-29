/**
 * Season-based all-access pass regression test (Task #233, P7).
 *
 * THADDI sells ONE all-access pass PER SEASON, scoped to a season "edition".
 * Historically there was a single hardcoded edition "WORLD_CHAMPIONSHIP_2026"; this suite
 * locks down the generalization to a canonical, season-keyed edition that treats
 * the legacy value as an ALIAS of the 2026 season — so no existing purchaser is
 * stranded and none is double-charged.
 *
 * Unlike the HTTP e2e suites, this is a MODULE-level integration test: it calls
 * the billing-season services directly (no Express boot, no Clerk tokens). It
 * exercises four layers:
 *
 *   1. Pure edition algebra (canonicalize / aliases / isLegacy / RC lookup
 *      build+parse) — no DB, no network.
 *   2. resolveCurrentPassEdition() resolution order: PASS_SEASON_KEY override ->
 *      deprecated TOURNAMENT_EDITION -> DB-derived covering/upcoming season ->
 *      calendar-year fallback. The DB-derived season-selection POLICY
 *      (pickCurrentSeasonFromWindows) is exercised against FIXED fixtures so the
 *      assertions are deterministic — the live `tournaments` table is mutated
 *      continuously by the sync scheduler, so asserting the policy against it
 *      directly is racy. The fixtures verify the "earliest-ending covering wins"
 *      overlap rule (a WC pass holder is not stranded when the King's Cup opens
 *      on Jul 1, before the Jul 19 final) and the nearest-upcoming pre-season
 *      tiebreak. One live smoke check confirms resolveCurrentPassEdition reads
 *      the real DB end-to-end (the World Championship covers Jun 19 2026 and ends soonest).
 *   3. getUserPlan() season scoping: a pass grants premium only for the CURRENT
 *      edition (legacy WORLD_CHAMPIONSHIP_2026 == season_2026); an ended season's pass no
 *      longer grants premium; editionless (manual) grants are season-agnostic.
 *   4. resolveActivePlanCodes() RevenueCat guard: a season-scoped entitlement
 *      grants only its own edition; a legacy UNSCOPED entitlement grants a pass
 *      only while the current season is the legacy season_2026.
 *
 * RevenueCat is reached through the Replit connectors proxy (createProxyFetch),
 * so the stub intercepts only the two proxied endpoints and passes everything
 * else through, exactly like iapSync.e2e.ts. Every fixture is seeded directly
 * and reverted at the end, leaving the DB as found.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  plansTable,
  subscriptionsTable,
  tournamentsTable,
} from "@workspace/db";
import {
  canonicalizePassEdition,
  editionAliases,
  isLegacySeasonEdition,
  revenueCatEntitlementLookup,
  parseRevenueCatEntitlementLookup,
  resolveCurrentPassEdition,
  pickCurrentSeasonFromWindows,
  LEGACY_WORLD_CHAMPIONSHIP_EDITION,
  LEGACY_SEASON_EDITION,
  type SeasonWindowRow,
} from "../src/services/payments/passSeason";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// RevenueCat must look configured for resolveActivePlanCodes to attempt
// verification. A dummy project id is enough because every RevenueCat HTTP call
// is intercepted below.
const priorProjectId = process.env.REVENUECAT_PROJECT_ID;
process.env.REVENUECAT_PROJECT_ID = "test_proj_dummy";

// The edition resolver reads these at call time; snapshot them so the env knobs
// we toggle below are restored exactly as found.
const priorPassSeason = process.env.PASS_SEASON_KEY;
const priorTournamentEdition = process.env.TOURNAMENT_EDITION;

// ---- RevenueCat connectors-proxy fetch stub --------------------------------
// `catalog` is the project entitlement catalog (id -> lookup_key). `holdings`
// maps a RevenueCat customer id to the entitlement ids it currently holds. The
// SDK's listEntitlements hits /projects/:id/entitlements; the per-customer
// listCustomerActiveEntitlements hits
// /projects/:id/customers/:cid/active_entitlements.

const catalog: { id: string; lookup_key: string }[] = [];
const holdings = new Map<string, string[]>();

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input?.url ?? String(input));

  if (url.includes("/api/v2/proxy/")) {
    const customerMatch = url.match(/\/customers\/([^/?]+)\/active_entitlements/);
    if (customerMatch) {
      const customerId = decodeURIComponent(customerMatch[1]);
      const ids = holdings.get(customerId);
      if (!ids || ids.length === 0) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          items: ids.map((entitlement_id) => ({
            object: "customer.active_entitlement",
            entitlement_id,
            expires_at: null,
          })),
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (/\/entitlements(\?|$)/.test(url)) {
      return new Response(
        JSON.stringify({
          items: catalog.map((e) => ({
            object: "entitlement",
            id: e.id,
            lookup_key: e.lookup_key,
            display_name: e.lookup_key,
          })),
          next_page: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ items: [], next_page: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return realFetch(input, init);
}) as typeof fetch;

// Imported AFTER the env + fetch stub are installed (mirrors iapSync.e2e.ts).
const { getUserPlan } = await import("../src/lib/entitlements");
const { resolveActivePlanCodes } = await import(
  "../src/services/payments/revenuecat"
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

function clearEditionEnv(): void {
  delete process.env.PASS_SEASON_KEY;
  delete process.env.TOURNAMENT_EDITION;
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();
  const created: { userIds: string[]; planIds: string[] } = {
    userIds: [],
    planIds: [],
  };

  try {
    // 1. Pure edition algebra ------------------------------------------------
    console.log("\n[1] Edition algebra (pure)");
    check(
      "canonicalize legacy WORLD_CHAMPIONSHIP_2026 -> season_2026",
      canonicalizePassEdition(LEGACY_WORLD_CHAMPIONSHIP_EDITION) === LEGACY_SEASON_EDITION,
    );
    check(
      "canonicalize bare year 2026 -> season_2026",
      canonicalizePassEdition("2026") === "season_2026",
    );
    check(
      "canonicalize 2026/27 -> season_2026_27",
      canonicalizePassEdition("2026/27") === "season_2026_27",
    );
    check(
      "canonicalize whitespace+separators '  2026 - 27 ' -> season_2026_27",
      canonicalizePassEdition("  2026 - 27 ") === "season_2026_27",
    );
    check(
      "canonicalize already-canonical season_2026_27 is idempotent",
      canonicalizePassEdition("season_2026_27") === "season_2026_27",
    );
    check(
      "canonicalize empty string -> legacy season (defensive)",
      canonicalizePassEdition("") === LEGACY_SEASON_EDITION,
    );

    check(
      "aliases(season_2026) include season_2026, WORLD_CHAMPIONSHIP_2026, 2026",
      sameSet(editionAliases("season_2026"), [
        "season_2026",
        "WORLD_CHAMPIONSHIP_2026",
        "2026",
      ]),
      JSON.stringify(editionAliases("season_2026")),
    );
    check(
      "aliases(season_2026_27) alias only themselves (no legacy bridge)",
      sameSet(editionAliases("season_2026_27"), ["season_2026_27"]),
      JSON.stringify(editionAliases("season_2026_27")),
    );

    check(
      "isLegacySeasonEdition(season_2026) is true",
      isLegacySeasonEdition("season_2026") === true,
    );
    check(
      "isLegacySeasonEdition(season_2026_27) is false",
      isLegacySeasonEdition("season_2026_27") === false,
    );

    check(
      "RC lookup build is {edition}__{plan} with canonical edition",
      revenueCatEntitlementLookup("professional", "2026/27") ===
        "season_2026_27__professional" &&
        revenueCatEntitlementLookup("legend", LEGACY_WORLD_CHAMPIONSHIP_EDITION) ===
          "season_2026__legend",
    );
    check(
      "RC lookup parse of a scoped key recovers {edition, planCode}",
      (() => {
        const p = parseRevenueCatEntitlementLookup(
          "season_2026_27__professional",
        );
        return p.edition === "season_2026_27" && p.planCode === "professional";
      })(),
    );
    check(
      "RC lookup parse of a bare legacy key yields null edition",
      (() => {
        const p = parseRevenueCatEntitlementLookup("professional");
        return p.edition === null && p.planCode === "professional";
      })(),
    );
    check(
      "RC lookup build->parse round-trips (edition canonicalized)",
      (() => {
        const key = revenueCatEntitlementLookup("legend", "2026/27");
        const p = parseRevenueCatEntitlementLookup(key);
        return p.edition === "season_2026_27" && p.planCode === "legend";
      })(),
    );

    // 2. resolveCurrentPassEdition resolution order --------------------------
    console.log("\n[2] resolveCurrentPassEdition resolution order");

    // 2a. PASS_SEASON_KEY override (canonicalized) wins over everything.
    clearEditionEnv();
    process.env.PASS_SEASON_KEY = "2026/27";
    check(
      "PASS_SEASON_KEY override canonicalized -> season_2026_27",
      (await resolveCurrentPassEdition()) === "season_2026_27",
    );
    process.env.PASS_SEASON_KEY = LEGACY_WORLD_CHAMPIONSHIP_EDITION;
    check(
      "PASS_SEASON_KEY legacy WORLD_CHAMPIONSHIP_2026 -> season_2026",
      (await resolveCurrentPassEdition()) === "season_2026",
    );

    // 2b. Deprecated TOURNAMENT_EDITION honored only when PASS_SEASON_KEY unset.
    clearEditionEnv();
    process.env.TOURNAMENT_EDITION = LEGACY_WORLD_CHAMPIONSHIP_EDITION;
    check(
      "deprecated TOURNAMENT_EDITION -> season_2026",
      (await resolveCurrentPassEdition()) === "season_2026",
    );

    // 2c. DB-derived season-selection POLICY (pure, deterministic) ----------
    // resolveCurrentPassEdition applies pickCurrentSeasonFromWindows to the live
    // tournament windows. We exercise that policy here against FIXED fixtures so
    // it is deterministic: the real `tournaments` table is mutated continuously
    // by the sync scheduler (it attaches and rolls forward league windows as
    // ESPN publishes seasons), so asserting the policy against it directly is
    // racy. `editionOf` mirrors resolveCurrentPassEdition's final two steps:
    // canonicalize the picked season, falling back to the calendar year when no
    // dated window applies.
    clearEditionEnv();
    const editionOf = (now: Date, windows: SeasonWindowRow[]): string =>
      canonicalizePassEdition(
        pickCurrentSeasonFromWindows(windows, now) ??
          `season_${now.getUTCFullYear()}`,
      );

    // Realistic multi-competition windows: the World Championship runs summer 2026 with
    // PRECISE published dates; the domestic leagues run 2026/27 on the Aug–May
    // club calendar; the King's Cup opens Jul 1, overlapping the Jul 19 WC final.
    const seeded: SeasonWindowRow[] = [
      {
        season: "2026", // World Championship
        startDate: new Date("2026-06-11T00:00:00Z"),
        endDate: new Date("2026-07-19T23:59:59Z"),
        displayOrder: 0,
      },
      {
        season: "2026/27", // King's Cup — opens during the WC overlap
        startDate: new Date("2026-07-01T00:00:00Z"),
        endDate: new Date("2027-05-31T23:59:59Z"),
        displayOrder: 3,
      },
      {
        season: "2026/27", // domestic leagues — Aug–May club calendar
        startDate: new Date("2026-08-15T00:00:00Z"),
        endDate: new Date("2027-05-24T23:59:59Z"),
        displayOrder: 1,
      },
    ];

    check(
      "policy now=2026-06-19 -> season_2026 (World Championship covers)",
      editionOf(new Date("2026-06-19T12:00:00Z"), seeded) === "season_2026",
    );
    check(
      "policy overlap now=2026-07-10 -> season_2026 (earliest-ending covering wins, WC holder not stranded)",
      editionOf(new Date("2026-07-10T12:00:00Z"), seeded) === "season_2026",
    );
    check(
      "policy now=2026-08-01 -> season_2026_27 (WC ended, King's Cup covers)",
      editionOf(new Date("2026-08-01T12:00:00Z"), seeded) === "season_2026_27",
    );
    check(
      "policy pre-season now=2026-01-01 -> season_2026 (nearest upcoming = WC)",
      editionOf(new Date("2026-01-01T12:00:00Z"), seeded) === "season_2026",
    );
    check(
      "policy far-future now=2030-01-01 -> season_2030 (no window -> calendar fallback)",
      editionOf(new Date("2030-01-01T12:00:00Z"), seeded) === "season_2030",
    );

    // The nearest-upcoming tiebreak is purely by START date (then displayOrder):
    // a league window opening BEFORE the World Championship would be picked pre-season.
    // This is the live edge behind THADDI's coarse off-season league-window
    // estimates (a league whose exact fixtures aren't published yet can get a
    // window starting before the WC) — documented so the policy is unambiguous.
    check(
      "policy nearest-upcoming follows the earliest START date regardless of competition",
      pickCurrentSeasonFromWindows(
        [
          {
            season: "2026",
            startDate: new Date("2026-06-11T00:00:00Z"),
            endDate: new Date("2026-07-19T23:59:59Z"),
            displayOrder: 0,
          },
          {
            season: "2026/27",
            startDate: new Date("2026-06-01T00:00:00Z"), // opens 10d before WC
            endDate: new Date("2027-06-01T00:00:00Z"),
            displayOrder: 1,
          },
        ],
        new Date("2026-01-01T12:00:00Z"),
      ) === "2026/27",
    );
    check(
      "policy ignores undated (coming-soon) seasons",
      pickCurrentSeasonFromWindows(
        [
          { season: "2026/27", startDate: null, endDate: null, displayOrder: 1 },
        ],
        new Date("2026-01-01T12:00:00Z"),
      ) === null,
    );

    // 2d. Live integration smoke: resolveCurrentPassEdition reads the real DB
    // end-to-end. We insert a temporary FAR-FUTURE tournament window and resolve
    // at a date only it covers — its canonical edition (season_2055_56) DIFFERS
    // from the calendar-year fallback (season_2055), so a pass here PROVES the
    // DB-derived path actually ran (the fallback alone could never produce it).
    // The row is competition-slug-less (exempt from the active-competition unique
    // index) and far past every real seeded window, so no live/scheduler state
    // perturbs it. check() never throws, so the cleanup delete always runs.
    clearEditionEnv();
    const probeSlug = `e2e_passseason_dbprobe_${Date.now()}`;
    const [probe] = await db
      .insert(tournamentsTable)
      .values({
        slug: probeSlug,
        nameEn: "E2E DB Probe",
        nameAr: "E2E DB Probe",
        season: "2055/56",
        startDate: new Date("2055-01-01T00:00:00Z"),
        endDate: new Date("2056-01-01T00:00:00Z"),
        competitionSlug: null,
        isActive: false,
      })
      .returning({ id: tournamentsTable.id });
    check(
      "live resolveCurrentPassEdition reads the DB-derived window (season_2055_56 != calendar fallback season_2055)",
      (await resolveCurrentPassEdition(new Date("2055-06-01T12:00:00Z"))) ===
        "season_2055_56",
    );
    await db
      .delete(tournamentsTable)
      .where(eq(tournamentsTable.id, probe.id));

    // 3. getUserPlan season scoping ------------------------------------------
    console.log("\n[3] getUserPlan season scoping");

    // A premium plan to grant. The Free plan is already seeded; getUserPlan
    // falls back to it when no active in-season pass exists.
    const premiumCode = `e2e_passseason_premium_${stamp}`;
    const [premium] = await db
      .insert(plansTable)
      .values({
        code: premiumCode,
        nameEn: "Season Pass E2E",
        nameAr: "اشتراك الموسم",
        priceSar: "300",
        participantLimit: 100,
        isActive: true,
        isComingSoon: false,
      })
      .returning();
    created.planIds.push(premium.id);

    async function makeUser(label: string): Promise<string> {
      const [row] = await db
        .insert(usersTable)
        .values({
          clerkUserId: `e2e-passseason-${label}-${stamp}`,
          email: `thaddi-passseason-${label}-${stamp}@example.com`,
          status: "active",
        })
        .returning();
      created.userIds.push(row.id);
      return row.id;
    }

    async function grant(
      userId: string,
      edition: string | null,
    ): Promise<void> {
      await db.insert(subscriptionsTable).values({
        userId,
        planId: premium.id,
        status: "active",
        edition,
        paymentProvider: "e2e-passseason",
        paymentReference: `e2e-passseason:${userId}:${edition ?? "null"}:${stamp}`,
      });
    }

    const legacyUser = await makeUser("legacy"); // edition WORLD_CHAMPIONSHIP_2026
    const canonicalUser = await makeUser("canonical"); // edition season_2026
    const futureUser = await makeUser("future"); // edition season_2027
    const manualUser = await makeUser("manual"); // editionless grant

    await grant(legacyUser, LEGACY_WORLD_CHAMPIONSHIP_EDITION);
    await grant(canonicalUser, "season_2026");
    await grant(futureUser, "season_2027");
    await grant(manualUser, null);

    // Phase A: current season is the 2026 (legacy) season.
    clearEditionEnv();
    process.env.PASS_SEASON_KEY = "season_2026";
    check(
      "current season_2026: legacy WORLD_CHAMPIONSHIP_2026 pass grants premium",
      (await getUserPlan(legacyUser)).planCode === premiumCode,
    );
    check(
      "current season_2026: canonical season_2026 pass grants premium",
      (await getUserPlan(canonicalUser)).planCode === premiumCode,
    );
    check(
      "current season_2026: a future season_2027 pass does NOT grant premium (free)",
      (await getUserPlan(futureUser)).planCode === "free",
    );
    check(
      "current season_2026: editionless manual grant always grants premium",
      (await getUserPlan(manualUser)).planCode === premiumCode,
    );

    // Phase B: platform has rolled forward to the season_2027 season.
    process.env.PASS_SEASON_KEY = "season_2027";
    check(
      "rolled to season_2027: last season's WORLD_CHAMPIONSHIP_2026 pass no longer grants premium (free)",
      (await getUserPlan(legacyUser)).planCode === "free",
    );
    check(
      "rolled to season_2027: the season_2027 pass now grants premium",
      (await getUserPlan(futureUser)).planCode === premiumCode,
    );
    check(
      "rolled to season_2027: editionless manual grant still grants premium",
      (await getUserPlan(manualUser)).planCode === premiumCode,
    );

    // 4. resolveActivePlanCodes RevenueCat season guard ----------------------
    console.log("\n[4] resolveActivePlanCodes RevenueCat season guard");
    clearEditionEnv();
    const code = `e2e_ps_pro_${stamp}`;
    const entBare = `ent_bare_${stamp}`;
    const ent2026 = `ent_2026_${stamp}`;
    const ent2627 = `ent_2627_${stamp}`;
    catalog.push(
      { id: entBare, lookup_key: code }, // legacy unscoped key
      { id: ent2026, lookup_key: revenueCatEntitlementLookup(code, "season_2026") },
      {
        id: ent2627,
        lookup_key: revenueCatEntitlementLookup(code, "season_2026_27"),
      },
    );
    holdings.set(`cust_bare_${stamp}`, [entBare]);
    holdings.set(`cust_2026_${stamp}`, [ent2026]);
    holdings.set(`cust_2627_${stamp}`, [ent2627]);

    check(
      "legacy bare key honored when current season is legacy season_2026",
      sameSet(
        await resolveActivePlanCodes(`cust_bare_${stamp}`, "season_2026"),
        [code],
      ),
    );
    check(
      "legacy bare key NOT honored once current season is a later (non-legacy) season",
      sameSet(
        await resolveActivePlanCodes(`cust_bare_${stamp}`, "season_2026_27"),
        [],
      ),
    );
    check(
      "season-scoped season_2026 key grants in its own season",
      sameSet(
        await resolveActivePlanCodes(`cust_2026_${stamp}`, "season_2026"),
        [code],
      ),
    );
    check(
      "season-scoped season_2026 key does NOT grant a different season",
      sameSet(
        await resolveActivePlanCodes(`cust_2026_${stamp}`, "season_2026_27"),
        [],
      ),
    );
    check(
      "season-scoped season_2026_27 key grants in its own season",
      sameSet(
        await resolveActivePlanCodes(`cust_2627_${stamp}`, "season_2026_27"),
        [code],
      ),
    );
    check(
      "unknown customer (RevenueCat 404) -> no plan codes",
      sameSet(
        await resolveActivePlanCodes(`cust_unknown_${stamp}`, "season_2026"),
        [],
      ),
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
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, created.userIds)),
      );
    }
    if (created.planIds.length) {
      await safe("plans", () =>
        db.delete(plansTable).where(inArray(plansTable.id, created.planIds)),
      );
    }

    globalThis.fetch = realFetch;
    if (priorProjectId === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = priorProjectId;
    if (priorPassSeason === undefined) delete process.env.PASS_SEASON_KEY;
    else process.env.PASS_SEASON_KEY = priorPassSeason;
    if (priorTournamentEdition === undefined)
      delete process.env.TOURNAMENT_EDITION;
    else process.env.TOURNAMENT_EDITION = priorTournamentEdition;

    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Season pass regression: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Season pass regression: ${failures.length} FAILED, ${passed} passed.`,
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
    console.error("Season pass regression crashed:", err);
    process.exit(1);
  });
