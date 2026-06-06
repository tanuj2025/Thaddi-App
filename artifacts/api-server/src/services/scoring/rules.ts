// Centralized, configurable scoring rules. Points are NOT hardcoded inside
// feature code — they live here so the rule set can be tuned or swapped (e.g.
// per-tournament) without touching the engine or routes.
//
// Tiers (highest applicable wins):
//   Exact Score          = 100
//   Correct Winner       =  50  (sign of goal difference matches, incl. draws)
//   Correct Goal Diff    =  30  (absolute margin matches but winner does not)
//   Prediction Submitted =  10  (predicted, none of the above)
//   No Prediction        =   0

export type ScoredOutcome =
  | "exact"
  | "winner"
  | "goal_difference"
  | "submitted"
  | "none";

export interface ScoringRules {
  exact: number;
  winner: number;
  goalDifference: number;
  submitted: number;
  none: number;
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  exact: 100,
  winner: 50,
  goalDifference: 30,
  submitted: 10,
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
// highest applicable tier wins. `none` is returned only when there is no
// prediction (handled by the caller); a submitted-but-wrong prediction yields
// the `submitted` tier.
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

  const predMargin = Math.abs(prediction.home - prediction.away);
  const actualMargin = Math.abs(actual.home - actual.away);
  if (predMargin === actualMargin) {
    return { outcome: "goal_difference", points: rules.goalDifference };
  }

  return { outcome: "submitted", points: rules.submitted };
}
