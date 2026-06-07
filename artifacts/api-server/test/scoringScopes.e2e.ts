/**
 * Scoring scope-coverage regression test.
 *
 * `scoringEngine.e2e.ts` proves the scoring math, but only for a CUSTOM-scope
 * challenge that explicitly lists the match. A match can belong to a challenge
 * through three other scopes, resolved in `src/lib/challengeMatches.ts`:
 *   - entire_tournament (every match of a tournament),
 *   - stage             (every match of a single stage),
 *   - team_journey       (every match either team plays).
 * A bug in any of those resolvers would silently award points to the wrong
 * challenges (or none). This test closes that gap.
 *
 * It seeds, in-process and directly against the dev DB:
 *   - two tournaments (A holds the match, B is a decoy),
 *   - two stages in tournament A (stage A holds the match, stage B is a decoy),
 *   - three teams (home + away play the match, "other" is a decoy),
 *   - a single FINISHED match (home 2 - 1 away) in tournament A / stage A,
 *   - ONE user with ONE exact prediction (the 100-point tier), and
 *   - SIX challenges that all list that user as an active participant:
 *       positive (should include the match):
 *         * entire_tournament -> tournament A
 *         * stage             -> stage A
 *         * team_journey       -> home team
 *       negative (should NOT include the match):
 *         * entire_tournament -> tournament B (different tournament)
 *         * stage             -> stage B (different stage, same tournament)
 *         * team_journey       -> other team (not in the match)
 *
 * It asserts:
 *   1. `matchIdsForChallenge` includes the match for every positive scope and
 *      excludes it for every negative scope (the resolver, directly).
 *   2. `challengesIncludingMatch` returns exactly the three positive challenges.
 *   3. `applyScoringForMatch` reports challengesAffected = 3 and lists exactly
 *      the positive challenge ids.
 *   4. The points_ledger gets one 100-point row in each positive challenge and
 *      none in any negative challenge — the same prediction attributed only
 *      where its scope covers the match.
 *   5. Participant aggregates: positives recompute to points=100/exact=1/total=1;
 *      negatives stay at 0/0/0 (never touched).
 *
 * Every seeded row is reverted afterward (ledger/predictions/participants
 * cascade from the challenges + match; ranking snapshots are removed by id-diff),
 * leaving the dev DB exactly as found.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  tournamentsTable,
  stagesTable,
  teamsTable,
  matchesTable,
  challengesTable,
  challengeParticipantsTable,
  predictionsTable,
  pointsLedgerTable,
  rankingsTable,
  type Challenge,
} from "@workspace/db";
import { applyScoringForMatch } from "../src/services/scoring/engine";
import {
  matchIdsForChallenge,
  challengesIncludingMatch,
} from "../src/lib/challengeMatches";

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

// ---- Ranking snapshot isolation (id-diff) -----------------------------------

async function rankingIdSet(): Promise<Set<string>> {
  const rows = await db.select({ id: rankingsTable.id }).from(rankingsTable);
  return new Set(rows.map((r) => r.id));
}
function added(before: Set<string>, after: Set<string>): string[] {
  return [...after].filter((id) => !before.has(id));
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();
  const hourMs = 60 * 60 * 1000;

  // Known final result: home 2 - 1 away.
  const ACTUAL = { home: 2, away: 1 };
  // The single prediction lands the exact tier (100 points).
  const EXACT_POINTS = 100;

  const created: {
    userId?: string;
    tournamentAId?: string;
    tournamentBId?: string;
    stageAId?: string;
    stageBId?: string;
    teamIds: string[];
    matchId?: string;
    challengeIds: string[];
  } = { teamIds: [], challengeIds: [] };

  let preRankingIds = new Set<string>();
  let newRankingIds: string[] = [];

  // Filled in during seeding; used across assertions.
  let challengeByLabel = new Map<string, Challenge>();

  // Which labels should include the match (positive) vs not (negative).
  const POSITIVE = ["tournament", "stage", "team"];
  const NEGATIVE = ["tournament_neg", "stage_neg", "team_neg"];

  try {
    // --- The one user: owner + active participant in every challenge ---
    const [user] = await db
      .insert(usersTable)
      .values({
        clerkUserId: `scoring-scope-e2e-${stamp}`,
        email: `thaddi-scoring-scope-e2e-${stamp}@example.com`,
        emailVerified: true,
        status: "active",
      })
      .returning();
    created.userId = user.id;

    // --- Tournaments: A holds the match, B is a decoy ---
    const [tournamentA] = await db
      .insert(tournamentsTable)
      .values({
        slug: `scoring-scope-a-${stamp}`,
        nameEn: "Scope E2E Tournament A",
        nameAr: "بطولة اختبار النطاق أ",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentAId = tournamentA.id;

    const [tournamentB] = await db
      .insert(tournamentsTable)
      .values({
        slug: `scoring-scope-b-${stamp}`,
        nameEn: "Scope E2E Tournament B",
        nameAr: "بطولة اختبار النطاق ب",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentBId = tournamentB.id;

    // --- Stages: A holds the match, B is a decoy in the SAME tournament ---
    const [stageA] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournamentA.id,
        nameEn: "Scope E2E Stage A",
        nameAr: "مرحلة أ",
        type: "group",
        orderIndex: 0,
      })
      .returning();
    created.stageAId = stageA.id;

    const [stageB] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournamentA.id,
        nameEn: "Scope E2E Stage B",
        nameAr: "مرحلة ب",
        type: "group",
        orderIndex: 1,
      })
      .returning();
    created.stageBId = stageB.id;

    // --- Teams: home + away play the match, "other" is a decoy ---
    const [home] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Scope E2E Home",
        nameAr: "فريق المضيف",
        externalId: `scoring-scope-home-${stamp}`,
      })
      .returning();
    const [away] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Scope E2E Away",
        nameAr: "فريق الضيف",
        externalId: `scoring-scope-away-${stamp}`,
      })
      .returning();
    const [other] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Scope E2E Other",
        nameAr: "فريق آخر",
        externalId: `scoring-scope-other-${stamp}`,
      })
      .returning();
    created.teamIds.push(home.id, away.id, other.id);

    // --- The finished match (tournament A / stage A, home vs away) ---
    const [match] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournamentA.id,
        stageId: stageA.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoffAt: new Date(Date.now() - 3 * hourMs),
        status: "finished",
        homeScore: ACTUAL.home,
        awayScore: ACTUAL.away,
        externalId: `scoring-scope-match-${stamp}`,
        venue: "Scope E2E Stadium",
      })
      .returning();
    created.matchId = match.id;

    // --- Six challenges (3 positive, 3 negative) ---
    const challengeSpecs: Array<{
      label: string;
      scope: "entire_tournament" | "stage" | "team_journey";
      tournamentId?: string;
      stageId?: string;
      teamId?: string;
    }> = [
      { label: "tournament", scope: "entire_tournament", tournamentId: tournamentA.id },
      { label: "stage", scope: "stage", stageId: stageA.id },
      { label: "team", scope: "team_journey", teamId: home.id },
      { label: "tournament_neg", scope: "entire_tournament", tournamentId: tournamentB.id },
      { label: "stage_neg", scope: "stage", stageId: stageB.id },
      { label: "team_neg", scope: "team_journey", teamId: other.id },
    ];

    challengeByLabel = new Map();
    for (const spec of challengeSpecs) {
      const [challenge] = await db
        .insert(challengesTable)
        .values({
          ownerId: user.id,
          name: `Scope E2E ${spec.label} ${stamp}`,
          type: "friends",
          visibility: "public",
          scope: spec.scope,
          status: "active",
          tournamentId: spec.tournamentId ?? null,
          stageId: spec.stageId ?? null,
          teamId: spec.teamId ?? null,
        })
        .returning();
      created.challengeIds.push(challenge.id);
      challengeByLabel.set(spec.label, challenge);
      // The user is an active participant of every challenge.
      await db.insert(challengeParticipantsTable).values({
        challengeId: challenge.id,
        userId: user.id,
        status: "active",
      });
    }

    // --- The one prediction (exact scoreline) ---
    await db.insert(predictionsTable).values({
      userId: user.id,
      matchId: match.id,
      homeScore: ACTUAL.home,
      awayScore: ACTUAL.away,
    });

    // ===================================================================
    // 1) matchIdsForChallenge: the resolver itself, per scope.
    // ===================================================================
    console.log("\nmatchIdsForChallenge per scope:");
    for (const label of POSITIVE) {
      const ids = await matchIdsForChallenge(challengeByLabel.get(label)!);
      check(
        `${label}: scope resolves to include the match`,
        ids.includes(match.id),
        `ids=${JSON.stringify(ids)}`,
      );
    }
    for (const label of NEGATIVE) {
      const ids = await matchIdsForChallenge(challengeByLabel.get(label)!);
      check(
        `${label}: scope resolves to EXCLUDE the match`,
        !ids.includes(match.id),
        `ids=${JSON.stringify(ids)}`,
      );
    }

    // ===================================================================
    // 2) challengesIncludingMatch: exactly the three positive challenges.
    // ===================================================================
    console.log("\nchallengesIncludingMatch:");
    const including = await challengesIncludingMatch(match.id);
    const includingIds = new Set(including.map((c) => c.id));
    for (const label of POSITIVE) {
      check(
        `${label}: included by challengesIncludingMatch`,
        includingIds.has(challengeByLabel.get(label)!.id),
      );
    }
    for (const label of NEGATIVE) {
      check(
        `${label}: NOT included by challengesIncludingMatch`,
        !includingIds.has(challengeByLabel.get(label)!.id),
      );
    }
    check(
      "challengesIncludingMatch returns exactly the 3 positive challenges",
      including.length === 3,
      `count=${including.length}`,
    );

    // ===================================================================
    // 3) applyScoringForMatch reporting.
    // ===================================================================
    console.log("\nScoring run:");
    preRankingIds = await rankingIdSet();
    const r = await applyScoringForMatch(match.id);
    check("scoring reports scored=true", r.scored === true, JSON.stringify(r));
    check(
      "scoring scored the one prediction",
      r.predictionsScored === 1,
      `predictionsScored=${r.predictionsScored}`,
    );
    const affected = new Set(r.affectedChallengeIds);
    check(
      "scoring touched exactly the 3 positive challenges",
      r.challengesAffected === 3 &&
        POSITIVE.every((l) => affected.has(challengeByLabel.get(l)!.id)) &&
        NEGATIVE.every((l) => !affected.has(challengeByLabel.get(l)!.id)),
      `challengesAffected=${r.challengesAffected} ids=${JSON.stringify(r.affectedChallengeIds)}`,
    );

    // ===================================================================
    // 4) points_ledger: a 100-point row only in the positive challenges.
    // ===================================================================
    console.log("\nPoints ledger per challenge:");
    for (const label of POSITIVE) {
      const rows = await db
        .select()
        .from(pointsLedgerTable)
        .where(eq(pointsLedgerTable.challengeId, challengeByLabel.get(label)!.id));
      check(
        `${label}: exactly one ledger row of ${EXACT_POINTS} (reason=exact)`,
        rows.length === 1 &&
          rows[0].points === EXACT_POINTS &&
          rows[0].reason === "exact" &&
          rows[0].userId === user.id,
        `rows=${rows.length} first=${JSON.stringify(rows[0])}`,
      );
    }
    for (const label of NEGATIVE) {
      const rows = await db
        .select()
        .from(pointsLedgerTable)
        .where(eq(pointsLedgerTable.challengeId, challengeByLabel.get(label)!.id));
      check(
        `${label}: NO ledger rows`,
        rows.length === 0,
        `rows=${rows.length}`,
      );
    }

    // ===================================================================
    // 5) Participant aggregates: positives scored, negatives untouched.
    // ===================================================================
    console.log("\nParticipant aggregates per challenge:");
    const aggregate = async (challengeId: string) => {
      const [row] = await db
        .select()
        .from(challengeParticipantsTable)
        .where(
          and(
            eq(challengeParticipantsTable.challengeId, challengeId),
            eq(challengeParticipantsTable.userId, user.id),
          ),
        );
      return row;
    };
    for (const label of POSITIVE) {
      const agg = await aggregate(challengeByLabel.get(label)!.id);
      check(
        `${label}: points=${EXACT_POINTS}, exact=1, total=1`,
        Boolean(agg) &&
          agg.points === EXACT_POINTS &&
          agg.exactPredictions === 1 &&
          agg.totalPredictions === 1,
        `got points=${agg?.points} exact=${agg?.exactPredictions} total=${agg?.totalPredictions}`,
      );
    }
    for (const label of NEGATIVE) {
      const agg = await aggregate(challengeByLabel.get(label)!.id);
      check(
        `${label}: aggregates untouched (points=0, exact=0, total=0)`,
        Boolean(agg) &&
          agg.points === 0 &&
          agg.exactPredictions === 0 &&
          agg.totalPredictions === 0,
        `got points=${agg?.points} exact=${agg?.exactPredictions} total=${agg?.totalPredictions}`,
      );
    }
  } finally {
    // --- Teardown: revert everything we created (child -> parent) ---
    console.log("\nTeardown:");
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`  teardown ${label} failed:`, err);
      }
    };

    newRankingIds = added(preRankingIds, await rankingIdSet());

    // Challenges cascade to participants, ledger and challenge-scope rankings.
    if (created.challengeIds.length) {
      await safe("challenges", () =>
        db
          .delete(challengesTable)
          .where(inArray(challengesTable.id, created.challengeIds)),
      );
    }
    // Match cascades to any remaining predictions/ledger.
    if (created.matchId) {
      await safe("predictions", () =>
        db
          .delete(predictionsTable)
          .where(eq(predictionsTable.matchId, created.matchId!)),
      );
      await safe("match", () =>
        db.delete(matchesTable).where(eq(matchesTable.id, created.matchId!)),
      );
    }
    if (created.teamIds.length) {
      await safe("teams", () =>
        db.delete(teamsTable).where(inArray(teamsTable.id, created.teamIds)),
      );
    }
    const stageIds = [created.stageAId, created.stageBId].filter(
      (x): x is string => Boolean(x),
    );
    if (stageIds.length) {
      await safe("stages", () =>
        db.delete(stagesTable).where(inArray(stagesTable.id, stageIds)),
      );
    }
    const tournamentIds = [created.tournamentAId, created.tournamentBId].filter(
      (x): x is string => Boolean(x),
    );
    if (tournamentIds.length) {
      await safe("tournaments", () =>
        db
          .delete(tournamentsTable)
          .where(inArray(tournamentsTable.id, tournamentIds)),
      );
    }
    // Ranking snapshots are append-only; delete exactly the ids this run added.
    if (newRankingIds.length) {
      await safe("rankings", () =>
        db.delete(rankingsTable).where(inArray(rankingsTable.id, newRankingIds)),
      );
    }
    if (created.userId) {
      await safe("user", () =>
        db.delete(usersTable).where(eq(usersTable.id, created.userId!)),
      );
    }

    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Scoring-scope regression: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Scoring-scope regression: ${failures.length} FAILED, ${passed} passed.`,
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
    console.error("Scoring-scope regression crashed:", err);
    process.exit(1);
  });
