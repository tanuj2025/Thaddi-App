// Centralized scoring rules. Points are NOT hardcoded inside feature code — they
// live here so the engine, rankings, and UI all derive from one rule set.
//
// Tiers (highest applicable wins; tiers never stack — only the single best tier
// is awarded, so an exact prediction is 3, not 3+1, and the most any match can
// give is 3):
//   Exact Score    = 3  (home AND away both match)
//   Correct Winner = 1  (sign of goal difference matches, incl. draws)
//   Otherwise      = 0  (a made-but-wrong prediction, or no prediction)
//
// NOTE: `goal_difference` and `submitted` remain valid `prediction_outcome`
// enum values in the database (legacy scored rows + the made-but-wrong state),
// so the enum is never migrated. The scorer simply never awards a goal-
// difference tier anymore; a made-but-wrong prediction is `submitted`, worth 0.

export type ScoredOutcome =
  | "exact"
  | "winner"
  | "goal_difference"
  | "submitted"
  | "none";

export interface ScoringRules {
  exact: number;
  winner: number;
  none: number;
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  exact: 3,
  winner: 1,
  none: 0,
};

export interface Scoreline {
  home: number;
  away: number;
}

export interface ScoreOutcome {
  outcome: ScoredOutcome;
  points: number;
}

// Pure function: score a single prediction against the final result. The
// highest applicable tier wins and tiers never stack. `none` is returned only
// when there is no prediction (handled by the caller); a made-but-wrong
// prediction yields the `submitted` outcome worth 0 points.
export function scorePrediction(
  prediction: Scoreline,
  actual: Scoreline,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
): ScoreOutcome {
  if (prediction.home === actual.home && prediction.away === actual.away) {
    return { outcome: "exact", points: rules.exact };
  }

  const predSign = Math.sign(prediction.home - prediction.away);
  const actualSign = Math.sign(actual.home - actual.away);
  if (predSign === actualSign) {
    return { outcome: "winner", points: rules.winner };
  }

  return { outcome: "submitted", points: rules.none };
}
