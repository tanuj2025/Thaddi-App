/**
 * Multi-competition sync regression test (Task #233, P3).
 *
 * Drives the generic competition sync (`syncCompetition`) directly with an
 * injected snapshot (`snapshotOverride`), so the test is fully offline — it
 * never hits ESPN and never touches the World Championship rows. It exercises the parts
 * of the sync engine that the per-competition path adds on top of the legacy
 * World Championship path:
 *
 *   - club upsert: teams are written with kind="club" + primaryCompetitionSlug,
 *     and the tournament row's season metadata (hasPublishedFixtures, status,
 *     start/end dates) is patched atomically with the fixtures;
 *   - empty-snapshot no-prune: a snapshot with no matches must never delete the
 *     rows a previous sync created;
 *   - per-competition prune scope: a complete snapshot for competition A prunes
 *     A's own stale club but must NEVER touch competition B's clubs;
 *   - coming-soon: a null-season snapshot leaves the row untouched.
 *
 * Fully self-cleaning: it creates two throwaway competition rows + their clubs
 * and deletes exactly those in teardown, leaving the dev DB as found.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  tournamentsTable,
  teamsTable,
  matchesTable,
} from "@workspace/db";
import { syncCompetition } from "../src/services/football/sync";
import type {
  CompetitionSnapshot,
  SeasonWindow,
} from "../src/services/football/espnProvider";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

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

async function main(): Promise<void> {
  const stamp = Date.now();
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;

  // Two distinct competitions so we can prove per-competition prune scoping.
  const compASlug = `test.compa-${stamp}`;
  const compBSlug = `test.compb-${stamp}`;
  const tournASlug = `${compASlug}-2026`;
  const tournBSlug = `${compBSlug}-2026`;

  const season: SeasonWindow = {
    year: 2026,
    startDate: new Date(now.getTime() - 30 * day),
    endDate: new Date(now.getTime() + 60 * day),
    displayName: "2026",
  };

  // External ids namespaced exactly like the real engine: espn:{comp}:{kind}:{id}
  const a1Ext = `espn:${compASlug}:team:1`;
  const a2Ext = `espn:${compASlug}:team:2`;
  const aStaleExt = `espn:${compASlug}:team:stale`;
  const bExt = `espn:${compBSlug}:team:1`;
  const aMatchExt = `espn:${compASlug}:event:1`;

  const club = (
    externalId: string,
    name: string,
    competitionSlug: string,
  ) => ({
    externalId,
    nameEn: name,
    nameAr: name,
    code: null,
    flagUrl: null,
    countryCode: null,
    kind: "club" as const,
    primaryCompetitionSlug: competitionSlug,
  });

  const completeSnapshotA: CompetitionSnapshot = {
    slug: tournASlug,
    teams: [club(a1Ext, "A One", compASlug), club(a2Ext, "A Two", compASlug)],
    matches: [
      {
        externalId: aMatchExt,
        stageType: "league",
        homeTeamExternalId: a1Ext,
        awayTeamExternalId: a2Ext,
        kickoffAt: new Date(now.getTime() + 7 * day),
        status: "scheduled",
        homeScore: null,
        awayScore: null,
        minute: null,
        venue: "Test Park",
      },
    ],
    complete: true,
    hasFixtures: true,
    season,
  };

  const emptySnapshotA: CompetitionSnapshot = {
    slug: tournASlug,
    teams: [],
    matches: [],
    complete: true,
    hasFixtures: false,
    season,
  };

  const comingSoonSnapshotB: CompetitionSnapshot = {
    slug: tournBSlug,
    teams: [],
    matches: [],
    complete: false,
    hasFixtures: false,
    season: null,
  };

  let tournAId = "";
  let tournBId = "";

  // Read the current tournament row and shape it into the CompetitionRow that
  // syncCompetition consumes (callers always pass a freshly-read row).
  const rowFor = async (id: string) => {
    const [r] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, id));
    return {
      id: r.id,
      slug: r.slug,
      competitionSlug: r.competitionSlug,
      providerLeagueSlug: r.providerLeagueSlug,
      type: r.type as "league",
      countryCode: r.countryCode,
      hasPublishedFixtures: r.hasPublishedFixtures,
    };
  };

  const teamByExt = async (externalId: string) => {
    const rows = await db
      .select()
      .from(teamsTable)
      .where(eq(teamsTable.externalId, externalId));
    return rows[0];
  };

  try {
    // --- Seed two throwaway competition rows (coming-soon shells) ---
    const [tA] = await db
      .insert(tournamentsTable)
      .values({
        slug: tournASlug,
        nameEn: `Test Comp A ${stamp}`,
        nameAr: `بطولة أ ${stamp}`,
        type: "league",
        status: "upcoming",
        season: "2026",
        competitionSlug: compASlug,
        providerLeagueSlug: compASlug,
        hasPublishedFixtures: false,
        countryCode: "EN",
      })
      .returning({ id: tournamentsTable.id });
    tournAId = tA.id;

    const [tB] = await db
      .insert(tournamentsTable)
      .values({
        slug: tournBSlug,
        nameEn: `Test Comp B ${stamp}`,
        nameAr: `بطولة ب ${stamp}`,
        type: "league",
        status: "upcoming",
        season: "2026",
        competitionSlug: compBSlug,
        providerLeagueSlug: compBSlug,
        hasPublishedFixtures: false,
        countryCode: "ES",
      })
      .returning({ id: tournamentsTable.id });
    tournBId = tB.id;

    // --- Case A: club upsert + season metadata patch ---
    console.log("\nClub upsert + season metadata patch:");
    const resA = await syncCompetition(await rowFor(tournAId), {
      snapshotOverride: completeSnapshotA,
      now,
    });
    check(
      "syncCompetition upserted 2 clubs",
      resA.teamsUpserted === 2,
      `teamsUpserted=${resA.teamsUpserted}`,
    );
    check(
      "syncCompetition upserted 1 match",
      resA.matchesUpserted === 1,
      `matchesUpserted=${resA.matchesUpserted}`,
    );

    const a1 = await teamByExt(a1Ext);
    check("club row exists", Boolean(a1));
    check(
      'club kind = "club"',
      a1?.kind === "club",
      `kind=${JSON.stringify(a1?.kind)}`,
    );
    check(
      "club primaryCompetitionSlug = competition slug",
      a1?.primaryCompetitionSlug === compASlug,
      `slug=${JSON.stringify(a1?.primaryCompetitionSlug)}`,
    );

    const [patchedA] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournAId));
    check(
      "tournament hasPublishedFixtures flipped true",
      patchedA.hasPublishedFixtures === true,
    );
    check(
      'tournament status computed "active" (now in window)',
      patchedA.status === "active",
      `status=${patchedA.status}`,
    );
    check(
      "tournament startDate/endDate set from season window",
      patchedA.startDate != null && patchedA.endDate != null,
    );

    // --- Case B: empty snapshot must NOT prune ---
    console.log("\nEmpty-snapshot no-prune:");
    const resB = await syncCompetition(await rowFor(tournAId), {
      snapshotOverride: emptySnapshotA,
      now,
    });
    check(
      "empty snapshot pruned 0 teams",
      resB.teamsPruned === 0,
      `teamsPruned=${resB.teamsPruned}`,
    );
    check(
      "empty snapshot pruned 0 matches",
      resB.matchesPruned === 0,
      `matchesPruned=${resB.matchesPruned}`,
    );
    check("club survived empty snapshot", Boolean(await teamByExt(a1Ext)));
    const matchStillThere = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(eq(matchesTable.externalId, aMatchExt));
    check("match survived empty snapshot", matchStillThere.length === 1);
    const [afterEmpty] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournAId));
    check(
      "hasPublishedFixtures stays true (monotonic)",
      afterEmpty.hasPublishedFixtures === true,
    );

    // --- Case C: per-competition prune scope ---
    console.log("\nPer-competition prune scope:");
    // A stale club in competition A (not in the snapshot, no match refs).
    await db.insert(teamsTable).values({
      nameEn: `A Stale ${stamp}`,
      nameAr: `أ قديم ${stamp}`,
      externalId: aStaleExt,
      kind: "club",
      primaryCompetitionSlug: compASlug,
    });
    // A club in competition B that must be left alone by an A-scoped prune.
    await db.insert(teamsTable).values({
      nameEn: `B One ${stamp}`,
      nameAr: `ب واحد ${stamp}`,
      externalId: bExt,
      kind: "club",
      primaryCompetitionSlug: compBSlug,
    });

    const resC = await syncCompetition(await rowFor(tournAId), {
      snapshotOverride: completeSnapshotA,
      now,
    });
    check(
      "complete snapshot pruned >= 1 team (A's stale club)",
      resC.teamsPruned >= 1,
      `teamsPruned=${resC.teamsPruned}`,
    );
    check("A's stale club was pruned", !(await teamByExt(aStaleExt)));
    check(
      "B's club was NOT pruned (scope isolation)",
      Boolean(await teamByExt(bExt)),
    );
    check("A's real clubs survived", Boolean(await teamByExt(a1Ext)));

    // --- Case D: coming-soon (null season) leaves the row untouched ---
    console.log("\nComing-soon (no active season):");
    const resD = await syncCompetition(await rowFor(tournBId), {
      snapshotOverride: comingSoonSnapshotB,
      now,
    });
    check(
      "coming-soon sync is skipped",
      typeof resD.skipped === "string" &&
        resD.skipped.includes("no active season"),
      `skipped=${JSON.stringify(resD.skipped)}`,
    );
    const [bRow] = await db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournBId));
    check(
      "coming-soon row hasPublishedFixtures still false",
      bRow.hasPublishedFixtures === false,
    );
  } finally {
    console.log("\nTeardown:");
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`  teardown ${label} failed:`, err);
      }
    };

    const tournIds = [tournAId, tournBId].filter(Boolean);
    if (tournIds.length) {
      await safe("matches", () =>
        db.delete(matchesTable).where(inArray(matchesTable.tournamentId, tournIds)),
      );
    }
    await safe("teams", () =>
      db
        .delete(teamsTable)
        .where(inArray(teamsTable.externalId, [a1Ext, a2Ext, aStaleExt, bExt])),
    );
    if (tournIds.length) {
      await safe("tournaments", () =>
        db.delete(tournamentsTable).where(inArray(tournamentsTable.id, tournIds)),
      );
    }
    await safe("pool end", () => pool.end());
  }

  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Multi-competition sync: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Multi-competition sync: ${failures.length} FAILED, ${passed} passed.`,
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
    console.error("Multi-competition sync crashed:", err);
    process.exit(1);
  });
