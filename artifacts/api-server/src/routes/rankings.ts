import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  challengesTable,
  challengeParticipantsTable,
} from "@workspace/db";
import { getOrProvisionUser } from "../lib/currentUser";
import { matchIdsForChallenge } from "../lib/challengeMatches";
import {
  computeChallengeRanking,
  computeGlobalRanking,
  computeCompetitionRanking,
  computeTopPlayers,
  computeWinningProbability,
  estimateRankingImpact,
} from "../services/scoring/rankings";
import { maybeRefreshLiveMatches } from "../services/football/liveRefresh";

const router: IRouter = Router();

// Visibility for reading a challenge's standings (mirrors matches route).
function canViewChallenge(
  visibility: string,
  ownerId: string,
  viewerId: string | null,
  isParticipant: boolean,
): boolean {
  if (visibility === "public" || visibility === "unlisted") return true;
  return viewerId === ownerId || isParticipant;
}

async function isActiveParticipant(
  challengeId: string,
  userId: string,
): Promise<boolean> {
  return Boolean(
    await db.query.challengeParticipantsTable.findFirst({
      where: and(
        eq(challengeParticipantsTable.challengeId, challengeId),
        eq(challengeParticipantsTable.userId, userId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    }),
  );
}

// GET /challenges/:id/ranking — challenge leaderboard.
router.get("/challenges/:id/ranking", async (req, res) => {
  await maybeRefreshLiveMatches();
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }

  const participant = viewerId
    ? await isActiveParticipant(challenge.id, viewerId)
    : false;
  if (
    !canViewChallenge(
      challenge.visibility,
      challenge.ownerId,
      viewerId,
      participant,
    )
  ) {
    res.status(403).json({ error: "Not permitted to view this challenge" });
    return;
  }

  res.json(await computeChallengeRanking(challenge.id, viewerId));
});

// GET /rankings/global — platform-wide leaderboard.
router.get("/rankings/global", async (req, res) => {
  await maybeRefreshLiveMatches();
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;
  const limit =
    typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
  res.json(
    await computeGlobalRanking(
      viewerId,
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100,
    ),
  );
});

// GET /rankings/competitions/:competitionSlug — per-competition leaderboard for
// the current season (or an explicit ?season= key). Derived live from scored
// predictions on that competition-season's matches; returns comingSoon=true when
// no current/upcoming season window exists yet.
router.get("/rankings/competitions/:competitionSlug", async (req, res) => {
  await maybeRefreshLiveMatches();
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;
  const season =
    typeof req.query.season === "string" && req.query.season.length > 0
      ? req.query.season
      : null;
  const limit =
    typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
  // tournamentId is an internal routing detail (one row per competition-season)
  // and is deliberately not part of the public contract — strip it here.
  const { tournamentId: _tournamentId, ...ranking } =
    await computeCompetitionRanking(
      req.params.competitionSlug,
      season,
      viewerId,
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100,
    );
  res.json(ranking);
});

// GET /hall-of-fame/top-players — global Top-N leaderboard across all
// challenges, with each player's favourite team and challenge names.
router.get("/hall-of-fame/top-players", async (req, res) => {
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;
  const limit =
    typeof req.query.limit === "string" ? Number(req.query.limit) : 10;
  res.json(
    await computeTopPlayers(
      viewerId,
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 10,
    ),
  );
});

// GET /challenges/:id/winning-probability — caller's odds (participant only).
router.get("/challenges/:id/winning-probability", async (req, res) => {
  const record = await getOrProvisionUser(req);
  if (!record) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }

  if (!(await isActiveParticipant(challenge.id, record.user.id))) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }

  const result = await computeWinningProbability(challenge, record.user.id);
  if (!result) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }
  res.json(result);
});

// GET /challenges/:challengeId/matches/:matchId/impact — estimated ranking
// movement if the current (live/provisional) result stands.
router.get(
  "/challenges/:challengeId/matches/:matchId/impact",
  async (req, res) => {
    const record = await getOrProvisionUser(req);
    if (!record) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const challenge = await db.query.challengesTable.findFirst({
      where: eq(challengesTable.id, req.params.challengeId),
    });
    if (!challenge) {
      res.status(404).json({ error: "Challenge not found" });
      return;
    }

    if (!(await isActiveParticipant(challenge.id, record.user.id))) {
      res.status(403).json({ error: "Not a participant" });
      return;
    }

    // The match must belong to this challenge's scope.
    const matchIds = await matchIdsForChallenge(challenge);
    if (!matchIds.includes(req.params.matchId)) {
      res.status(404).json({ error: "Match not found in this challenge" });
      return;
    }

    res.json(
      await estimateRankingImpact(
        challenge,
        record.user.id,
        req.params.matchId,
      ),
    );
  },
);

export default router;
