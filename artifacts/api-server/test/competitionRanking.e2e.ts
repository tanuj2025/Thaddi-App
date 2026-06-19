/**
 * Per-competition / per-season ranking regression test (Task #233, P5).
 *
 * Exercises `computeCompetitionRanking` directly against the dev DB with fully
 * throwaway, self-cleaning fixtures. It proves the parts that make a competition
 * leaderboard correct:
 *
 *   - tournament-scope isolation: a player's points on ANOTHER competition's
 *     matches must never leak into this competition's total;
 *   - season isolation + "never resurface an ended season": with no explicit
 *     season the CURRENT (in-window) season is read, not last year's ended row,
 *     even though both belong to the same competition;
 *   - explicit season key: passing ?season= reads that exact row (including an
 *     ended one);
 *   - cross-competition isolation: a competition only lists players who predicted
 *     ITS matches;
 *   - coming-soon: a competition with no dated season window returns
 *     comingSoon=true with an empty board.
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
  usersTable,
  profilesTable,
  predictionsTable,
} from "@workspace/db";
import { computeCompetitionRanking } from "../src/services/scoring/rankings";

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

  const compA = `test.cra-${stamp}`; // two seasons: 2026 (active) + 2025 (ended)
  const compB = `test.crb-${stamp}`; // one active season
  const compC = `test.crc-${stamp}`; // coming-soon shell only

  // Created-id trackers for teardown.
  const tournIds: string[] = [];
  const userIds: string[] = [];
  const teamExts = [
    `espn:${compA}:team:h`,
    `espn:${compA}:team:a`,
    `espn:${compB}:team:h`,
    `espn:${compB}:team:a`,
  ];

  const mkTournament = async (
    slug: string,
    competitionSlug: string,
    season: string,
    start: Date | null,
    end: Date | null,
    isActive = true,
  ) => {
    const [r] = await db
      .insert(tournamentsTable)
      .values({
        slug,
        nameEn: slug,
        nameAr: slug,
        type: "league",
        status: "active",
        season,
        competitionSlug,
        providerLeagueSlug: competitionSlug,
        hasPublishedFixtures: start != null,
        startDate: start,
        endDate: end,
        isActive,
      })
      .returning({ id: tournamentsTable.id });
    tournIds.push(r.id);
    return r.id;
  };

  const mkTeam = async (externalId: string, name: string, comp: string) => {
    const [r] = await db
      .insert(teamsTable)
      .values({
        nameEn: name,
        nameAr: name,
        externalId,
        kind: "club",
        primaryCompetitionSlug: comp,
      })
      .returning({ id: teamsTable.id });
    return r.id;
  };

  const mkMatch = async (
    tournamentId: string,
    homeTeamId: string,
    awayTeamId: string,
  ) => {
    const [r] = await db
      .insert(matchesTable)
      .values({
        tournamentId,
        homeTeamId,
        awayTeamId,
        kickoffAt: new Date(now.getTime() - day),
        status: "finished",
        homeScore: 2,
        awayScore: 1,
      })
      .returning({ id: matchesTable.id });
    return r.id;
  };

  const mkUser = async (n: number) => {
    const [u] = await db
      .insert(usersTable)
      .values({ clerkUserId: `test-p5-u${n}-${stamp}` })
      .returning({ id: usersTable.id });
    userIds.push(u.id);
    await db.insert(profilesTable).values({
      userId: u.id,
      displayName: `P5 User ${n} ${stamp}`,
      username: `p5u${n}_${stamp}`,
    });
    return u.id;
  };

  const mkPrediction = async (
    userId: string,
    matchId: string,
    outcome: "exact" | "winner",
    points: number,
  ) => {
    await db.insert(predictionsTable).values({
      userId,
      matchId,
      homeScore: 2,
      awayScore: 1,
      outcome,
      pointsAwarded: points,
      scoredAt: now,
    });
  };

  try {
    // --- Seed -------------------------------------------------------------
    const tA2026 = await mkTournament(
      `${compA}-2026`,
      compA,
      "2026",
      new Date(now.getTime() - 30 * day),
      new Date(now.getTime() + 60 * day),
    );
    const tA2025 = await mkTournament(
      `${compA}-2025`,
      compA,
      "2025",
      new Date(now.getTime() - 400 * day),
      new Date(now.getTime() - 300 * day),
      false,
    );
    const tB2026 = await mkTournament(
      `${compB}-2026`,
      compB,
      "2026",
      new Date(now.getTime() - 30 * day),
      new Date(now.getTime() + 60 * day),
    );
    // compC: coming-soon shell — competition row but no dated season window.
    await mkTournament(`${compC}-2026`, compC, "2026", null, null);

    const aH = await mkTeam(teamExts[0], "A Home", compA);
    const aA = await mkTeam(teamExts[1], "A Away", compA);
    const bH = await mkTeam(teamExts[2], "B Home", compB);
    const bA = await mkTeam(teamExts[3], "B Away", compB);

    const mA2026 = await mkMatch(tA2026, aH, aA);
    const mA2025 = await mkMatch(tA2025, aH, aA);
    const mB2026 = await mkMatch(tB2026, bH, bA);

    const u1 = await mkUser(1);
    const u2 = await mkUser(2);

    // u1: exact (3) on compA-2026, exact (3) on compB-2026, exact (3) on the
    // ENDED compA-2025. u2: winner (1) on compA-2026 only.
    await mkPrediction(u1, mA2026, "exact", 3);
    await mkPrediction(u1, mB2026, "exact", 3);
    await mkPrediction(u1, mA2025, "exact", 3);
    await mkPrediction(u2, mA2026, "winner", 1);

    // --- Case A: current season + tournament/season isolation -------------
    console.log("\nCurrent season, tournament + season isolation:");
    const a = await computeCompetitionRanking(compA, null, u1, 100, now);
    check("resolves the CURRENT (active) season, not the ended one", a.tournamentId === tA2026, `tournamentId=${a.tournamentId}`);
    check('reported season is "2026"', a.season === "2026", `season=${a.season}`);
    check("not coming soon", a.comingSoon === false);
    check("participantCount = 2 (both predicted this comp-season)", a.participantCount === 2, `count=${a.participantCount}`);
    const a1 = a.entries.find((e) => e.userId === u1);
    const a2 = a.entries.find((e) => e.userId === u2);
    check(
      "u1 points = 3 (compB + ended 2025 EXCLUDED)",
      a1?.points === 3,
      `points=${a1?.points}`,
    );
    check("u1 is rank 1", a1?.rank === 1, `rank=${a1?.rank}`);
    check("u2 points = 1", a2?.points === 1, `points=${a2?.points}`);
    check("u2 is rank 2", a2?.rank === 2, `rank=${a2?.rank}`);
    check("no snapshot yet → rankMovement 0", a1?.rankMovement === 0);
    check("me resolves to the viewer (u1)", a.me?.userId === u1);

    // --- Case B: explicit ended-season key --------------------------------
    console.log("\nExplicit ended-season key:");
    const aEnded = await computeCompetitionRanking(compA, "2025", null, 100, now);
    check("explicit season reads the ended 2025 row", aEnded.tournamentId === tA2025, `tournamentId=${aEnded.tournamentId}`);
    check("2025 board has exactly 1 player (only u1 predicted)", aEnded.participantCount === 1, `count=${aEnded.participantCount}`);
    check("u1 points on 2025 = 3", aEnded.entries[0]?.points === 3, `points=${aEnded.entries[0]?.points}`);

    // --- Case C: cross-competition isolation ------------------------------
    console.log("\nCross-competition isolation:");
    const b = await computeCompetitionRanking(compB, null, null, 100, now);
    check("compB resolves its active season", b.tournamentId === tB2026);
    check("compB lists only u1 (u2 never predicted compB)", b.participantCount === 1, `count=${b.participantCount}`);
    check("compB u1 points = 3", b.entries[0]?.points === 3, `points=${b.entries[0]?.points}`);

    // --- Case D: coming soon ---------------------------------------------
    console.log("\nComing soon (no dated season window):");
    const c = await computeCompetitionRanking(compC, null, null, 100, now);
    check("comingSoon = true", c.comingSoon === true);
    check("tournamentId is null", c.tournamentId === null);
    check("entries empty", c.entries.length === 0);

    // --- Case E: unknown competition -------------------------------------
    console.log("\nUnknown competition:");
    const unknown = await computeCompetitionRanking("test.nope-does-not-exist", null, null, 100, now);
    check("unknown competition is coming soon (empty)", unknown.comingSoon === true && unknown.entries.length === 0);
  } finally {
    console.log("\nTeardown:");
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`  teardown ${label} failed:`, err);
      }
    };

    if (userIds.length) {
      await safe("predictions", () =>
        db.delete(predictionsTable).where(inArray(predictionsTable.userId, userIds)),
      );
    }
    if (tournIds.length) {
      await safe("matches", () =>
        db.delete(matchesTable).where(inArray(matchesTable.tournamentId, tournIds)),
      );
    }
    await safe("teams", () =>
      db.delete(teamsTable).where(inArray(teamsTable.externalId, teamExts)),
    );
    if (userIds.length) {
      await safe("profiles", () =>
        db.delete(profilesTable).where(inArray(profilesTable.userId, userIds)),
      );
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, userIds)),
      );
    }
    if (tournIds.length) {
      await safe("tournaments", () =>
        db.delete(tournamentsTable).where(inArray(tournamentsTable.id, tournIds)),
      );
    }
    await safe("pool end", () => pool.end());
  }

  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Competition ranking: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Competition ranking: ${failures.length} FAILED, ${passed} passed.`,
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
    console.error("Competition ranking crashed:", err);
    process.exit(1);
  });
