// Resolves the set of matches that belong to a challenge, based on its scope.
// Shared by the scoring engine (which challenges a finished match feeds), the
// match-center (a challenge's fixtures), and prediction validation (is a match
// part of this challenge?).

import { and, eq, or, inArray } from "drizzle-orm";
import {
  db,
  challengesTable,
  challengeMatchesTable,
  matchesTable,
  tournamentsTable,
  type Challenge,
} from "@workspace/db";

// The active World Cup tournament id, used as a fallback when a challenge has no
// explicit tournamentId (templates created without one).
async function activeTournamentId(): Promise<string | null> {
  const t = await db.query.tournamentsTable.findFirst({
    where: eq(tournamentsTable.type, "world_cup"),
  });
  return t?.id ?? null;
}

// Returns the match ids included in a challenge.
export async function matchIdsForChallenge(
  challenge: Challenge,
): Promise<string[]> {
  switch (challenge.scope) {
    case "custom": {
      const rows = await db
        .select({ matchId: challengeMatchesTable.matchId })
        .from(challengeMatchesTable)
        .where(eq(challengeMatchesTable.challengeId, challenge.id));
      return rows.map((r) => r.matchId);
    }
    case "stage": {
      if (!challenge.stageId) return [];
      const rows = await db
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(eq(matchesTable.stageId, challenge.stageId));
      return rows.map((r) => r.id);
    }
    case "team_journey": {
      if (!challenge.teamId) return [];
      const rows = await db
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(
          or(
            eq(matchesTable.homeTeamId, challenge.teamId),
            eq(matchesTable.awayTeamId, challenge.teamId),
          ),
        );
      return rows.map((r) => r.id);
    }
    case "entire_tournament":
    default: {
      const tournamentId =
        challenge.tournamentId ?? (await activeTournamentId());
      if (!tournamentId) return [];
      const rows = await db
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(eq(matchesTable.tournamentId, tournamentId));
      return rows.map((r) => r.id);
    }
  }
}

// Returns the challenges whose scope includes the given match. Used by the
// scoring engine to attribute points to every challenge a prediction counts in.
export async function challengesIncludingMatch(
  matchId: string,
): Promise<Challenge[]> {
  const match = await db.query.matchesTable.findFirst({
    where: eq(matchesTable.id, matchId),
  });
  if (!match) return [];

  const result = new Map<string, Challenge>();

  // entire_tournament challenges on this match's tournament.
  const tournamentChallenges = await db
    .select()
    .from(challengesTable)
    .where(
      and(
        eq(challengesTable.scope, "entire_tournament"),
        eq(challengesTable.tournamentId, match.tournamentId),
      ),
    );
  for (const c of tournamentChallenges) result.set(c.id, c);

  // entire_tournament challenges with no explicit tournament (fallback to active).
  const active = await activeTournamentId();
  if (active && active === match.tournamentId) {
    const fallback = await db
      .select()
      .from(challengesTable)
      .where(eq(challengesTable.scope, "entire_tournament"));
    for (const c of fallback) {
      if (!c.tournamentId) result.set(c.id, c);
    }
  }

  // stage challenges on this match's stage.
  if (match.stageId) {
    const stageChallenges = await db
      .select()
      .from(challengesTable)
      .where(
        and(
          eq(challengesTable.scope, "stage"),
          eq(challengesTable.stageId, match.stageId),
        ),
      );
    for (const c of stageChallenges) result.set(c.id, c);
  }

  // team_journey challenges on either team.
  const teamIds = [match.homeTeamId, match.awayTeamId].filter(
    (x): x is string => Boolean(x),
  );
  if (teamIds.length) {
    const teamChallenges = await db
      .select()
      .from(challengesTable)
      .where(
        and(
          eq(challengesTable.scope, "team_journey"),
          inArray(challengesTable.teamId, teamIds),
        ),
      );
    for (const c of teamChallenges) result.set(c.id, c);
  }

  // custom challenges that explicitly include this match.
  const customRows = await db
    .select({ challengeId: challengeMatchesTable.challengeId })
    .from(challengeMatchesTable)
    .where(eq(challengeMatchesTable.matchId, matchId));
  if (customRows.length) {
    const customChallenges = await db
      .select()
      .from(challengesTable)
      .where(
        inArray(
          challengesTable.id,
          customRows.map((r) => r.challengeId),
        ),
      );
    for (const c of customChallenges) result.set(c.id, c);
  }

  return [...result.values()];
}
