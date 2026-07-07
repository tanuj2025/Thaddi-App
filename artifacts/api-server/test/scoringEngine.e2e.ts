/**
 * Scoring-engine regression test.
 *
 * Closes the gap left open by `adminSync.e2e.ts`, which exercises the admin
 * sync action with mock fixtures that have NO predictions — so the actual
 * scoring math (the core value of the platform) had zero automated coverage.
 *
 * This test seeds, in-process and directly against the dev DB:
 *   - a self-contained tournament + stage + two teams,
 *   - a single FINISHED match with a known final score (home 2 - away 1),
 *   - a CUSTOM-scope challenge that explicitly includes that match,
 *   - five active participants whose predictions deliberately land on each
 *     possible outcome under the 3 / 1 / 0 model: Exact (3), Correct Winner
 *     (1), a goal-difference-only miss (now 0, outcome "submitted"), a fully
 *     wrong submitted prediction (0), and No Prediction (0).
 *
 * It then calls the engine directly (`applyScoringForMatch`) and asserts:
 *   1. Each prediction's stored outcome + pointsAwarded match the rule set.
 *   2. The points_ledger has exactly the right rows (one per scored prediction,
 *      none for the no-prediction participant) with the correct points/reason.
 *   3. Participant aggregates (points / exactPredictions / totalPredictions)
 *      recompute correctly, including the no-prediction participant staying 0.
 *   4. Re-running scoring is idempotent: predictions, ledger rows and aggregates
 *      are identical (no double counting).
 *   5. A rank-movement snapshot is written — challenge + global scope rows are
 *      appended each run, and the second run's snapshot carries a non-null
 *      previousRank derived from the first run.
 *
 * Every seeded row is reverted afterward (ledger/predictions/participants
 * cascade from the challenge + match; ranking snapshots are removed by id-diff),
 * leaving the dev DB exactly as found.
 *
 * Uses the scoring engine directly rather than the HTTP API, so it needs no
 * Clerk session — local user rows use synthetic clerk_user_id strings.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
  challengeMatchesTable,
  predictionsTable,
  pointsLedgerTable,
  rankingsTable,
} from "@workspace/db";
import { applyScoringForMatch } from "../src/services/scoring/engine";
import { DEFAULT_SCORING_RULES } from "../src/services/scoring/rules";

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

  // Known final result: home 2 - 1 away (home win, margin 1).
  const ACTUAL = { home: 2, away: 1 };

  // Each participant's prediction is engineered to hit exactly one tier.
  // tier names map to DEFAULT_SCORING_RULES.
  const PLAN = [
    // Exact scoreline.
    { label: "exact", home: 2, away: 1, outcome: "exact", points: 3, exact: 1 },
    // Correct winner (home win) but not exact, margins differ (2 vs 1).
    { label: "winner", home: 3, away: 1, outcome: "winner", points: 1, exact: 0 },
    // Wrong winner (predicts away win) but same absolute margin (1 == 1).
    // The goal-difference tier was removed, so this now earns 0 as a plain
    // submitted-but-wrong prediction.
    {
      label: "goaldiff",
      home: 1,
      away: 2,
      outcome: "submitted",
      points: 0,
      exact: 0,
    },
    // Submitted but wrong winner AND wrong margin (away win, margin 3).
    {
      label: "submitted",
      home: 0,
      away: 3,
      outcome: "submitted",
      points: 0,
      exact: 0,
    },
    // No prediction at all -> 0 points, no ledger row.
    {
      label: "none",
      home: null as number | null,
      away: null as number | null,
      outcome: "none",
      points: 0,
      exact: 0,
    },
  ];

  const created: {
    userIds: string[];
    tournamentId?: string;
    stageId?: string;
    teamIds: string[];
    matchId?: string;
    challengeId?: string;
  } = { userIds: [], teamIds: [] };

  // Captured before any scoring so teardown can delete exactly the snapshot rows
  // both scoring runs appended (challenge + global scope, including rows written
  // for any pre-existing global users).
  let preRankingIds = new Set<string>();
  let newRankingIds: string[] = [];

  // Map of label -> userId for assertions.
  const userByLabel = new Map<string, string>();

  try {
    // --- Seed participants (local rows only; synthetic clerk ids) ---
    for (const p of PLAN) {
      const [row] = await db
        .insert(usersTable)
        .values({
          clerkUserId: `scoring-e2e-${p.label}-${stamp}`,
          email: `thaddi-scoring-e2e-${p.label}-${stamp}@example.com`,
          emailVerified: true,
          status: "active",
        })
        .returning();
      created.userIds.push(row.id);
      userByLabel.set(p.label, row.id);
    }

    // --- Self-contained football fixtures ---
    const [tournament] = await db
      .insert(tournamentsTable)
      .values({
        slug: `scoring-e2e-${stamp}`,
        nameEn: "Scoring E2E Tournament",
        nameAr: "بطولة اختبار التهديف",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentId = tournament.id;

    const [stage] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournament.id,
        nameEn: "Scoring E2E Stage",
        nameAr: "مرحلة اختبار",
        type: "group",
        orderIndex: 0,
      })
      .returning();
    created.stageId = stage.id;

    const [home] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Scoring E2E Home",
        nameAr: "فريق المضيف",
        externalId: `scoring-e2e-home-${stamp}`,
      })
      .returning();
    const [away] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Scoring E2E Away",
        nameAr: "فريق الضيف",
        externalId: `scoring-e2e-away-${stamp}`,
      })
      .returning();
    created.teamIds.push(home.id, away.id);

    // A finished match with the known final score.
    const [match] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoffAt: new Date(Date.now() - 3 * hourMs),
        status: "finished",
        homeScore: ACTUAL.home,
        awayScore: ACTUAL.away,
        externalId: `scoring-e2e-match-${stamp}`,
        venue: "E2E Stadium",
      })
      .returning();
    created.matchId = match.id;

    // Custom-scope challenge that explicitly includes the match.
    const [challenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: userByLabel.get("exact")!,
        name: `E2E Scoring Challenge ${stamp}`,
        type: "friends",
        visibility: "public",
        scope: "custom",
        status: "active",
      })
      .returning();
    created.challengeId = challenge.id;
    await db
      .insert(challengeMatchesTable)
      .values({ challengeId: challenge.id, matchId: match.id });

    // Every planned user is an active participant.
    await db.insert(challengeParticipantsTable).values(
      PLAN.map((p) => ({
        challengeId: challenge.id,
        userId: userByLabel.get(p.label)!,
        status: "active" as const,
      })),
    );

    // Predictions for everyone EXCEPT the no-prediction participant.
    await db.insert(predictionsTable).values(
      PLAN.filter((p) => p.home !== null && p.away !== null).map((p) => ({
        userId: userByLabel.get(p.label)!,
        matchId: match.id,
        homeScore: p.home as number,
        awayScore: p.away as number,
      })),
    );

    // Sanity: predictions start unscored.
    const preScore = await db
      .select()
      .from(predictionsTable)
      .where(eq(predictionsTable.matchId, match.id));
    check(
      "predictions start unscored (outcome=pending, scoredAt=null)",
      preScore.length === 4 &&
        preScore.every((p) => p.outcome === "pending" && p.scoredAt === null),
      `count=${preScore.length}`,
    );

    // ===================================================================
    // Run scoring (first pass).
    // ===================================================================
    console.log("\nScoring run #1:");
    preRankingIds = await rankingIdSet();

    const r1 = await applyScoringForMatch(match.id);
    check("scoring reports scored=true", r1.scored === true, JSON.stringify(r1));
    check(
      "scoring scored 4 predictions",
      r1.predictionsScored === 4,
      `predictionsScored=${r1.predictionsScored}`,
    );
    check(
      "scoring touched the one challenge",
      r1.challengesAffected === 1 &&
        r1.affectedChallengeIds.includes(challenge.id),
      `challengesAffected=${r1.challengesAffected}`,
    );

    // --- Per-prediction outcome + points ---
    console.log("\nPer-prediction outcome + points:");
    const scored = await db
      .select()
      .from(predictionsTable)
      .where(eq(predictionsTable.matchId, match.id));
    const scoredByUser = new Map(scored.map((p) => [p.userId, p]));
    for (const p of PLAN) {
      if (p.home === null) continue;
      const row = scoredByUser.get(userByLabel.get(p.label)!);
      check(
        `${p.label}: outcome=${p.outcome}, points=${p.points}, scoredAt set`,
        Boolean(row) &&
          row!.outcome === p.outcome &&
          row!.pointsAwarded === p.points &&
          row!.scoredAt !== null,
        `got outcome=${row?.outcome} points=${row?.pointsAwarded} scoredAt=${row?.scoredAt}`,
      );
    }

    // --- points_ledger rows ---
    console.log("\nPoints ledger:");
    const ledger = await db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.challengeId, challenge.id));
    check(
      "ledger has one row per scored prediction (4), none for no-prediction user",
      ledger.length === 4,
      `rows=${ledger.length}`,
    );
    const ledgerByUser = new Map(ledger.map((l) => [l.userId, l]));
    check(
      "no-prediction participant has no ledger row",
      !ledgerByUser.has(userByLabel.get("none")!),
    );
    for (const p of PLAN) {
      if (p.home === null) continue;
      const l = ledgerByUser.get(userByLabel.get(p.label)!);
      check(
        `${p.label}: ledger points=${p.points}, reason=${p.outcome}`,
        Boolean(l) && l!.points === p.points && l!.reason === p.outcome,
        `got points=${l?.points} reason=${l?.reason}`,
      );
    }

    // --- Participant aggregates ---
    console.log("\nParticipant aggregates:");
    const aggregate = async (userId: string) => {
      const [row] = await db
        .select()
        .from(challengeParticipantsTable)
        .where(
          and(
            eq(challengeParticipantsTable.challengeId, challenge.id),
            eq(challengeParticipantsTable.userId, userId),
          ),
        );
      return row;
    };
    for (const p of PLAN) {
      const agg = await aggregate(userByLabel.get(p.label)!);
      const expectedTotal = p.home === null ? 0 : 1;
      check(
        `${p.label}: points=${p.points}, exact=${p.exact}, total=${expectedTotal}`,
        Boolean(agg) &&
          agg.points === p.points &&
          agg.exactPredictions === p.exact &&
          agg.totalPredictions === expectedTotal,
        `got points=${agg?.points} exact=${agg?.exactPredictions} total=${agg?.totalPredictions}`,
      );
    }

    // --- Rank-movement snapshot (first generation) ---
    console.log("\nRanking snapshot (generation 1):");
    const snap1 = await db
      .select()
      .from(rankingsTable)
      .where(
        and(
          eq(rankingsTable.scope, "challenge"),
          eq(rankingsTable.challengeId, challenge.id),
        ),
      );
    check(
      "challenge snapshot written for all 5 participants",
      snap1.length === 5,
      `rows=${snap1.length}`,
    );
    const snap1ByUser = new Map(snap1.map((s) => [s.userId, s]));
    // Standard competition ranking shares a rank for equal POINTS (the
    // exact-then-total tie-break only orders display, it does not split the
    // rank number). Under the 3 / 1 / 0 model the goaldiff, submitted, and
    // no-prediction participants all score 0, so they tie at rank 3.
    const expectedRank: Record<string, number> = {
      exact: 1,
      winner: 2,
      goaldiff: 3,
      submitted: 3,
      none: 3,
    };
    for (const p of PLAN) {
      const s = snap1ByUser.get(userByLabel.get(p.label)!);
      check(
        `${p.label}: snapshot rank=${expectedRank[p.label]}, previousRank=null, points=${p.points}`,
        Boolean(s) &&
          s!.rank === expectedRank[p.label] &&
          s!.previousRank === null &&
          s!.points === p.points,
        `got rank=${s?.rank} prev=${s?.previousRank} points=${s?.points}`,
      );
    }
    const globalSnap1 = await db
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.scope, "global"));
    check(
      "global snapshot includes our scored users",
      PLAN.filter((p) => p.home !== null).every((p) =>
        globalSnap1.some((s) => s.userId === userByLabel.get(p.label)),
      ),
    );

    // ===================================================================
    // Run scoring (second pass) — idempotency + rank-movement snapshot.
    // ===================================================================
    console.log("\nScoring run #2 (idempotency):");
    const r2 = await applyScoringForMatch(match.id);
    check("re-run reports scored=true", r2.scored === true, JSON.stringify(r2));

    const ledger2 = await db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.challengeId, challenge.id));
    check(
      "re-run did not duplicate ledger rows (still 4)",
      ledger2.length === 4,
      `rows=${ledger2.length}`,
    );

    let aggregatesStable = true;
    for (const p of PLAN) {
      const agg = await aggregate(userByLabel.get(p.label)!);
      const expectedTotal = p.home === null ? 0 : 1;
      if (
        !agg ||
        agg.points !== p.points ||
        agg.exactPredictions !== p.exact ||
        agg.totalPredictions !== expectedTotal
      ) {
        aggregatesStable = false;
      }
    }
    check("re-run kept participant aggregates unchanged", aggregatesStable);

    // Second snapshot generation: a NEW row per participant whose previousRank
    // now carries the rank from generation 1 (proves rank-movement tracking).
    console.log("\nRanking snapshot (generation 2 — movement tracking):");
    const allChallengeSnaps = await db
      .select()
      .from(rankingsTable)
      .where(
        and(
          eq(rankingsTable.scope, "challenge"),
          eq(rankingsTable.challengeId, challenge.id),
        ),
      );
    check(
      "second run appended a new challenge snapshot generation (10 rows total)",
      allChallengeSnaps.length === 10,
      `rows=${allChallengeSnaps.length}`,
    );
    // Latest row per user = generation 2.
    const latestByUser = new Map<string, (typeof allChallengeSnaps)[number]>();
    for (const s of allChallengeSnaps) {
      const prev = latestByUser.get(s.userId);
      if (!prev || s.computedAt.getTime() > prev.computedAt.getTime()) {
        latestByUser.set(s.userId, s);
      }
    }
    let movementTracked = true;
    for (const p of PLAN) {
      const s = latestByUser.get(userByLabel.get(p.label)!);
      // Unchanged scores => rank stable, but previousRank must now be populated
      // from generation 1 (i.e. equal to the same rank).
      if (
        !s ||
        s.rank !== expectedRank[p.label] ||
        s.previousRank !== expectedRank[p.label]
      ) {
        movementTracked = false;
      }
    }
    check(
      "generation-2 snapshot carries previousRank from generation 1",
      movementTracked,
    );

    // Sanity: rules constants are the source of truth, not magic numbers.
    check(
      "DEFAULT_SCORING_RULES match the asserted tiers",
      DEFAULT_SCORING_RULES.exact === 3 &&
        DEFAULT_SCORING_RULES.winner === 1 &&
        DEFAULT_SCORING_RULES.none === 0,
      JSON.stringify(DEFAULT_SCORING_RULES),
    );

    // ===================================================================
    // Watermark contract (incremental scorer selection).
    //
    // The hot path scores via applyScoringForPendingMatches(), which selects
    // final matches whose watermark is missing or DISTINCT FROM the live score.
    // We assert the contract on OUR match only (a scoped mirror of the engine's
    // predicate) so the test never re-scores unrelated dev rows.
    // ===================================================================
    console.log("\nWatermark contract:");

    // The engine's pending predicate, scoped to our match id (mirrors
    // applyScoringForPendingMatches' WHERE so we validate the exact contract).
    const pendingOurMatch = async () =>
      db
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(
          and(
            eq(matchesTable.id, created.matchId!),
            inArray(matchesTable.status, ["finished", "full_time"]),
            sql`${matchesTable.homeScore} is not null`,
            sql`${matchesTable.awayScore} is not null`,
            or(
              isNull(matchesTable.scoredAt),
              sql`${matchesTable.scoredHomeScore} is distinct from ${matchesTable.homeScore}`,
              sql`${matchesTable.scoredAwayScore} is distinct from ${matchesTable.awayScore}`,
            ),
          ),
        );

    const [wmMatch] = await db
      .select()
      .from(matchesTable)
      .where(eq(matchesTable.id, created.matchId!));
    check(
      "run #1 stamped the scoring watermark to the scored result",
      Boolean(wmMatch) &&
        wmMatch.scoredAt !== null &&
        wmMatch.scoredHomeScore === ACTUAL.home &&
        wmMatch.scoredAwayScore === ACTUAL.away,
      `scoredAt=${wmMatch?.scoredAt} h=${wmMatch?.scoredHomeScore} a=${wmMatch?.scoredAwayScore}`,
    );

    const stillPending = await pendingOurMatch();
    check(
      "a freshly-scored match is NOT re-selected by the incremental scorer",
      stillPending.length === 0,
      `pending=${stillPending.length}`,
    );

    // --- Post-final score correction: 2-1 -> 3-1 ---
    // exact(2-1) becomes a plain winner; winner(3-1) becomes the new exact.
    console.log("\nScore correction re-scores via the watermark:");
    const CORRECTED = { home: 3, away: 1 };
    await db
      .update(matchesTable)
      .set({ homeScore: CORRECTED.home, awayScore: CORRECTED.away })
      .where(eq(matchesTable.id, created.matchId!));

    const nowPending = await pendingOurMatch();
    check(
      "a corrected score re-selects the match (watermark distinct from live score)",
      nowPending.length === 1,
      `pending=${nowPending.length}`,
    );

    const r3 = await applyScoringForMatch(created.matchId!);
    check("correction re-score reports scored=true", r3.scored === true);

    const rescored = await db
      .select()
      .from(predictionsTable)
      .where(eq(predictionsTable.matchId, created.matchId!));
    const rescoredByUser = new Map(rescored.map((p) => [p.userId, p]));
    const exactRow = rescoredByUser.get(userByLabel.get("exact")!);
    const winnerRow = rescoredByUser.get(userByLabel.get("winner")!);
    check(
      "correction: former exact(2-1) is now a winner (1pt)",
      exactRow?.outcome === "winner" && exactRow?.pointsAwarded === 1,
      `got outcome=${exactRow?.outcome} points=${exactRow?.pointsAwarded}`,
    );
    check(
      "correction: former winner(3-1) is now exact (3pts)",
      winnerRow?.outcome === "exact" && winnerRow?.pointsAwarded === 3,
      `got outcome=${winnerRow?.outcome} points=${winnerRow?.pointsAwarded}`,
    );

    const ledger3 = await db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.challengeId, challenge.id));
    check(
      "correction re-score did not duplicate ledger rows (still 4)",
      ledger3.length === 4,
      `rows=${ledger3.length}`,
    );

    const [wm2] = await db
      .select()
      .from(matchesTable)
      .where(eq(matchesTable.id, created.matchId!));
    check(
      "watermark advanced to the corrected score",
      wm2?.scoredHomeScore === CORRECTED.home &&
        wm2?.scoredAwayScore === CORRECTED.away,
      `h=${wm2?.scoredHomeScore} a=${wm2?.scoredAwayScore}`,
    );
    const afterCorrection = await pendingOurMatch();
    check(
      "match is no longer pending after the correction is scored",
      afterCorrection.length === 0,
      `pending=${afterCorrection.length}`,
    );
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

    // Challenge cascades to participants, challenge_matches, ledger and
    // challenge-scope rankings.
    if (created.challengeId) {
      await safe("challenge", () =>
        db
          .delete(challengesTable)
          .where(eq(challengesTable.id, created.challengeId!)),
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
    if (created.stageId) {
      await safe("stage", () =>
        db.delete(stagesTable).where(eq(stagesTable.id, created.stageId!)),
      );
    }
    if (created.tournamentId) {
      await safe("tournament", () =>
        db
          .delete(tournamentsTable)
          .where(eq(tournamentsTable.id, created.tournamentId!)),
      );
    }
    // Ranking snapshots are append-only; delete exactly the ids both runs added
    // (covers global-scope rows written for pre-existing users too).
    if (newRankingIds.length) {
      await safe("rankings", () =>
        db.delete(rankingsTable).where(inArray(rankingsTable.id, newRankingIds)),
      );
    }
    if (created.userIds.length) {
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, created.userIds)),
      );
    }

    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Scoring-engine regression: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Scoring-engine regression: ${failures.length} FAILED, ${passed} passed.`,
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
    console.error("Scoring-engine regression crashed:", err);
    process.exit(1);
  });
