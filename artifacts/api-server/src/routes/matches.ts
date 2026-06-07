import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  matchesTable,
  teamsTable,
  stagesTable,
  predictionsTable,
  predictionHistoryTable,
  challengesTable,
  challengeParticipantsTable,
  profilesTable,
  type Match,
  type Team,
  type Prediction,
} from "@workspace/db";
import { SubmitPredictionBody } from "@workspace/api-zod";
import {
  requireActivatedUser,
  getOrProvisionUser,
} from "../lib/currentUser";
import {
  serializeMatchSummary,
  serializeMatchDetail,
  isLocked,
  hasKickedOff,
  type ParticipantPredictionDto,
} from "../lib/matchSerializers";
import { matchIdsForChallenge } from "../lib/challengeMatches";
import { matchTrends, matchComparison } from "../lib/predictionStats";
import { syncTournament } from "../services/football/sync";
import { applyScoringForFinalMatches } from "../services/scoring/engine";
import {
  runPostScoring,
  runScheduledNotifications,
} from "../services/scoring/afterScoring";
import { recordEvent } from "../lib/analytics";

const router: IRouter = Router();

const homeTeamAlias = alias(teamsTable, "home_team");
const awayTeamAlias = alias(teamsTable, "away_team");

interface LoadedMatch {
  match: Match;
  homeTeam: Team | null;
  awayTeam: Team | null;
  stageType: string | null;
}

// Loads matches (optionally restricted to a set of ids) with their teams and
// stage type, ordered by kickoff.
async function loadMatches(matchIds?: string[]): Promise<LoadedMatch[]> {
  if (matchIds && matchIds.length === 0) return [];
  const rows = await db
    .select({
      match: matchesTable,
      home: homeTeamAlias,
      away: awayTeamAlias,
      stageType: stagesTable.type,
    })
    .from(matchesTable)
    .leftJoin(homeTeamAlias, eq(matchesTable.homeTeamId, homeTeamAlias.id))
    .leftJoin(awayTeamAlias, eq(matchesTable.awayTeamId, awayTeamAlias.id))
    .leftJoin(stagesTable, eq(matchesTable.stageId, stagesTable.id))
    .where(matchIds ? inArray(matchesTable.id, matchIds) : undefined)
    .orderBy(asc(matchesTable.kickoffAt));

  return rows.map((r) => ({
    match: r.match,
    homeTeam: r.home,
    awayTeam: r.away,
    stageType: r.stageType ?? null,
  }));
}

async function loadOneMatch(matchId: string): Promise<LoadedMatch | null> {
  const [row] = await db
    .select({
      match: matchesTable,
      home: homeTeamAlias,
      away: awayTeamAlias,
      stageType: stagesTable.type,
    })
    .from(matchesTable)
    .leftJoin(homeTeamAlias, eq(matchesTable.homeTeamId, homeTeamAlias.id))
    .leftJoin(awayTeamAlias, eq(matchesTable.awayTeamId, awayTeamAlias.id))
    .leftJoin(stagesTable, eq(matchesTable.stageId, stagesTable.id))
    .where(eq(matchesTable.id, matchId))
    .limit(1);
  if (!row) return null;
  return {
    match: row.match,
    homeTeam: row.home,
    awayTeam: row.away,
    stageType: row.stageType ?? null,
  };
}

// Map of matchId -> this user's prediction, for the given matches.
async function myPredictions(
  userId: string | null,
  matchIds: string[],
): Promise<Map<string, Prediction>> {
  const map = new Map<string, Prediction>();
  if (!userId || matchIds.length === 0) return map;
  const rows = await db
    .select()
    .from(predictionsTable)
    .where(
      and(
        eq(predictionsTable.userId, userId),
        inArray(predictionsTable.matchId, matchIds),
      ),
    );
  for (const p of rows) map.set(p.matchId, p);
  return map;
}

function matchesScopeFilter(
  loaded: LoadedMatch[],
  scope: string | undefined,
): LoadedMatch[] {
  switch (scope) {
    case "live":
      return loaded.filter(
        (l) => l.match.status === "live" || l.match.status === "half_time",
      );
    case "upcoming":
      return loaded.filter((l) => l.match.status === "scheduled");
    case "finished":
      return loaded.filter(
        (l) => l.match.status === "finished" || l.match.status === "full_time",
      );
    default:
      return loaded;
  }
}

// ---------- Match Center ----------

// GET /matches — global fixtures for the Match Center.
router.get("/matches", async (req, res) => {
  const record = await getOrProvisionUser(req);
  const userId = record?.user.id ?? null;
  const scope = typeof req.query.scope === "string" ? req.query.scope : "all";

  const loaded = matchesScopeFilter(await loadMatches(), scope);
  const preds = await myPredictions(
    userId,
    loaded.map((l) => l.match.id),
  );
  const now = new Date();
  res.json(
    loaded.map((l) =>
      serializeMatchSummary(
        {
          match: l.match,
          homeTeam: l.homeTeam,
          awayTeam: l.awayTeam,
          stageType: l.stageType,
          myPrediction: preds.get(l.match.id) ?? null,
        },
        now,
      ),
    ),
  );
});

// POST /matches/refresh — sync provider data then score finals.
router.post("/matches/refresh", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;

  const sync = await syncTournament();
  const scored = await applyScoringForFinalMatches();
  const matchesScored = scored.filter((s) => s.scored).length;
  // Post-commit side effects: gamification + event notifications, then the
  // time-based reminder sweep (no scheduler exists, so the refresh cycle drives
  // it). Both are best-effort and never throw.
  await runPostScoring(scored);
  await runScheduledNotifications();
  res.json({
    provider: sync.provider,
    teamsUpserted: sync.teamsUpserted,
    matchesUpserted: sync.matchesUpserted,
    teamsPruned: sync.teamsPruned,
    matchesPruned: sync.matchesPruned,
    matchesScored,
    skipped: sync.skipped ?? null,
  });
});

// GET /matches/:id — global match detail (no participant reveal).
router.get("/matches/:id", async (req, res) => {
  const record = await getOrProvisionUser(req);
  const userId = record?.user.id ?? null;

  const loaded = await loadOneMatch(req.params.id);
  if (!loaded) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  const preds = await myPredictions(userId, [loaded.match.id]);
  res.json(
    serializeMatchDetail(
      {
        match: loaded.match,
        homeTeam: loaded.homeTeam,
        awayTeam: loaded.awayTeam,
        stageType: loaded.stageType,
        myPrediction: preds.get(loaded.match.id) ?? null,
      },
      { revealed: false, participantPredictions: [] },
    ),
  );
});

// PUT /matches/:id/prediction — create or edit a prediction (before lock).
router.put("/matches/:id/prediction", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;
  const userId = record.user.id;

  const parsed = SubmitPredictionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid prediction" });
    return;
  }
  const { homeScore, awayScore } = parsed.data;

  const match = await db.query.matchesTable.findFirst({
    where: eq(matchesTable.id, req.params.id),
  });
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  if (isLocked(match)) {
    res.status(409).json({ error: "Predictions are locked for this match" });
    return;
  }

  const now = new Date();
  const existing = await db.query.predictionsTable.findFirst({
    where: and(
      eq(predictionsTable.userId, userId),
      eq(predictionsTable.matchId, match.id),
    ),
  });

  // Atomic: the live prediction write and its tamper-evident history append
  // must either both commit or both roll back. A crash between the two would
  // otherwise change a user's pick without a matching audit row, defeating the
  // anti-cheating trail.
  const saved = await db.transaction(async (tx) => {
    let row: Prediction;
    if (existing) {
      const [updated] = await tx
        .update(predictionsTable)
        .set({ homeScore, awayScore, updatedAt: now })
        .where(eq(predictionsTable.id, existing.id))
        .returning();
      row = updated;
    } else {
      const [created] = await tx
        .insert(predictionsTable)
        .values({ userId, matchId: match.id, homeScore, awayScore })
        .returning();
      row = created;
    }

    // Append to the edit history (anti-cheating audit trail).
    await tx.insert(predictionHistoryTable).values({
      predictionId: row.id,
      userId,
      matchId: match.id,
      homeScore,
      awayScore,
    });

    return row;
  });

  // Best-effort: count first-time submissions (not edits) in the growth funnel.
  if (!existing) {
    await recordEvent({
      type: "prediction_submitted",
      userId,
      entityType: "match",
      entityId: match.id,
    });
  }

  res.json({
    id: saved.id,
    homeScore: saved.homeScore,
    awayScore: saved.awayScore,
    outcome: saved.outcome,
    pointsAwarded: saved.pointsAwarded,
    submittedAt: saved.submittedAt,
    updatedAt: saved.updatedAt,
    scoredAt: saved.scoredAt ?? null,
  });
});

// GET /matches/:id/prediction-history — caller's own edit history.
router.get("/matches/:id/prediction-history", async (req, res) => {
  const record = await getOrProvisionUser(req);
  if (!record) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await db
    .select()
    .from(predictionHistoryTable)
    .where(
      and(
        eq(predictionHistoryTable.userId, record.user.id),
        eq(predictionHistoryTable.matchId, req.params.id),
      ),
    )
    .orderBy(asc(predictionHistoryTable.recordedAt));

  res.json(
    rows.map((h) => ({
      id: h.id,
      homeScore: h.homeScore,
      awayScore: h.awayScore,
      recordedAt: h.recordedAt,
    })),
  );
});

// GET /matches/:id/trends — aggregate outcome percentages (never exact scores).
router.get("/matches/:id/trends", async (req, res) => {
  const record = await getOrProvisionUser(req);
  const userId = record?.user.id ?? null;

  const match = await db.query.matchesTable.findFirst({
    where: eq(matchesTable.id, req.params.id),
  });
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const myPred = userId
    ? ((await db.query.predictionsTable.findFirst({
        where: and(
          eq(predictionsTable.userId, userId),
          eq(predictionsTable.matchId, match.id),
        ),
      })) ?? null)
    : null;

  const trends = await matchTrends(
    match.id,
    myPred ? { homeScore: myPred.homeScore, awayScore: myPred.awayScore } : null,
  );
  res.json({ ...trends, locked: isLocked(match) });
});

// GET /matches/:id/comparison — popular outcomes + scorelines. Only revealed
// once the match has kicked off; before then no scorelines are exposed.
router.get("/matches/:id/comparison", async (req, res) => {
  const match = await db.query.matchesTable.findFirst({
    where: eq(matchesTable.id, req.params.id),
  });
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }

  const revealed = isLocked(match);
  if (!revealed) {
    res.json({
      matchId: match.id,
      revealed: false,
      total: 0,
      outcomes: [],
      scorelines: [],
    });
    return;
  }

  const comparison = await matchComparison(match.id);
  res.json({ ...comparison, revealed: true });
});

// ---------- Challenge-scoped match endpoints ----------

function canViewChallenge(
  visibility: string,
  ownerId: string,
  viewerId: string | null,
  isParticipant: boolean,
): boolean {
  if (visibility === "public" || visibility === "unlisted") return true;
  return viewerId === ownerId || isParticipant;
}

// GET /challenges/:challengeId/matches — matches in a challenge with my picks.
router.get("/challenges/:challengeId/matches", async (req, res) => {
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.challengeId),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }

  const isParticipant = viewerId
    ? Boolean(
        await db.query.challengeParticipantsTable.findFirst({
          where: and(
            eq(challengeParticipantsTable.challengeId, challenge.id),
            eq(challengeParticipantsTable.userId, viewerId),
            eq(challengeParticipantsTable.status, "active"),
          ),
        }),
      )
    : false;

  if (
    !canViewChallenge(
      challenge.visibility,
      challenge.ownerId,
      viewerId,
      isParticipant,
    )
  ) {
    res.status(403).json({ error: "Not permitted to view this challenge" });
    return;
  }

  const matchIds = await matchIdsForChallenge(challenge);
  const loaded = await loadMatches(matchIds);
  const preds = await myPredictions(
    viewerId,
    loaded.map((l) => l.match.id),
  );
  const now = new Date();
  res.json(
    loaded.map((l) =>
      serializeMatchSummary(
        {
          match: l.match,
          homeTeam: l.homeTeam,
          awayTeam: l.awayTeam,
          stageType: l.stageType,
          myPrediction: preds.get(l.match.id) ?? null,
        },
        now,
      ),
    ),
  );
});

// GET /challenges/:challengeId/matches/:matchId — challenge match detail with
// participant predictions (revealed after kickoff per visibility rules).
router.get(
  "/challenges/:challengeId/matches/:matchId",
  async (req, res) => {
    const record = await getOrProvisionUser(req);
    const viewerId = record?.user.id ?? null;

    const challenge = await db.query.challengesTable.findFirst({
      where: eq(challengesTable.id, req.params.challengeId),
    });
    if (!challenge) {
      res.status(404).json({ error: "Challenge not found" });
      return;
    }

    const isParticipant = viewerId
      ? Boolean(
          await db.query.challengeParticipantsTable.findFirst({
            where: and(
              eq(challengeParticipantsTable.challengeId, challenge.id),
              eq(challengeParticipantsTable.userId, viewerId),
              eq(challengeParticipantsTable.status, "active"),
            ),
          }),
        )
      : false;

    if (
      !canViewChallenge(
        challenge.visibility,
        challenge.ownerId,
        viewerId,
        isParticipant,
      )
    ) {
      res.status(403).json({ error: "Not permitted to view this challenge" });
      return;
    }

    // Enforce challenge scope: the match must belong to this challenge's set of
    // matches. Otherwise a viewer could request any match id and read this
    // challenge's participant predictions for matches outside its scope.
    const challengeMatchIds = await matchIdsForChallenge(challenge);
    if (!challengeMatchIds.includes(req.params.matchId)) {
      res.status(404).json({ error: "Match not found in this challenge" });
      return;
    }

    const loaded = await loadOneMatch(req.params.matchId);
    if (!loaded) {
      res.status(404).json({ error: "Match not found" });
      return;
    }
    const { match } = loaded;

    const myPred = viewerId
      ? ((await db.query.predictionsTable.findFirst({
          where: and(
            eq(predictionsTable.userId, viewerId),
            eq(predictionsTable.matchId, match.id),
          ),
        })) ?? null)
      : null;

    // Reveal rule: never before kickoff; after kickoff, only when the challenge
    // visibility is reveal_after_kickoff (else stays hidden).
    const revealed =
      hasKickedOff(match) &&
      challenge.predictionVisibility === "reveal_after_kickoff";

    let participantPredictions: ParticipantPredictionDto[] = [];
    if (revealed) {
      const rows = await db
        .select({
          userId: predictionsTable.userId,
          homeScore: predictionsTable.homeScore,
          awayScore: predictionsTable.awayScore,
          outcome: predictionsTable.outcome,
          pointsAwarded: predictionsTable.pointsAwarded,
          displayName: profilesTable.displayName,
          avatarUrl: profilesTable.avatarUrl,
        })
        .from(predictionsTable)
        .innerJoin(
          challengeParticipantsTable,
          and(
            eq(challengeParticipantsTable.userId, predictionsTable.userId),
            eq(challengeParticipantsTable.challengeId, challenge.id),
            eq(challengeParticipantsTable.status, "active"),
          ),
        )
        .leftJoin(profilesTable, eq(profilesTable.userId, predictionsTable.userId))
        .where(eq(predictionsTable.matchId, match.id));

      participantPredictions = rows.map((r) => ({
        userId: r.userId,
        displayName: r.displayName ?? null,
        avatarUrl: r.avatarUrl ?? null,
        homeScore: r.homeScore,
        awayScore: r.awayScore,
        outcome: r.outcome,
        pointsAwarded: r.pointsAwarded,
      }));
    }

    res.json(
      serializeMatchDetail(
        {
          match,
          homeTeam: loaded.homeTeam,
          awayTeam: loaded.awayTeam,
          stageType: loaded.stageType,
          myPrediction: myPred,
        },
        { revealed, participantPredictions },
      ),
    );
  },
);

export default router;
