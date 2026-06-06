// Aggregate prediction statistics for a match: outcome trends (percentages),
// popularity comparison (counts + scorelines) and rarity classification.
//
// Privacy rule: trends expose only aggregate percentages of the predicted
// OUTCOME (home win / draw / away win) and never an individual exact score. The
// scoreline-level comparison is only ever served once a match has kicked off
// (the routes enforce this), so it can never leak an unrevealed exact pick.

import { eq } from "drizzle-orm";
import { db, predictionsTable } from "@workspace/db";

export type Rarity = "popular" | "common" | "bold" | "rare";

export type OutcomeKey = "home_win" | "draw" | "away_win";

function outcomeOf(homeScore: number, awayScore: number): OutcomeKey {
  if (homeScore > awayScore) return "home_win";
  if (homeScore < awayScore) return "away_win";
  return "draw";
}

// Classifies a prediction's rarity relative to the whole population for a match.
// Needs a minimum sample to be meaningful; below it everything is "common".
export function classifyRarity(
  sameScoreShare: number,
  sameOutcomeShare: number,
  goalDiff: number,
  total: number,
): Rarity {
  if (total < 5) return "common";
  if (sameScoreShare >= 0.3) return "popular";
  if (sameScoreShare <= 0.08 || sameOutcomeShare <= 0.15) return "rare";
  if (goalDiff >= 3 || sameOutcomeShare <= 0.3) return "bold";
  return "common";
}

interface RawPrediction {
  userId: string;
  homeScore: number;
  awayScore: number;
}

async function loadPredictions(matchId: string): Promise<RawPrediction[]> {
  return db
    .select({
      userId: predictionsTable.userId,
      homeScore: predictionsTable.homeScore,
      awayScore: predictionsTable.awayScore,
    })
    .from(predictionsTable)
    .where(eq(predictionsTable.matchId, matchId));
}

function countDistributions(rows: RawPrediction[]) {
  const total = rows.length;
  const outcomeCounts: Record<OutcomeKey, number> = {
    home_win: 0,
    draw: 0,
    away_win: 0,
  };
  const scoreCounts = new Map<string, number>();
  for (const r of rows) {
    outcomeCounts[outcomeOf(r.homeScore, r.awayScore)] += 1;
    const key = `${r.homeScore}-${r.awayScore}`;
    scoreCounts.set(key, (scoreCounts.get(key) ?? 0) + 1);
  }
  return { total, outcomeCounts, scoreCounts };
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

export interface TrendsResult {
  matchId: string;
  total: number;
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  myRarity: Rarity | null;
}

// Outcome-only percentage split for a match. When a caller's prediction is
// supplied, also returns the rarity of their own pick (an aggregate signal
// about their own choice, never anyone else's exact score).
export async function matchTrends(
  matchId: string,
  myPrediction: { homeScore: number; awayScore: number } | null,
): Promise<TrendsResult> {
  const rows = await loadPredictions(matchId);
  const { total, outcomeCounts, scoreCounts } = countDistributions(rows);

  let myRarity: Rarity | null = null;
  if (myPrediction) {
    const key = `${myPrediction.homeScore}-${myPrediction.awayScore}`;
    const sameScore = scoreCounts.get(key) ?? 0;
    const myOutcome = outcomeOf(myPrediction.homeScore, myPrediction.awayScore);
    const sameOutcome = outcomeCounts[myOutcome];
    const goalDiff = Math.abs(myPrediction.homeScore - myPrediction.awayScore);
    myRarity = classifyRarity(
      total > 0 ? sameScore / total : 0,
      total > 0 ? sameOutcome / total : 0,
      goalDiff,
      total,
    );
  }

  return {
    matchId,
    total,
    homeWinPct: pct(outcomeCounts.home_win, total),
    drawPct: pct(outcomeCounts.draw, total),
    awayWinPct: pct(outcomeCounts.away_win, total),
    myRarity,
  };
}

export interface ComparisonOutcomeResult {
  key: OutcomeKey;
  count: number;
  pct: number;
}

export interface ComparisonScorelineResult {
  homeScore: number;
  awayScore: number;
  count: number;
  pct: number;
  rarity: Rarity;
}

export interface ComparisonResult {
  matchId: string;
  total: number;
  outcomes: ComparisonOutcomeResult[];
  scorelines: ComparisonScorelineResult[];
}

// Popular outcomes + scorelines for a match, each scoreline tagged with its
// rarity. Callers must gate this to matches that have kicked off.
export async function matchComparison(
  matchId: string,
  limit = 6,
): Promise<ComparisonResult> {
  const rows = await loadPredictions(matchId);
  const { total, outcomeCounts, scoreCounts } = countDistributions(rows);

  const outcomes: ComparisonOutcomeResult[] = (
    ["home_win", "draw", "away_win"] as OutcomeKey[]
  ).map((key) => ({
    key,
    count: outcomeCounts[key],
    pct: pct(outcomeCounts[key], total),
  }));

  const scorelines: ComparisonScorelineResult[] = [...scoreCounts.entries()]
    .map(([key, count]) => {
      const [homeScore, awayScore] = key.split("-").map((n) => Number(n));
      const outcome = outcomeOf(homeScore, awayScore);
      const rarity = classifyRarity(
        total > 0 ? count / total : 0,
        total > 0 ? outcomeCounts[outcome] / total : 0,
        Math.abs(homeScore - awayScore),
        total,
      );
      return { homeScore, awayScore, count, pct: pct(count, total), rarity };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  return { matchId, total, outcomes, scorelines };
}
