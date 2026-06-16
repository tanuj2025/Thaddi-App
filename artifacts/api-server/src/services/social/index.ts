// Social graph: public player profiles, the one-directional follow graph, and
// the symmetric friend-request lifecycle. Privacy is enforced here so the route
// layer stays thin: recent predictions honour both the user-level
// hide-predictions toggle and the per-challenge prediction visibility rules,
// and private challenges are filtered by the viewer's access.

import { and, eq, or, inArray, desc, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  profilesTable,
  teamsTable,
  predictionsTable,
  matchesTable,
  challengesTable,
  challengeParticipantsTable,
  followsTable,
  friendRequestsTable,
  friendshipsTable,
  userBlocksTable,
  type User,
  type Challenge,
} from "@workspace/db";
import type { CurrentUserRecord } from "../../lib/currentUser";
import {
  buildLevelProgress,
  aggregateStats,
  earnedBadges,
  earnedAchievements,
} from "../../lib/gamification";
import { matchIdsForChallenge } from "../../lib/challengeMatches";
import { hasKickedOff } from "../../lib/matchSerializers";
import { notify } from "../notifications";

// Advisory-lock namespace for friend-request / friendship races. Paired with a
// per-canonical-pair key so concurrent send/respond on the same pair serialize
// without blocking unrelated pairs.
const SOCIAL_LOCK_NS = 471709;

const DEFAULT_LIMIT = 50;

export interface ViewerRelationship {
  isSelf: boolean;
  isFollowing: boolean;
  followsYou: boolean;
  friendStatus: "none" | "friends" | "request_sent" | "request_received";
  incomingRequestId: string | null;
  outgoingRequestId: string | null;
  // `isBlocked`: the viewer has blocked this user. `blockedBy`: this user has
  // blocked the viewer. Either direction hides chat and bars follow/friend.
  isBlocked: boolean;
  blockedBy: boolean;
}

export interface SocialCounts {
  followerCount: number;
  followingCount: number;
  friendCount: number;
}

interface TeamRef {
  id: string;
  nameEn: string;
  nameAr: string;
  flagUrl: string | null;
}

export interface PlayerSummary {
  userId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  level: string;
  favoriteTeam: TeamRef | null;
  viewer: ViewerRelationship;
}

interface ProfileChallenge {
  id: string;
  name: string;
  type: string;
  role: "owner" | "participant";
  participantCount: number;
}

interface ProfilePrediction {
  matchId: string;
  kickoffAt: Date;
  status: string;
  homeTeam: TeamRef | null;
  awayTeam: TeamRef | null;
  predictedHome: number;
  predictedAway: number;
  actualHome: number | null;
  actualAway: number | null;
  outcome: string;
  pointsAwarded: number;
}

export interface RelationshipResult {
  viewer: ViewerRelationship;
  social: SocialCounts;
}

interface FriendRequestItem {
  id: string;
  status: string;
  direction: "incoming" | "outgoing";
  user: PlayerSummary;
  createdAt: Date;
  respondedAt: Date | null;
}

interface SocialOverview {
  friends: PlayerSummary[];
  incomingRequests: FriendRequestItem[];
  outgoingRequests: FriendRequestItem[];
  counts: SocialCounts;
}

interface PlayerListPage {
  entries: PlayerSummary[];
  total: number;
}

type MutationError = { error?: { status: number; message: string } };

// Canonical (least, greatest) ordering for the symmetric friendship/pair keys.
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function pairKey(a: string, b: string): string {
  const [x, y] = canonicalPair(a, b);
  return `${x}:${y}`;
}

function profileUrl(userId: string): string | undefined {
  const appUrl = process.env.THADDI_APP_URL ?? "";
  return appUrl ? `${appUrl}/players/${userId}` : undefined;
}

function teamRef(
  team: { id: string; nameEn: string; nameAr: string; flagUrl: string | null } | null | undefined,
): TeamRef | null {
  if (!team) return null;
  return {
    id: team.id,
    nameEn: team.nameEn,
    nameAr: team.nameAr,
    flagUrl: team.flagUrl ?? null,
  };
}

function actorData(actor: CurrentUserRecord) {
  return {
    actorName: actor.profile.displayName ?? actor.profile.username ?? undefined,
    actorUsername: actor.profile.username ?? undefined,
    actorUserId: actor.user.id,
    ctaUrl: profileUrl(actor.user.id),
  };
}

// Computes the viewer's relationship to each of `otherIds` in batch (one query
// per relationship dimension regardless of list size).
export async function getRelationships(
  viewerId: string | null,
  otherIds: string[],
): Promise<Map<string, ViewerRelationship>> {
  const map = new Map<string, ViewerRelationship>();
  const ids = [...new Set(otherIds)];
  for (const id of ids) {
    map.set(id, {
      isSelf: viewerId === id,
      isFollowing: false,
      followsYou: false,
      friendStatus: "none",
      incomingRequestId: null,
      outgoingRequestId: null,
      isBlocked: false,
      blockedBy: false,
    });
  }
  if (!viewerId) return map;
  const others = ids.filter((id) => id !== viewerId);
  if (others.length === 0) return map;

  const [
    followingRows,
    followerRows,
    friendshipRows,
    sentRows,
    receivedRows,
    blockedByMeRows,
    blockingMeRows,
  ] = await Promise.all([
      db
        .select({ followeeId: followsTable.followeeId })
        .from(followsTable)
        .where(
          and(
            eq(followsTable.followerId, viewerId),
            inArray(followsTable.followeeId, others),
          ),
        ),
      db
        .select({ followerId: followsTable.followerId })
        .from(followsTable)
        .where(
          and(
            eq(followsTable.followeeId, viewerId),
            inArray(followsTable.followerId, others),
          ),
        ),
      db
        .select({ a: friendshipsTable.userIdA, b: friendshipsTable.userIdB })
        .from(friendshipsTable)
        .where(
          or(
            and(
              eq(friendshipsTable.userIdA, viewerId),
              inArray(friendshipsTable.userIdB, others),
            ),
            and(
              eq(friendshipsTable.userIdB, viewerId),
              inArray(friendshipsTable.userIdA, others),
            ),
          ),
        ),
      db
        .select({
          id: friendRequestsTable.id,
          recipientId: friendRequestsTable.recipientId,
        })
        .from(friendRequestsTable)
        .where(
          and(
            eq(friendRequestsTable.status, "pending"),
            eq(friendRequestsTable.requesterId, viewerId),
            inArray(friendRequestsTable.recipientId, others),
          ),
        ),
      db
        .select({
          id: friendRequestsTable.id,
          requesterId: friendRequestsTable.requesterId,
        })
        .from(friendRequestsTable)
        .where(
          and(
            eq(friendRequestsTable.status, "pending"),
            eq(friendRequestsTable.recipientId, viewerId),
            inArray(friendRequestsTable.requesterId, others),
          ),
        ),
      db
        .select({ blockedId: userBlocksTable.blockedId })
        .from(userBlocksTable)
        .where(
          and(
            eq(userBlocksTable.blockerId, viewerId),
            inArray(userBlocksTable.blockedId, others),
          ),
        ),
      db
        .select({ blockerId: userBlocksTable.blockerId })
        .from(userBlocksTable)
        .where(
          and(
            eq(userBlocksTable.blockedId, viewerId),
            inArray(userBlocksTable.blockerId, others),
          ),
        ),
    ]);

  for (const r of followingRows) {
    const rel = map.get(r.followeeId);
    if (rel) rel.isFollowing = true;
  }
  for (const r of followerRows) {
    const rel = map.get(r.followerId);
    if (rel) rel.followsYou = true;
  }
  for (const r of friendshipRows) {
    const otherId = r.a === viewerId ? r.b : r.a;
    const rel = map.get(otherId);
    if (rel) rel.friendStatus = "friends";
  }
  for (const r of sentRows) {
    const rel = map.get(r.recipientId);
    if (rel && rel.friendStatus !== "friends") {
      rel.friendStatus = "request_sent";
      rel.outgoingRequestId = r.id;
    }
  }
  for (const r of receivedRows) {
    const rel = map.get(r.requesterId);
    if (rel && rel.friendStatus !== "friends") {
      rel.friendStatus = "request_received";
      rel.incomingRequestId = r.id;
    }
  }
  for (const r of blockedByMeRows) {
    const rel = map.get(r.blockedId);
    if (rel) rel.isBlocked = true;
  }
  for (const r of blockingMeRows) {
    const rel = map.get(r.blockerId);
    if (rel) rel.blockedBy = true;
  }
  return map;
}

export async function getSocialCounts(userId: string): Promise<SocialCounts> {
  const cnt = sql<number>`cast(count(*) as int)`;
  const [[followers], [following], [friends]] = await Promise.all([
    db
      .select({ c: cnt })
      .from(followsTable)
      .where(eq(followsTable.followeeId, userId)),
    db
      .select({ c: cnt })
      .from(followsTable)
      .where(eq(followsTable.followerId, userId)),
    db
      .select({ c: cnt })
      .from(friendshipsTable)
      .where(
        or(
          eq(friendshipsTable.userIdA, userId),
          eq(friendshipsTable.userIdB, userId),
        ),
      ),
  ]);
  return {
    followerCount: followers?.c ?? 0,
    followingCount: following?.c ?? 0,
    friendCount: friends?.c ?? 0,
  };
}

// Builds compact player cards for a list of ids, preserving the input order and
// silently dropping ids whose user record no longer exists.
export async function loadPlayerSummaries(
  viewerId: string | null,
  ids: string[],
): Promise<PlayerSummary[]> {
  if (ids.length === 0) return [];
  const uniqueIds = [...new Set(ids)];
  const [users, profiles, rels] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        level: usersTable.level,
        favoriteTeamId: usersTable.favoriteTeamId,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, uniqueIds)),
    db
      .select({
        userId: profilesTable.userId,
        displayName: profilesTable.displayName,
        username: profilesTable.username,
        avatarUrl: profilesTable.avatarUrl,
      })
      .from(profilesTable)
      .where(inArray(profilesTable.userId, uniqueIds)),
    getRelationships(viewerId, uniqueIds),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const profMap = new Map(profiles.map((p) => [p.userId, p]));
  const teamIds = [
    ...new Set(
      users.map((u) => u.favoriteTeamId).filter((x): x is string => !!x),
    ),
  ];
  const teams = teamIds.length
    ? await db
        .select({
          id: teamsTable.id,
          nameEn: teamsTable.nameEn,
          nameAr: teamsTable.nameAr,
          flagUrl: teamsTable.flagUrl,
        })
        .from(teamsTable)
        .where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  const result: PlayerSummary[] = [];
  for (const id of ids) {
    const u = userMap.get(id);
    if (!u) continue;
    const p = profMap.get(id);
    result.push({
      userId: id,
      displayName: p?.displayName ?? null,
      username: p?.username ?? null,
      avatarUrl: p?.avatarUrl ?? null,
      level: u.level,
      favoriteTeam: u.favoriteTeamId
        ? teamRef(teamMap.get(u.favoriteTeamId))
        : null,
      viewer: rels.get(id)!,
    });
  }
  return result;
}

// The owner's current (active) challenges, filtered by the viewer's visibility:
// public/unlisted are always shown; private only when the viewer owns or
// actively participates in that specific challenge.
async function profileChallenges(
  ownerId: string,
  viewerId: string | null,
): Promise<ProfileChallenge[]> {
  const owned = await db
    .select({
      id: challengesTable.id,
      name: challengesTable.name,
      type: challengesTable.type,
      visibility: challengesTable.visibility,
    })
    .from(challengesTable)
    .where(
      and(
        eq(challengesTable.ownerId, ownerId),
        eq(challengesTable.status, "active"),
      ),
    );

  const joined = await db
    .select({
      id: challengesTable.id,
      name: challengesTable.name,
      type: challengesTable.type,
      visibility: challengesTable.visibility,
      ownerId: challengesTable.ownerId,
    })
    .from(challengeParticipantsTable)
    .innerJoin(
      challengesTable,
      eq(challengeParticipantsTable.challengeId, challengesTable.id),
    )
    .where(
      and(
        eq(challengeParticipantsTable.userId, ownerId),
        eq(challengeParticipantsTable.status, "active"),
        eq(challengesTable.status, "active"),
      ),
    );

  const candidates = new Map<
    string,
    {
      id: string;
      name: string;
      type: string;
      visibility: string;
      role: "owner" | "participant";
    }
  >();
  for (const c of owned) candidates.set(c.id, { ...c, role: "owner" });
  for (const c of joined) {
    if (candidates.has(c.id) || c.ownerId === ownerId) continue;
    candidates.set(c.id, {
      id: c.id,
      name: c.name,
      type: c.type,
      visibility: c.visibility,
      role: "participant",
    });
  }

  const list = [...candidates.values()];
  const privateIds = list
    .filter((c) => c.visibility === "private")
    .map((c) => c.id);
  const viewerAccess = new Set<string>();
  if (viewerId && privateIds.length) {
    const [ownedByViewer, joinedByViewer] = await Promise.all([
      db
        .select({ id: challengesTable.id })
        .from(challengesTable)
        .where(
          and(
            eq(challengesTable.ownerId, viewerId),
            inArray(challengesTable.id, privateIds),
          ),
        ),
      db
        .select({ challengeId: challengeParticipantsTable.challengeId })
        .from(challengeParticipantsTable)
        .where(
          and(
            eq(challengeParticipantsTable.userId, viewerId),
            eq(challengeParticipantsTable.status, "active"),
            inArray(challengeParticipantsTable.challengeId, privateIds),
          ),
        ),
    ]);
    for (const r of ownedByViewer) viewerAccess.add(r.id);
    for (const r of joinedByViewer) viewerAccess.add(r.challengeId);
  }

  const visible = list.filter(
    (c) => c.visibility !== "private" || viewerAccess.has(c.id),
  );

  const visibleIds = visible.map((c) => c.id);
  const counts = new Map<string, number>();
  if (visibleIds.length) {
    const rows = await db
      .select({
        challengeId: challengeParticipantsTable.challengeId,
        c: sql<number>`cast(count(*) as int)`,
      })
      .from(challengeParticipantsTable)
      .where(
        and(
          inArray(challengeParticipantsTable.challengeId, visibleIds),
          eq(challengeParticipantsTable.status, "active"),
        ),
      )
      .groupBy(challengeParticipantsTable.challengeId);
    for (const r of rows) counts.set(r.challengeId, r.c);
  }

  return visible.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    role: c.role,
    participantCount: counts.get(c.id) ?? 0,
  }));
}

// The owner's owned + actively-participated challenges (any status), used to
// decide whether a global prediction is concealed by per-challenge "hidden"
// visibility.
async function ownerChallengesForHiddenRule(
  ownerId: string,
): Promise<Challenge[]> {
  const owned = await db
    .select()
    .from(challengesTable)
    .where(eq(challengesTable.ownerId, ownerId));
  const joined = await db
    .select({ ch: challengesTable })
    .from(challengeParticipantsTable)
    .innerJoin(
      challengesTable,
      eq(challengeParticipantsTable.challengeId, challengesTable.id),
    )
    .where(
      and(
        eq(challengeParticipantsTable.userId, ownerId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    );
  const map = new Map<string, Challenge>();
  for (const c of owned) map.set(c.id, c);
  for (const r of joined) map.set(r.ch.id, r.ch);
  return [...map.values()];
}

// Recent predictions for a profile. A prediction is revealed to a non-self
// viewer only when the match has kicked off, the owner has not enabled the
// hide-predictions toggle, and the match is not covered EXCLUSIVELY by
// 'hidden'-visibility challenges among the owner's challenges. The owner sees
// all their own kicked-off predictions.
async function recentProfilePredictions(
  owner: User,
  viewerId: string | null,
): Promise<{ predictions: ProfilePrediction[]; hidden: boolean }> {
  const isSelf = viewerId === owner.id;
  if (!isSelf && owner.hidePredictions) {
    return { predictions: [], hidden: true };
  }
  const now = new Date();

  let visByMatch: Map<string, string[]> | null = null;
  if (!isSelf) {
    visByMatch = new Map();
    const ownerChallenges = await ownerChallengesForHiddenRule(owner.id);
    for (const ch of ownerChallenges) {
      const mids = await matchIdsForChallenge(ch);
      for (const mid of mids) {
        const arr = visByMatch.get(mid) ?? [];
        arr.push(ch.predictionVisibility);
        visByMatch.set(mid, arr);
      }
    }
  }

  const reveal = (matchId: string): boolean => {
    if (!visByMatch) return true;
    const vis = visByMatch.get(matchId);
    if (!vis || vis.length === 0) return true;
    return vis.some((v) => v !== "hidden");
  };

  const rows = await db
    .select({
      matchId: predictionsTable.matchId,
      predictedHome: predictionsTable.homeScore,
      predictedAway: predictionsTable.awayScore,
      outcome: predictionsTable.outcome,
      pointsAwarded: predictionsTable.pointsAwarded,
      match: matchesTable,
    })
    .from(predictionsTable)
    .innerJoin(matchesTable, eq(predictionsTable.matchId, matchesTable.id))
    .where(eq(predictionsTable.userId, owner.id))
    .orderBy(desc(matchesTable.kickoffAt));

  const selected: typeof rows = [];
  for (const r of rows) {
    if (!hasKickedOff(r.match, now)) continue;
    if (!isSelf && !reveal(r.matchId)) continue;
    selected.push(r);
    if (selected.length >= 10) break;
  }

  const teamIds = [
    ...new Set(
      selected
        .flatMap((r) => [r.match.homeTeamId, r.match.awayTeamId])
        .filter((x): x is string => !!x),
    ),
  ];
  const teams = teamIds.length
    ? await db
        .select({
          id: teamsTable.id,
          nameEn: teamsTable.nameEn,
          nameAr: teamsTable.nameAr,
          flagUrl: teamsTable.flagUrl,
        })
        .from(teamsTable)
        .where(inArray(teamsTable.id, teamIds))
    : [];
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  const predictions: ProfilePrediction[] = selected.map((r) => ({
    matchId: r.matchId,
    kickoffAt: r.match.kickoffAt,
    status: r.match.status,
    homeTeam: r.match.homeTeamId
      ? teamRef(teamMap.get(r.match.homeTeamId))
      : null,
    awayTeam: r.match.awayTeamId
      ? teamRef(teamMap.get(r.match.awayTeamId))
      : null,
    predictedHome: r.predictedHome,
    predictedAway: r.predictedAway,
    actualHome: r.match.homeScore ?? null,
    actualAway: r.match.awayScore ?? null,
    outcome: r.outcome,
    pointsAwarded: r.pointsAwarded,
  }));

  return { predictions, hidden: false };
}

// Assembles a full public player profile honouring privacy and visibility.
// Returns null when the user does not exist (or is deleted).
export async function buildPlayerProfile(targetId: string, viewerId: string) {
  const target = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, targetId),
  });
  if (!target || target.status === "deleted") return null;

  const [profile, team] = await Promise.all([
    db.query.profilesTable.findFirst({
      where: eq(profilesTable.userId, targetId),
    }),
    target.favoriteTeamId
      ? db.query.teamsTable.findFirst({
          where: eq(teamsTable.id, target.favoriteTeamId),
        })
      : Promise.resolve(null),
  ]);

  const stats = await aggregateStats(targetId);
  const [levelProgress, badges, achievements, challenges, recent, social, rels] =
    await Promise.all([
      buildLevelProgress(stats.totalPoints),
      earnedBadges(targetId),
      earnedAchievements(targetId),
      profileChallenges(targetId, viewerId),
      recentProfilePredictions(target, viewerId),
      getSocialCounts(targetId),
      getRelationships(viewerId, [targetId]),
    ]);

  return {
    userId: targetId,
    displayName: profile?.displayName ?? null,
    username: profile?.username ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    level: target.level,
    favoriteTeam: teamRef(team),
    levelProgress,
    stats,
    badges: badges.map((b) => ({
      id: b.id,
      code: b.code,
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      descriptionEn: b.descriptionEn ?? null,
      descriptionAr: b.descriptionAr ?? null,
      iconUrl: b.iconUrl ?? null,
      awardedAt: b.awardedAt,
    })),
    achievements: achievements.map((a) => ({
      id: a.id,
      code: a.code,
      type: a.type,
      nameEn: a.nameEn,
      nameAr: a.nameAr,
      descriptionEn: a.descriptionEn ?? null,
      descriptionAr: a.descriptionAr ?? null,
      iconUrl: a.iconUrl ?? null,
      challengeId: a.challengeId ?? null,
      awardedAt: a.awardedAt,
    })),
    challenges,
    recentPredictions: recent.predictions,
    predictionsHidden: recent.hidden,
    social,
    viewer: rels.get(targetId)!,
  };
}

export async function getSocialOverview(
  userId: string,
): Promise<SocialOverview> {
  const [friendRows, incoming, outgoing, counts] = await Promise.all([
    db
      .select({ a: friendshipsTable.userIdA, b: friendshipsTable.userIdB })
      .from(friendshipsTable)
      .where(
        or(
          eq(friendshipsTable.userIdA, userId),
          eq(friendshipsTable.userIdB, userId),
        ),
      )
      .orderBy(desc(friendshipsTable.createdAt)),
    db
      .select()
      .from(friendRequestsTable)
      .where(
        and(
          eq(friendRequestsTable.recipientId, userId),
          eq(friendRequestsTable.status, "pending"),
        ),
      )
      .orderBy(desc(friendRequestsTable.createdAt)),
    db
      .select()
      .from(friendRequestsTable)
      .where(
        and(
          eq(friendRequestsTable.requesterId, userId),
          eq(friendRequestsTable.status, "pending"),
        ),
      )
      .orderBy(desc(friendRequestsTable.createdAt)),
    getSocialCounts(userId),
  ]);

  const friendIds = friendRows.map((r) => (r.a === userId ? r.b : r.a));
  const allIds = [
    ...new Set([
      ...friendIds,
      ...incoming.map((r) => r.requesterId),
      ...outgoing.map((r) => r.recipientId),
    ]),
  ];
  const summaries = await loadPlayerSummaries(userId, allIds);
  const byId = new Map(summaries.map((s) => [s.userId, s]));

  return {
    friends: friendIds
      .map((id) => byId.get(id))
      .filter((x): x is PlayerSummary => !!x),
    incomingRequests: incoming
      .filter((r) => byId.has(r.requesterId))
      .map((r) => ({
        id: r.id,
        status: r.status,
        direction: "incoming" as const,
        user: byId.get(r.requesterId)!,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt ?? null,
      })),
    outgoingRequests: outgoing
      .filter((r) => byId.has(r.recipientId))
      .map((r) => ({
        id: r.id,
        status: r.status,
        direction: "outgoing" as const,
        user: byId.get(r.recipientId)!,
        createdAt: r.createdAt,
        respondedAt: r.respondedAt ?? null,
      })),
    counts,
  };
}

async function userExists(userId: string): Promise<boolean> {
  const u = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u.length > 0;
}

export async function listFollowers(
  viewerId: string,
  targetId: string,
  limit: number,
  offset: number,
): Promise<PlayerListPage | null> {
  if (!(await userExists(targetId))) return null;
  const [[total], rows] = await Promise.all([
    db
      .select({ c: sql<number>`cast(count(*) as int)` })
      .from(followsTable)
      .where(eq(followsTable.followeeId, targetId)),
    db
      .select({ followerId: followsTable.followerId })
      .from(followsTable)
      .where(eq(followsTable.followeeId, targetId))
      .orderBy(desc(followsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);
  const entries = await loadPlayerSummaries(
    viewerId,
    rows.map((r) => r.followerId),
  );
  return { entries, total: total?.c ?? 0 };
}

export async function listFollowing(
  viewerId: string,
  targetId: string,
  limit: number,
  offset: number,
): Promise<PlayerListPage | null> {
  if (!(await userExists(targetId))) return null;
  const [[total], rows] = await Promise.all([
    db
      .select({ c: sql<number>`cast(count(*) as int)` })
      .from(followsTable)
      .where(eq(followsTable.followerId, targetId)),
    db
      .select({ followeeId: followsTable.followeeId })
      .from(followsTable)
      .where(eq(followsTable.followerId, targetId))
      .orderBy(desc(followsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);
  const entries = await loadPlayerSummaries(
    viewerId,
    rows.map((r) => r.followeeId),
  );
  return { entries, total: total?.c ?? 0 };
}

export async function followUser(
  actor: CurrentUserRecord,
  targetId: string,
): Promise<MutationError> {
  const me = actor.user.id;
  if (me === targetId) {
    return { error: { status: 400, message: "You cannot follow yourself" } };
  }
  const target = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, targetId),
  });
  if (!target || target.status === "deleted") {
    return { error: { status: 404, message: "User not found" } };
  }
  if (await areBlocked(me, targetId)) {
    return { error: { status: 403, message: "This action is not available" } };
  }
  const inserted = await db
    .insert(followsTable)
    .values({ followerId: me, followeeId: targetId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) {
    await notify(targetId, "new_follower", actorData(actor));
  }
  return {};
}

export async function unfollowUser(
  actorId: string,
  targetId: string,
): Promise<MutationError> {
  // Mirror followUser: a missing/deleted target is a 404 (matches the spec),
  // while unfollowing someone you don't actually follow is a no-op success.
  const target = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, targetId),
  });
  if (!target || target.status === "deleted") {
    return { error: { status: 404, message: "User not found" } };
  }
  await db
    .delete(followsTable)
    .where(
      and(
        eq(followsTable.followerId, actorId),
        eq(followsTable.followeeId, targetId),
      ),
    );
  return {};
}

export async function sendFriendRequest(
  actor: CurrentUserRecord,
  targetId: string,
): Promise<MutationError & { requestId?: string }> {
  const me = actor.user.id;
  if (me === targetId) {
    return {
      error: {
        status: 400,
        message: "You cannot send a friend request to yourself",
      },
    };
  }
  const target = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, targetId),
  });
  if (!target || target.status === "deleted") {
    return { error: { status: 404, message: "User not found" } };
  }
  if (await areBlocked(me, targetId)) {
    return { error: { status: 403, message: "This action is not available" } };
  }

  const [a, b] = canonicalPair(me, targetId);
  let result: MutationError & { requestId?: string } = {};
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${SOCIAL_LOCK_NS}, hashtext(${pairKey(a, b)}))`,
    );
    const friends = await tx
      .select({ id: friendshipsTable.id })
      .from(friendshipsTable)
      .where(
        and(eq(friendshipsTable.userIdA, a), eq(friendshipsTable.userIdB, b)),
      )
      .limit(1);
    if (friends.length) {
      result = { error: { status: 409, message: "You are already friends" } };
      return;
    }
    const pending = await tx
      .select({
        id: friendRequestsTable.id,
        requesterId: friendRequestsTable.requesterId,
      })
      .from(friendRequestsTable)
      .where(
        and(
          eq(friendRequestsTable.status, "pending"),
          or(
            and(
              eq(friendRequestsTable.requesterId, me),
              eq(friendRequestsTable.recipientId, targetId),
            ),
            and(
              eq(friendRequestsTable.requesterId, targetId),
              eq(friendRequestsTable.recipientId, me),
            ),
          ),
        ),
      )
      .limit(1);
    if (pending.length) {
      result = {
        error: {
          status: 409,
          message:
            pending[0].requesterId === me
              ? "Friend request already sent"
              : "This player has already sent you a friend request",
        },
      };
      return;
    }
    const [created] = await tx
      .insert(friendRequestsTable)
      .values({ requesterId: me, recipientId: targetId, status: "pending" })
      .returning();
    result = { requestId: created.id };
  });

  if (result.requestId) {
    await notify(targetId, "friend_request_received", {
      ...actorData(actor),
      requestId: result.requestId,
    });
  }
  return result;
}

export async function respondFriendRequest(
  actor: CurrentUserRecord,
  requestId: string,
  accept: boolean,
): Promise<MutationError & { requesterId?: string }> {
  const me = actor.user.id;
  const reqRow = await db.query.friendRequestsTable.findFirst({
    where: eq(friendRequestsTable.id, requestId),
  });
  if (!reqRow) {
    return { error: { status: 404, message: "Friend request not found" } };
  }
  if (reqRow.recipientId !== me) {
    return {
      error: { status: 403, message: "You cannot respond to this request" },
    };
  }
  if (reqRow.status !== "pending") {
    return {
      error: { status: 409, message: "This request has already been handled" },
    };
  }

  const requesterId = reqRow.requesterId;
  const [a, b] = canonicalPair(me, requesterId);
  let result: MutationError & { requesterId?: string; accepted?: boolean } = {};
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${SOCIAL_LOCK_NS}, hashtext(${pairKey(a, b)}))`,
    );
    const cur = await tx
      .select({ status: friendRequestsTable.status })
      .from(friendRequestsTable)
      .where(eq(friendRequestsTable.id, requestId))
      .limit(1);
    if (!cur.length || cur[0].status !== "pending") {
      result = {
        error: {
          status: 409,
          message: "This request has already been handled",
        },
      };
      return;
    }
    if (accept) {
      await tx
        .update(friendRequestsTable)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(friendRequestsTable.id, requestId));
      await tx
        .insert(friendshipsTable)
        .values({ userIdA: a, userIdB: b })
        .onConflictDoNothing();
      result = { requesterId, accepted: true };
    } else {
      await tx
        .update(friendRequestsTable)
        .set({ status: "declined", respondedAt: new Date() })
        .where(eq(friendRequestsTable.id, requestId));
      result = { requesterId, accepted: false };
    }
  });

  if (result.accepted) {
    await notify(requesterId, "friend_request_accepted", actorData(actor));
  }
  return result;
}

export async function cancelFriendRequest(
  actorId: string,
  targetId: string,
): Promise<MutationError> {
  const updated = await db
    .update(friendRequestsTable)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(
      and(
        eq(friendRequestsTable.requesterId, actorId),
        eq(friendRequestsTable.recipientId, targetId),
        eq(friendRequestsTable.status, "pending"),
      ),
    )
    .returning();
  if (!updated.length) {
    return {
      error: { status: 404, message: "No pending friend request to cancel" },
    };
  }
  return {};
}

export async function removeFriend(
  actorId: string,
  targetId: string,
): Promise<MutationError> {
  const [a, b] = canonicalPair(actorId, targetId);
  const deleted = await db
    .delete(friendshipsTable)
    .where(
      and(eq(friendshipsTable.userIdA, a), eq(friendshipsTable.userIdB, b)),
    )
    .returning();
  if (!deleted.length) {
    return {
      error: { status: 404, message: "You are not friends with this player" },
    };
  }
  return {};
}

// True when either user has blocked the other. Used to bar follow/friend
// actions and to hide chat in both directions.
export async function areBlocked(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ id: userBlocksTable.id })
    .from(userBlocksTable)
    .where(
      or(
        and(
          eq(userBlocksTable.blockerId, a),
          eq(userBlocksTable.blockedId, b),
        ),
        and(
          eq(userBlocksTable.blockerId, b),
          eq(userBlocksTable.blockedId, a),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// The set of user ids the viewer cannot see in chat: anyone they have blocked
// plus anyone who has blocked them.
export async function blockedUserIds(viewerId: string): Promise<string[]> {
  const rows = await db
    .select({
      blockerId: userBlocksTable.blockerId,
      blockedId: userBlocksTable.blockedId,
    })
    .from(userBlocksTable)
    .where(
      or(
        eq(userBlocksTable.blockerId, viewerId),
        eq(userBlocksTable.blockedId, viewerId),
      ),
    );
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
  }
  return [...ids];
}

// Block a user. Idempotent. Severs the social graph in both directions
// (follows, friendship, pending requests) inside one transaction so a blocked
// pair shares no residual connection.
export async function blockUser(
  actor: CurrentUserRecord,
  targetId: string,
): Promise<MutationError> {
  const me = actor.user.id;
  if (me === targetId) {
    return { error: { status: 400, message: "You cannot block yourself" } };
  }
  const target = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, targetId),
  });
  if (!target || target.status === "deleted") {
    return { error: { status: 404, message: "User not found" } };
  }
  const [a, b] = canonicalPair(me, targetId);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${SOCIAL_LOCK_NS}, hashtext(${pairKey(a, b)}))`,
    );
    await tx
      .insert(userBlocksTable)
      .values({ blockerId: me, blockedId: targetId })
      .onConflictDoNothing();
    // Drop follows in both directions.
    await tx
      .delete(followsTable)
      .where(
        or(
          and(
            eq(followsTable.followerId, me),
            eq(followsTable.followeeId, targetId),
          ),
          and(
            eq(followsTable.followerId, targetId),
            eq(followsTable.followeeId, me),
          ),
        ),
      );
    // Drop the canonical friendship, if any.
    await tx
      .delete(friendshipsTable)
      .where(
        and(eq(friendshipsTable.userIdA, a), eq(friendshipsTable.userIdB, b)),
      );
    // Cancel any pending friend requests between the pair (either direction).
    await tx
      .update(friendRequestsTable)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(
        and(
          eq(friendRequestsTable.status, "pending"),
          or(
            and(
              eq(friendRequestsTable.requesterId, me),
              eq(friendRequestsTable.recipientId, targetId),
            ),
            and(
              eq(friendRequestsTable.requesterId, targetId),
              eq(friendRequestsTable.recipientId, me),
            ),
          ),
        ),
      );
  });
  return {};
}

// Remove a block the actor placed. Idempotent: unblocking someone who isn't
// blocked is a no-op success.
export async function unblockUser(
  actorId: string,
  targetId: string,
): Promise<MutationError> {
  await db
    .delete(userBlocksTable)
    .where(
      and(
        eq(userBlocksTable.blockerId, actorId),
        eq(userBlocksTable.blockedId, targetId),
      ),
    );
  return {};
}

export async function relationshipResult(
  viewerId: string,
  targetId: string,
): Promise<RelationshipResult> {
  const [rels, social] = await Promise.all([
    getRelationships(viewerId, [targetId]),
    getSocialCounts(targetId),
  ]);
  return { viewer: rels.get(targetId)!, social };
}

export { DEFAULT_LIMIT };
