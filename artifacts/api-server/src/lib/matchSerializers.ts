// Serialization helpers shared by the match + challenge match routes. Keep the
// shapes aligned with the OpenAPI MatchSummary / MatchDetail / MyPrediction
// schemas.

import type { Match, Team, Prediction } from "@workspace/db";

export interface TeamRefDto {
  id: string;
  nameEn: string;
  nameAr: string;
  code: string | null;
  flagUrl: string | null;
  countryCode: string | null;
}

export function toTeamRef(team: Team | null | undefined): TeamRefDto | null {
  if (!team) return null;
  return {
    id: team.id,
    nameEn: team.nameEn,
    nameAr: team.nameAr,
    code: team.code ?? null,
    flagUrl: team.flagUrl ?? null,
    countryCode: team.countryCode ?? null,
  };
}

export function toMyPrediction(pred: Prediction | null | undefined) {
  if (!pred) return null;
  return {
    id: pred.id,
    homeScore: pred.homeScore,
    awayScore: pred.awayScore,
    outcome: pred.outcome,
    pointsAwarded: pred.pointsAwarded,
    submittedAt: pred.submittedAt,
    updatedAt: pred.updatedAt,
    scoredAt: pred.scoredAt ?? null,
  };
}

// The authoritative lock boundary: predictionLockAt when present, else kickoff.
export function lockBoundary(match: Match): Date {
  return match.predictionLockAt ?? match.kickoffAt;
}

export function isLocked(match: Match, now: Date = new Date()): boolean {
  return now.getTime() >= lockBoundary(match).getTime();
}

export function hasKickedOff(match: Match, now: Date = new Date()): boolean {
  if (
    match.status === "live" ||
    match.status === "half_time" ||
    match.status === "full_time" ||
    match.status === "finished"
  ) {
    return true;
  }
  return now.getTime() >= match.kickoffAt.getTime();
}

export interface MatchSerializerInput {
  match: Match;
  homeTeam: Team | null;
  awayTeam: Team | null;
  stageType: string | null;
  myPrediction: Prediction | null;
}

export function serializeMatchSummary(
  input: MatchSerializerInput,
  now: Date = new Date(),
) {
  const { match } = input;
  return {
    id: match.id,
    stageType: input.stageType ?? null,
    homeTeam: toTeamRef(input.homeTeam),
    awayTeam: toTeamRef(input.awayTeam),
    kickoffAt: match.kickoffAt,
    predictionLockAt: match.predictionLockAt ?? null,
    status: match.status,
    homeScore: match.homeScore ?? null,
    awayScore: match.awayScore ?? null,
    minute: match.minute ?? null,
    venue: match.venue ?? null,
    isLocked: isLocked(match, now),
    hasKickedOff: hasKickedOff(match, now),
    myPrediction: toMyPrediction(input.myPrediction),
  };
}

export interface ParticipantPredictionDto {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  homeScore: number;
  awayScore: number;
  outcome: string;
  pointsAwarded: number;
}

export function serializeMatchDetail(
  input: MatchSerializerInput,
  opts: {
    revealed: boolean;
    participantPredictions: ParticipantPredictionDto[];
    now?: Date;
  },
) {
  return {
    ...serializeMatchSummary(input, opts.now ?? new Date()),
    revealed: opts.revealed,
    participantPredictions: opts.participantPredictions,
  };
}
