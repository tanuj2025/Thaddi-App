// Ranking computation + snapshots for the competition experience.
//
// Standings are derived live from the points ledger / participant aggregates
// (challenge scope) and from scored predictions (global scope). To show rank
// MOVEMENT we additionally write a snapshot of the standings into the rankings
// table after every scoring run; the read paths join the latest snapshot to
// report how far each user moved in the most recent run.
//
// Winning probability and ranking impact are deterministic heuristics layered
// on top of the same standings, so the numbers are stable and explainable.

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  challengesTable,
  challengeParticipantsTable,
  pointsLedgerTable,
  predictionsTable,
  profilesTable,
  usersTable,
  teamsTable,
  matchesTable,
  tournamentsTable,
  rankingsTable,
  type Challenge,
  type Tournament,
} from "@workspace/db";
import { matchIdsForChallenge } from "../../lib/challengeMatches";
import { resolveCompetitionTournament } from "../football/competitions";
import {
  scorePrediction,
  DEFAULT_SCORING_RULES,
  type ScoringRules,
} from "./rules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbClient = typeof db | Tx;

export interface RankingEntryData {
  userId: string;
  rank: number;
  previousRank: number | null;
  rankMovement: number;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  favoriteTeam: { id: string; nameEn: string; nameAr: string; flagUrl: string | null } | null;
  points: number;
  accuracy: number | null;
  exactPredictions: number;
  correctPredictions: number;
  totalPredictions: number;
  isCurrentUser: boolean;
}

export interface RankingData {
  scope: "challenge" | "global";
  challengeId: string | null;
  participantCount: number;
  entries: RankingEntryData[];
  me: RankingEntryData | null;
}

interface Standing {
  userId: string;
  points: number;
  exact: number;
  correct: number;
  total: number;
  rank: number;
}

// Standard competition ranking: equal points share a rank. Ordering is stable
// via exact-then-total tie-breaks so the displayed order is deterministic.
function assignRanks(
  rows: Omit<Standing, "rank">[],
): Standing[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points || b.exact - a.exact || b.total - a.total,
  );
  let lastPoints: number | null = null;
  let lastRank = 0;
  return sorted.map((row, i) => {
    let rank: number;
    if (lastPoints !== null && row.points === lastPoints) {
      rank = lastRank;
    } else {
      rank = i + 1;
      lastRank = rank;
      lastPoints = row.points;
    }
    return { ...row, rank };
  });
}

function accuracyOf(correct: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((correct / total) * 1000) / 1000;
}

// ---------- standings builders ----------

async function challengeStandings(
  c: DbClient,
  challengeId: string,
): Promise<Standing[]> {
  const parts = await c
    .select({
      userId: challengeParticipantsTable.userId,
      points: challengeParticipantsTable.points,
      exact: challengeParticipantsTable.exactPredictions,
      total: challengeParticipantsTable.totalPredictions,
    })
    .from(challengeParticipantsTable)
    .where(
      and(
        eq(challengeParticipantsTable.challengeId, challengeId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    );

  const correctRows = await c
    .select({
      userId: pointsLedgerTable.userId,
      correct: sql<number>`cast(count(*) filter (where ${pointsLedgerTable.reason} in ('exact','winner')) as int)`,
    })
    .from(pointsLedgerTable)
    .where(eq(pointsLedgerTable.challengeId, challengeId))
    .groupBy(pointsLedgerTable.userId);
  const correctMap = new Map(correctRows.map((r) => [r.userId, r.correct]));

  return assignRanks(
    parts.map((p) => ({
      userId: p.userId,
      points: p.points,
      exact: p.exact,
      total: p.total,
      correct: correctMap.get(p.userId) ?? 0,
    })),
  );
}

async function globalStandings(c: DbClient): Promise<Standing[]> {
  const rows = await c
    .select({
      userId: predictionsTable.userId,
      points: sql<number>`cast(coalesce(sum(${predictionsTable.pointsAwarded}),0) as int)`,
      total: sql<number>`cast(count(*) as int)`,
      exact: sql<number>`cast(count(*) filter (where ${predictionsTable.outcome} = 'exact') as int)`,
      correct: sql<number>`cast(count(*) filter (where ${predictionsTable.outcome} in ('exact','winner')) as int)`,
    })
    .from(predictionsTable)
    .where(sql`${predictionsTable.scoredAt} is not null`)
    .groupBy(predictionsTable.userId);

  return assignRanks(
    rows.map((r) => ({
      userId: r.userId,
      points: r.points,
      exact: r.exact,
      total: r.total,
      correct: r.correct,
    })),
  );
}

// Standings for a single competition-season: the same scored-prediction
// aggregate as the global board, but constrained to the matches belonging to one
// tournament row (one competition-season). Routing by tournamentId keeps each
// competition's leaderboard fully isolated.
async function competitionStandings(
  c: DbClient,
  tournamentId: string,
): Promise<Standing[]> {
  const rows = await c
    .select({
      userId: predictionsTable.userId,
      points: sql<number>`cast(coalesce(sum(${predictionsTable.pointsAwarded}),0) as int)`,
      total: sql<number>`cast(count(*) as int)`,
      exact: sql<number>`cast(count(*) filter (where ${predictionsTable.outcome} = 'exact') as int)`,
      correct: sql<number>`cast(count(*) filter (where ${predictionsTable.outcome} in ('exact','winner')) as int)`,
    })
    .from(predictionsTable)
    .innerJoin(matchesTable, eq(predictionsTable.matchId, matchesTable.id))
    .where(
      and(
        eq(matchesTable.tournamentId, tournamentId),
        sql`${predictionsTable.scoredAt} is not null`,
      ),
    )
    .groupBy(predictionsTable.userId);

  return assignRanks(
    rows.map((r) => ({
      userId: r.userId,
      points: r.points,
      exact: r.exact,
      total: r.total,
      correct: r.correct,
    })),
  );
}

// Latest snapshot row per user for a scope, used to derive rank movement.
async function latestSnapshots(
  scope: "challenge" | "global",
  challengeId: string | null,
): Promise<Map<string, { rank: number; previousRank: number | null }>> {
  const rows = await db
    .select({
      userId: rankingsTable.userId,
      rank: rankingsTable.rank,
      previousRank: rankingsTable.previousRank,
      computedAt: rankingsTable.computedAt,
    })
    .from(rankingsTable)
    .where(
      challengeId
        ? and(
            eq(rankingsTable.scope, scope),
            eq(rankingsTable.challengeId, challengeId),
          )
        : eq(rankingsTable.scope, scope),
    );
  const map = new Map<
    string,
    { rank: number; previousRank: number | null; computedAt: Date }
  >();
  for (const r of rows) {
    const prev = map.get(r.userId);
    if (!prev || r.computedAt.getTime() > prev.computedAt.getTime()) {
      map.set(r.userId, {
        rank: r.rank,
        previousRank: r.previousRank,
        computedAt: r.computedAt,
      });
    }
  }
  return new Map(
    [...map.entries()].map(([k, v]) => [
      k,
      { rank: v.rank, previousRank: v.previousRank },
    ]),
  );
}

async function profilesFor(userIds: string[]) {
  const map = new Map<
    string,
    {
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
      favoriteTeam: { id: string; nameEn: string; nameAr: string; flagUrl: string | null } | null;
    }
  >();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      userId: profilesTable.userId,
      displayName: profilesTable.displayName,
      username: profilesTable.username,
      avatarUrl: profilesTable.avatarUrl,
      favoriteTeamId: usersTable.favoriteTeamId,
      teamId: teamsTable.id,
      teamNameEn: teamsTable.nameEn,
      teamNameAr: teamsTable.nameAr,
      teamFlagUrl: teamsTable.flagUrl,
    })
    .from(profilesTable)
    .innerJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .leftJoin(teamsTable, eq(usersTable.favoriteTeamId, teamsTable.id))
    .where(inArray(profilesTable.userId, userIds));
  for (const r of rows) {
    map.set(r.userId, {
      displayName: r.displayName ?? null,
      username: r.username ?? null,
      avatarUrl: r.avatarUrl ?? null,
      favoriteTeam: r.teamId
        ? { id: r.teamId, nameEn: r.teamNameEn!, nameAr: r.teamNameAr!, flagUrl: r.teamFlagUrl ?? null }
        : null,
    });
  }
  return map;
}

function toEntry(
  s: Standing,
  profile:
    | {
        displayName: string | null;
        username: string | null;
        avatarUrl: string | null;
        favoriteTeam: { id: string; nameEn: string; nameAr: string; flagUrl: string | null } | null;
      }
    | undefined,
  snapshot: { rank: number; previousRank: number | null } | undefined,
  currentUserId: string | null,
): RankingEntryData {
  const previousRank = snapshot?.previousRank ?? null;
  const rankMovement = previousRank !== null ? previousRank - s.rank : 0;
  return {
    userId: s.userId,
    rank: s.rank,
    previousRank,
    rankMovement,
    displayName: profile?.displayName ?? null,
    username: profile?.username ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    favoriteTeam: profile?.favoriteTeam ?? null,
    points: s.points,
    accuracy: accuracyOf(s.correct, s.total),
    exactPredictions: s.exact,
    correctPredictions: s.correct,
    totalPredictions: s.total,
    isCurrentUser: currentUserId !== null && s.userId === currentUserId,
  };
}

// ---------- top players (Hall of Fame leaderboard) ----------

export interface TopPlayerEntryData {
  userId: string;
  rank: number;
  rankMovement: number;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  favoriteTeam: { id: string; nameEn: string; nameAr: string; flagUrl: string | null } | null;
  points: number;
  accuracy: number | null;
  exactPredictions: number;
  totalPredictions: number;
  challenges: { id: string; name: string }[];
  isCurrentUser: boolean;
}

export interface TopPlayersData {
  entries: TopPlayerEntryData[];
  me: TopPlayerEntryData | null;
}

// The challenge(s) each player takes part in — as owner or active participant.
// Visibility is enforced against the VIEWER: public/unlisted challenges are
// shown to anyone (mirrors canViewChallenge), but a PRIVATE challenge is only
// included when the viewer owns it or is an active participant of that specific
// challenge — otherwise the public Hall of Fame would leak private challenge
// names/IDs and their member associations.
export async function challengesForUsers(
  userIds: string[],
  viewerId: string | null,
): Promise<Map<string, { id: string; name: string }[]>> {
  const map = new Map<string, { id: string; name: string }[]>();
  if (userIds.length === 0) return map;

  // Private challenges the viewer is allowed to see (owner or active member).
  const viewerAccess = new Set<string>();
  if (viewerId) {
    const ownedByViewer = await db
      .select({ id: challengesTable.id })
      .from(challengesTable)
      .where(eq(challengesTable.ownerId, viewerId));
    for (const r of ownedByViewer) viewerAccess.add(r.id);
    const joinedByViewer = await db
      .select({ id: challengeParticipantsTable.challengeId })
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.userId, viewerId),
          eq(challengeParticipantsTable.status, "active"),
        ),
      );
    for (const r of joinedByViewer) viewerAccess.add(r.id);
  }

  const canSee = (c: { id: string; visibility: string }) =>
    c.visibility === "public" ||
    c.visibility === "unlisted" ||
    viewerAccess.has(c.id);

  const add = (
    userId: string,
    c: { id: string; name: string; visibility: string },
  ) => {
    if (!canSee(c)) return;
    const list = map.get(userId) ?? [];
    if (!list.some((x) => x.id === c.id)) list.push({ id: c.id, name: c.name });
    map.set(userId, list);
  };
  const owned = await db
    .select({
      userId: challengesTable.ownerId,
      id: challengesTable.id,
      name: challengesTable.name,
      visibility: challengesTable.visibility,
    })
    .from(challengesTable)
    .where(inArray(challengesTable.ownerId, userIds));
  for (const r of owned)
    add(r.userId, { id: r.id, name: r.name, visibility: r.visibility });

  const joined = await db
    .select({
      userId: challengeParticipantsTable.userId,
      id: challengesTable.id,
      name: challengesTable.name,
      visibility: challengesTable.visibility,
    })
    .from(challengeParticipantsTable)
    .innerJoin(
      challengesTable,
      eq(challengeParticipantsTable.challengeId, challengesTable.id),
    )
    .where(
      and(
        inArray(challengeParticipantsTable.userId, userIds),
        eq(challengeParticipantsTable.status, "active"),
      ),
    );
  for (const r of joined)
    add(r.userId, { id: r.id, name: r.name, visibility: r.visibility });
  return map;
}

// Global Top-N players, ranked by total points across every scored prediction.
// Returned with each player's favourite team and the challenge(s) they play in.
// Recomputed live, so it tracks scoring as matches finish.
export async function computeTopPlayers(
  currentUserId: string | null,
  limit = 10,
): Promise<TopPlayersData> {
  const standings = await globalStandings(db);
  const top = standings.slice(0, limit);
  const userIds = top.map((s) => s.userId);
  const profiles = await profilesFor(userIds);
  const snapshots = await latestSnapshots("global", null);
  const challenges = await challengesForUsers(userIds, currentUserId);

  const entries: TopPlayerEntryData[] = top.map((s) => {
    const profile = profiles.get(s.userId);
    const snapshot = snapshots.get(s.userId);
    const previousRank = snapshot?.previousRank ?? null;
    return {
      userId: s.userId,
      rank: s.rank,
      rankMovement: previousRank !== null ? previousRank - s.rank : 0,
      displayName: profile?.displayName ?? null,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      favoriteTeam: profile?.favoriteTeam ?? null,
      points: s.points,
      accuracy: accuracyOf(s.correct, s.total),
      exactPredictions: s.exact,
      totalPredictions: s.total,
      challenges: challenges.get(s.userId) ?? [],
      isCurrentUser: currentUserId !== null && s.userId === currentUserId,
    };
  });

  return { entries, me: entries.find((e) => e.isCurrentUser) ?? null };
}

// ---------- public reads ----------

export async function computeChallengeRanking(
  challengeId: string,
  currentUserId: string | null,
): Promise<RankingData> {
  const standings = await challengeStandings(db, challengeId);
  const profiles = await profilesFor(standings.map((s) => s.userId));
  const snapshots = await latestSnapshots("challenge", challengeId);
  const entries = standings.map((s) =>
    toEntry(s, profiles.get(s.userId), snapshots.get(s.userId), currentUserId),
  );
  return {
    scope: "challenge",
    challengeId,
    participantCount: entries.length,
    entries,
    me: entries.find((e) => e.isCurrentUser) ?? null,
  };
}

export async function computeGlobalRanking(
  currentUserId: string | null,
  limit = 100,
): Promise<RankingData> {
  const standings = await globalStandings(db);
  const profiles = await profilesFor(standings.map((s) => s.userId));
  const snapshots = await latestSnapshots("global", null);
  const all = standings.map((s) =>
    toEntry(s, profiles.get(s.userId), snapshots.get(s.userId), currentUserId),
  );
  return {
    scope: "global",
    challengeId: null,
    participantCount: all.length,
    entries: all.slice(0, limit),
    me: all.find((e) => e.isCurrentUser) ?? null,
  };
}

export interface CompetitionRankingData {
  scope: "competition";
  competitionSlug: string;
  // The season key actually resolved (null when no current season exists yet).
  season: string | null;
  tournamentId: string | null;
  // True when the competition has no current/upcoming season window (only
  // coming-soon shells or ended campaigns): the leaderboard is intentionally
  // empty until fixtures publish.
  comingSoon: boolean;
  participantCount: number;
  entries: RankingEntryData[];
  me: RankingEntryData | null;
}

// On-the-fly leaderboard for a single competition-season, derived live from
// scored predictions on that tournament's matches. No snapshot is written for
// competition scope (yet), so rank movement is reported as 0.
export async function computeCompetitionRanking(
  competitionSlug: string,
  season: string | null,
  currentUserId: string | null,
  limit = 100,
  now: Date = new Date(),
): Promise<CompetitionRankingData> {
  const tournament = await resolveCompetitionTournament(
    competitionSlug,
    season,
    now,
  );
  if (!tournament) {
    return {
      scope: "competition",
      competitionSlug,
      season,
      tournamentId: null,
      comingSoon: true,
      participantCount: 0,
      entries: [],
      me: null,
    };
  }

  const standings = await competitionStandings(db, tournament.id);
  const profiles = await profilesFor(standings.map((s) => s.userId));
  const all = standings.map((s) =>
    toEntry(s, profiles.get(s.userId), undefined, currentUserId),
  );
  return {
    scope: "competition",
    competitionSlug,
    season: tournament.season,
    tournamentId: tournament.id,
    comingSoon: false,
    participantCount: all.length,
    entries: all.slice(0, limit),
    me: all.find((e) => e.isCurrentUser) ?? null,
  };
}

// ---------- snapshots (called from the scoring engine) ----------

async function writeSnapshot(
  tx: Tx,
  scope: "challenge" | "global",
  challengeId: string | null,
  standings: Standing[],
): Promise<void> {
  if (standings.length === 0) return;
  const prev = await latestSnapshots(scope, challengeId);
  const now = new Date();
  for (const s of standings) {
    await tx.insert(rankingsTable).values({
      scope,
      challengeId,
      userId: s.userId,
      rank: s.rank,
      previousRank: prev.get(s.userId)?.rank ?? null,
      points: s.points,
      accuracy: accuracyOf(s.correct, s.total)?.toString() ?? null,
      exactPredictions: s.exact,
      totalPredictions: s.total,
      computedAt: now,
    });
  }
}

export async function snapshotChallengeRanking(
  tx: Tx,
  challengeId: string,
): Promise<void> {
  await writeSnapshot(
    tx,
    "challenge",
    challengeId,
    await challengeStandings(tx, challengeId),
  );
}

export async function snapshotGlobalRanking(tx: Tx): Promise<void> {
  await writeSnapshot(tx, "global", null, await globalStandings(tx));
}

// ---------- winning probability (heuristic) ----------

export interface WinningProbabilityData {
  challengeId: string;
  rank: number;
  participants: number;
  points: number;
  leaderPoints: number;
  pointsGapToLead: number;
  remainingMatches: number;
  playedMatches: number;
  accuracy: number | null;
  firstPlacePct: number;
  topThreePct: number;
  topTenPct: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const asPct = (x: number) => Math.round(clamp01(x) * 1000) / 10;

export async function computeWinningProbability(
  challenge: Challenge,
  userId: string,
): Promise<WinningProbabilityData | null> {
  const standings = await challengeStandings(db, challenge.id);
  const me = standings.find((s) => s.userId === userId);
  if (!me) return null;

  const participants = standings.length;
  const leaderPoints = standings[0]?.points ?? me.points;
  const pointsGapToLead = Math.max(0, leaderPoints - me.points);

  const matchIds = await matchIdsForChallenge(challenge);
  let playedMatches = 0;
  if (matchIds.length) {
    const [{ played }] = await db
      .select({
        played: sql<number>`cast(count(*) filter (where ${matchesTable.status} in ('finished','full_time')) as int)`,
      })
      .from(matchesTable)
      .where(inArray(matchesTable.id, matchIds));
    playedMatches = played;
  }
  const remainingMatches = Math.max(0, matchIds.length - playedMatches);

  const accuracy = accuracyOf(me.correct, me.total);
  const acc = accuracy ?? 0.25;
  const totalMatches = remainingMatches + playedMatches;
  const volatility = totalMatches > 0 ? remainingMatches / totalMatches : 0;
  const maxRemaining = remainingMatches * DEFAULT_SCORING_RULES.exact;
  const close =
    maxRemaining > 0
      ? clamp01(
          (maxRemaining * (0.4 + 0.6 * acc)) /
            (pointsGapToLead + maxRemaining * 0.5 + 1),
        )
      : pointsGapToLead === 0
        ? 1
        : 0;
  const standing = participants > 0 ? (participants - me.rank + 1) / participants : 0;
  const strength = standing * (1 - volatility) + (0.5 * close + 0.5 * acc) * volatility;

  let first =
    me.rank === 1
      ? 0.5 + 0.5 * strength * (0.5 + 0.5 * (1 - volatility))
      : strength * (0.15 + 0.35 * close);
  let top3 = Math.max(first, standing * 0.6 + 0.4 * strength + (me.rank <= 3 ? 0.2 : 0));
  let top10 = Math.max(
    top3,
    standing * 0.8 + 0.2 + (me.rank <= 10 ? 0.15 : 0),
  );

  // Guarantees from group size.
  if (participants <= 1) first = 1;
  if (participants <= 3) top3 = 1;
  if (participants <= 10) top10 = 1;
  // Enforce monotonicity after guarantees.
  top3 = Math.max(first, top3);
  top10 = Math.max(top3, top10);

  return {
    challengeId: challenge.id,
    rank: me.rank,
    participants,
    points: me.points,
    leaderPoints,
    pointsGapToLead,
    remainingMatches,
    playedMatches,
    accuracy,
    firstPlacePct: asPct(first),
    topThreePct: asPct(top3),
    topTenPct: asPct(top10),
  };
}

// ---------- estimated ranking impact for a live/upcoming match ----------

export interface RankingImpactData {
  challengeId: string;
  matchId: string;
  hasPrediction: boolean;
  live: boolean;
  currentRank: number | null;
  projectedRank: number | null;
  currentPoints: number;
  projectedPoints: number;
  pointsDelta: number;
}

export async function estimateRankingImpact(
  challenge: Challenge,
  userId: string,
  matchId: string,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
): Promise<RankingImpactData> {
  const standings = await challengeStandings(db, challenge.id);
  const me = standings.find((s) => s.userId === userId);
  const currentRank = me?.rank ?? null;
  const currentPoints = me?.points ?? 0;

  const match = await db.query.matchesTable.findFirst({
    where: eq(matchesTable.id, matchId),
  });
  const live = match
    ? match.status === "live" || match.status === "half_time"
    : false;

  const pred = await db.query.predictionsTable.findFirst({
    where: and(
      eq(predictionsTable.userId, userId),
      eq(predictionsTable.matchId, matchId),
    ),
  });
  const hasPrediction = Boolean(pred);

  // Only project when the match has a (provisional) score that has NOT already
  // been folded into standings; a final, already-scored prediction is counted.
  let pointsDelta = 0;
  if (
    pred &&
    match &&
    match.homeScore !== null &&
    match.awayScore !== null &&
    pred.scoredAt === null
  ) {
    const { points } = scorePrediction(
      { home: pred.homeScore, away: pred.awayScore },
      { home: match.homeScore, away: match.awayScore },
      rules,
    );
    pointsDelta = points;
  }

  const projectedPoints = currentPoints + pointsDelta;
  let projectedRank = currentRank;
  if (me && pointsDelta > 0) {
    const projected = assignRanks(
      standings.map((s) =>
        s.userId === userId ? { ...s, points: projectedPoints } : s,
      ),
    );
    projectedRank = projected.find((s) => s.userId === userId)?.rank ?? currentRank;
  }

  return {
    challengeId: challenge.id,
    matchId,
    hasPrediction,
    live,
    currentRank,
    projectedRank,
    currentPoints,
    projectedPoints,
    pointsDelta,
  };
}
