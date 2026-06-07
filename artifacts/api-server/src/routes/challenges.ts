import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  challengesTable,
  challengeParticipantsTable,
  challengePrizesTable,
  challengeMatchesTable,
  challengeTemplatesTable,
  pointsLedgerTable,
  rankingsTable,
  userAchievementsTable,
  profilesTable,
  type Challenge as ChallengeRow,
  type ChallengePrize as ChallengePrizeRow,
} from "@workspace/db";
import {
  CreateChallengeBody,
  UpdateChallengeBody,
  JoinChallengeBody,
  RemoveParticipantBody,
} from "@workspace/api-zod";
import {
  requireCurrentUser,
  requireActivatedUser,
  getOrProvisionUser,
} from "../lib/currentUser";
import { getUserPlan, hasEntitlement } from "../lib/entitlements";
import { generateInviteCode, inviteLinkFor } from "../lib/invite";
import { recordEvent } from "../lib/analytics";

const router: IRouter = Router();

// Sentinel used to roll back a join transaction when the participant limit is
// hit; translated to a 409 response by the join handler.
class ParticipantLimitError extends Error {}

// ---------- aggregate helpers ----------

async function countsByChallenge(
  challengeIds: string[],
): Promise<{ participants: Map<string, number>; prizes: Map<string, number> }> {
  const participants = new Map<string, number>();
  const prizes = new Map<string, number>();
  if (challengeIds.length === 0) return { participants, prizes };

  const pRows = await db
    .select({
      challengeId: challengeParticipantsTable.challengeId,
      value: sql<number>`cast(count(*) as int)`,
    })
    .from(challengeParticipantsTable)
    .where(
      and(
        inArray(challengeParticipantsTable.challengeId, challengeIds),
        eq(challengeParticipantsTable.status, "active"),
      ),
    )
    .groupBy(challengeParticipantsTable.challengeId);
  for (const r of pRows) participants.set(r.challengeId, r.value);

  const zRows = await db
    .select({
      challengeId: challengePrizesTable.challengeId,
      value: sql<number>`cast(count(*) as int)`,
    })
    .from(challengePrizesTable)
    .where(inArray(challengePrizesTable.challengeId, challengeIds))
    .groupBy(challengePrizesTable.challengeId);
  for (const r of zRows) prizes.set(r.challengeId, r.value);

  return { participants, prizes };
}

async function participantCount(challengeId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`cast(count(*) as int)` })
    .from(challengeParticipantsTable)
    .where(
      and(
        eq(challengeParticipantsTable.challengeId, challengeId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    );
  return row?.value ?? 0;
}

async function ownerDisplayNames(
  ownerIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ownerIds.length === 0) return map;
  const rows = await db
    .select({
      userId: profilesTable.userId,
      displayName: profilesTable.displayName,
    })
    .from(profilesTable)
    .where(inArray(profilesTable.userId, ownerIds));
  for (const r of rows) map.set(r.userId, r.displayName ?? null);
  return map;
}

// ---------- serializers ----------

function serializePrize(p: ChallengePrizeRow) {
  return {
    place: p.place,
    titleEn: p.titleEn ?? null,
    titleAr: p.titleAr ?? null,
    description: p.description ?? null,
    value: p.value ?? null,
    currency: p.currency ?? null,
  };
}

function summarize(
  c: ChallengeRow,
  participants: number,
  prizes: number,
  ownerName: string | null,
) {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    type: c.type,
    visibility: c.visibility,
    scope: c.scope,
    status: c.status,
    inviteCode: c.inviteCode ?? null,
    participantCount: participants,
    participantLimit: c.participantLimit ?? null,
    prizeCount: prizes,
    ownerDisplayName: ownerName,
    createdAt: c.createdAt,
  };
}

async function serializeDetail(
  c: ChallengeRow,
  viewerUserId: string | null,
) {
  const ownerProfile = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.userId, c.ownerId),
  });
  const prizeRows = await db
    .select()
    .from(challengePrizesTable)
    .where(eq(challengePrizesTable.challengeId, c.id))
    .orderBy(challengePrizesTable.place);
  const participants = await participantCount(c.id);

  let isParticipant = false;
  if (viewerUserId) {
    const member = await db.query.challengeParticipantsTable.findFirst({
      where: and(
        eq(challengeParticipantsTable.challengeId, c.id),
        eq(challengeParticipantsTable.userId, viewerUserId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    });
    isParticipant = Boolean(member);
  }

  return {
    id: c.id,
    name: c.name,
    description: c.description ?? null,
    type: c.type,
    visibility: c.visibility,
    scope: c.scope,
    status: c.status,
    endCondition: c.endCondition,
    endDate: c.endDate ?? null,
    predictionVisibility: c.predictionVisibility,
    templateId: c.templateId ?? null,
    tournamentId: c.tournamentId ?? null,
    stageId: c.stageId ?? null,
    teamId: c.teamId ?? null,
    inviteCode: c.inviteCode ?? null,
    inviteLink: c.inviteLink ?? null,
    participantLimit: c.participantLimit ?? null,
    participantCount: participants,
    owner: {
      id: c.ownerId,
      displayName: ownerProfile?.displayName ?? null,
      username: ownerProfile?.username ?? null,
      avatarUrl: ownerProfile?.avatarUrl ?? null,
    },
    isOwner: viewerUserId === c.ownerId,
    isParticipant,
    prizes: prizeRows.map(serializePrize),
    createdAt: c.createdAt,
  };
}

function canView(
  c: ChallengeRow,
  viewerUserId: string | null,
  isParticipant: boolean,
): boolean {
  if (c.visibility === "public" || c.visibility === "unlisted") return true;
  // private
  return viewerUserId === c.ownerId || isParticipant;
}

// ---------- routes ----------

// Create a challenge (activated users only).
router.post("/challenges", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;

  const parsed = CreateChallengeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid challenge data" });
    return;
  }
  const body = parsed.data;

  const plan = await getUserPlan(record.user.id);

  const prizes = body.prizes ?? [];
  if (prizes.length > 0 && !hasEntitlement(plan, "custom_prizes")) {
    res
      .status(403)
      .json({ error: "Custom prizes require an upgraded plan" });
    return;
  }

  // Resolve template defaults server-side so the chosen template is
  // authoritative for scope and any config-provided defaults (type,
  // endCondition). Client-sent values fill the gaps the template leaves open.
  let template = null;
  if (body.templateId) {
    template = await db.query.challengeTemplatesTable.findFirst({
      where: eq(challengeTemplatesTable.id, body.templateId),
    });
    if (!template) {
      res.status(400).json({ error: "Unknown template" });
      return;
    }
  }
  const templateConfig = (template?.config ?? {}) as {
    type?: string;
    endCondition?: string;
    predictionVisibility?: string;
  };

  const scope = template?.scope ?? body.scope;
  const type = (templateConfig.type as typeof body.type) ?? body.type;
  const endCondition =
    body.endCondition ??
    (templateConfig.endCondition as typeof body.endCondition) ??
    "tournament_ends";

  const inviteCode = await generateInviteCode();

  const [challenge] = await db
    .insert(challengesTable)
    .values({
      ownerId: record.user.id,
      name: body.name,
      description: body.description ?? null,
      type,
      visibility: body.visibility,
      scope,
      templateId: body.templateId ?? null,
      tournamentId: body.tournamentId ?? null,
      stageId: body.stageId ?? null,
      teamId: body.teamId ?? null,
      endCondition,
      endDate: body.endDate ?? null,
      predictionVisibility:
        body.predictionVisibility ?? "reveal_after_kickoff",
      participantLimit: plan.participantLimit,
      inviteCode,
      inviteLink: inviteLinkFor(inviteCode),
    })
    .returning();

  // Owner is the first participant.
  await db.insert(challengeParticipantsTable).values({
    challengeId: challenge.id,
    userId: record.user.id,
    status: "active",
  });

  if (scope === "custom" && body.matchIds && body.matchIds.length > 0) {
    await db
      .insert(challengeMatchesTable)
      .values(
        body.matchIds.map((matchId) => ({
          challengeId: challenge.id,
          matchId,
        })),
      )
      .onConflictDoNothing();
  }

  if (prizes.length > 0) {
    await db.insert(challengePrizesTable).values(
      prizes.map((p) => ({
        challengeId: challenge.id,
        place: p.place,
        titleEn: p.titleEn ?? null,
        titleAr: p.titleAr ?? null,
        description: p.description ?? null,
        value: p.value ?? null,
        currency: p.currency ?? "SAR",
      })),
    );
  }

  await recordEvent({
    type: "challenge_created",
    userId: record.user.id,
    entityType: "challenge",
    entityId: challenge.id,
  });

  res.status(201).json(await serializeDetail(challenge, record.user.id));
});

// Challenges the user owns or has joined.
router.get("/challenges/mine", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const owned = await db
    .select()
    .from(challengesTable)
    .where(eq(challengesTable.ownerId, record.user.id))
    .orderBy(desc(challengesTable.createdAt));

  const memberRows = await db
    .select({ challengeId: challengeParticipantsTable.challengeId })
    .from(challengeParticipantsTable)
    .where(
      and(
        eq(challengeParticipantsTable.userId, record.user.id),
        eq(challengeParticipantsTable.status, "active"),
      ),
    );
  const ownedIds = new Set(owned.map((c) => c.id));
  const joinedIds = memberRows
    .map((r) => r.challengeId)
    .filter((id) => !ownedIds.has(id));

  const joined = joinedIds.length
    ? await db
        .select()
        .from(challengesTable)
        .where(inArray(challengesTable.id, joinedIds))
        .orderBy(desc(challengesTable.createdAt))
    : [];

  const all = [...owned, ...joined];
  const { participants, prizes } = await countsByChallenge(
    all.map((c) => c.id),
  );
  const names = await ownerDisplayNames([...new Set(all.map((c) => c.ownerId))]);

  res.json({
    owned: owned.map((c) =>
      summarize(
        c,
        participants.get(c.id) ?? 0,
        prizes.get(c.id) ?? 0,
        names.get(c.ownerId) ?? null,
      ),
    ),
    joined: joined.map((c) =>
      summarize(
        c,
        participants.get(c.id) ?? 0,
        prizes.get(c.id) ?? 0,
        names.get(c.ownerId) ?? null,
      ),
    ),
  });
});

// Public discovery of Public-visibility challenges. Guests may browse.
router.get("/challenges/discover", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const featured = req.query.featured === "true";

  const where = q
    ? and(
        eq(challengesTable.visibility, "public"),
        eq(challengesTable.status, "active"),
        ilike(challengesTable.name, `%${q}%`),
      )
    : and(
        eq(challengesTable.visibility, "public"),
        eq(challengesTable.status, "active"),
      );

  const rows = await db
    .select()
    .from(challengesTable)
    .where(where)
    .orderBy(desc(challengesTable.createdAt))
    .limit(featured ? 100 : 50);

  const { participants, prizes } = await countsByChallenge(
    rows.map((c) => c.id),
  );
  const names = await ownerDisplayNames([
    ...new Set(rows.map((c) => c.ownerId)),
  ]);

  // Most-popular first (participant count), stable by recency.
  let result = rows
    .map((c) =>
      summarize(
        c,
        participants.get(c.id) ?? 0,
        prizes.get(c.id) ?? 0,
        names.get(c.ownerId) ?? null,
      ),
    )
    .sort((a, b) => b.participantCount - a.participantCount);

  // Featured surface: the most popular public challenges, curated to a short
  // highlight list for the discovery hero.
  if (featured) result = result.slice(0, 12);

  res.json(result);
});

// Challenge detail (visibility-gated).
router.get("/challenges/:id", async (req, res) => {
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }

  let isParticipant = false;
  if (viewerId) {
    const member = await db.query.challengeParticipantsTable.findFirst({
      where: and(
        eq(challengeParticipantsTable.challengeId, challenge.id),
        eq(challengeParticipantsTable.userId, viewerId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    });
    isParticipant = Boolean(member);
  }

  if (!canView(challenge, viewerId, isParticipant)) {
    res.status(403).json({ error: "Not permitted to view this challenge" });
    return;
  }

  res.json(await serializeDetail(challenge, viewerId));
});

// Update challenge settings (owner only).
router.patch("/challenges/:id", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = UpdateChallengeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid challenge data" });
    return;
  }
  const body = parsed.data;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }
  if (challenge.ownerId !== record.user.id) {
    res.status(403).json({ error: "Not the owner" });
    return;
  }

  // Validate entitlements BEFORE any write so a rejected request never
  // persists partial changes.
  if (body.prizes !== undefined && body.prizes.length > 0) {
    const plan = await getUserPlan(record.user.id);
    if (!hasEntitlement(plan, "custom_prizes")) {
      res.status(403).json({ error: "Custom prizes require an upgraded plan" });
      return;
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.visibility !== undefined) patch.visibility = body.visibility;
  if (body.predictionVisibility !== undefined)
    patch.predictionVisibility = body.predictionVisibility;
  if (body.endCondition !== undefined) patch.endCondition = body.endCondition;
  if (body.endDate !== undefined) patch.endDate = body.endDate;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(challengesTable)
      .set(patch)
      .where(eq(challengesTable.id, challenge.id))
      .returning();

    if (body.prizes !== undefined) {
      await tx
        .delete(challengePrizesTable)
        .where(eq(challengePrizesTable.challengeId, challenge.id));
      if (body.prizes.length > 0) {
        await tx.insert(challengePrizesTable).values(
          body.prizes.map((p) => ({
            challengeId: challenge.id,
            place: p.place,
            titleEn: p.titleEn ?? null,
            titleAr: p.titleAr ?? null,
            description: p.description ?? null,
            value: p.value ?? null,
            currency: p.currency ?? "SAR",
          })),
        );
      }
    }
    return row;
  });

  res.json(await serializeDetail(updated, record.user.id));
});

// Regenerate the invite code (owner only).
router.post("/challenges/:id/regenerate-invite", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }
  if (challenge.ownerId !== record.user.id) {
    res.status(403).json({ error: "Not the owner" });
    return;
  }

  const inviteCode = await generateInviteCode();
  const [updated] = await db
    .update(challengesTable)
    .set({
      inviteCode,
      inviteLink: inviteLinkFor(inviteCode),
      updatedAt: new Date(),
    })
    .where(eq(challengesTable.id, challenge.id))
    .returning();

  res.json(await serializeDetail(updated, record.user.id));
});

// Delete a challenge and all of its related data (owner only).
router.delete("/challenges/:id", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }
  if (challenge.ownerId !== record.user.id) {
    res.status(403).json({ error: "Not the owner" });
    return;
  }

  // Remove every dependent row before the challenge itself, in one
  // transaction, so no orphaned rows or FK violations remain regardless of
  // each child table's onDelete policy.
  await db.transaction(async (tx) => {
    await tx
      .delete(userAchievementsTable)
      .where(eq(userAchievementsTable.challengeId, challenge.id));
    await tx
      .delete(rankingsTable)
      .where(eq(rankingsTable.challengeId, challenge.id));
    await tx
      .delete(pointsLedgerTable)
      .where(eq(pointsLedgerTable.challengeId, challenge.id));
    await tx
      .delete(challengePrizesTable)
      .where(eq(challengePrizesTable.challengeId, challenge.id));
    await tx
      .delete(challengeMatchesTable)
      .where(eq(challengeMatchesTable.challengeId, challenge.id));
    await tx
      .delete(challengeParticipantsTable)
      .where(eq(challengeParticipantsTable.challengeId, challenge.id));
    await tx.delete(challengesTable).where(eq(challengesTable.id, challenge.id));
  });

  res.json({ success: true });
});

// Join a challenge (activated users only).
router.post("/challenges/:id/join", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;

  const parsed = JoinChallengeBody.safeParse(req.body ?? {});
  const body = parsed.success ? parsed.data : {};
  // Invite codes are stored uppercase; normalize submitted codes to match.
  const submittedCode = body.viaCode
    ? body.viaCode.trim().toUpperCase()
    : null;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }
  if (challenge.status !== "active") {
    res.status(409).json({ error: "Challenge is not open" });
    return;
  }

  // Private challenges require the matching invite code.
  if (
    challenge.visibility === "private" &&
    challenge.ownerId !== record.user.id &&
    submittedCode !== challenge.inviteCode
  ) {
    res.status(403).json({ error: "This challenge is private" });
    return;
  }

  // Idempotent: already an active participant.
  const existing = await db.query.challengeParticipantsTable.findFirst({
    where: and(
      eq(challengeParticipantsTable.challengeId, challenge.id),
      eq(challengeParticipantsTable.userId, record.user.id),
    ),
  });
  if (existing && existing.status === "active") {
    res.json({
      success: true,
      challengeId: challenge.id,
      participantId: existing.id,
    });
    return;
  }

  const joinedViaCode = submittedCode;
  const joinedViaLink = body.viaLink ?? null;
  // Best-effort referral attribution: credit the challenge owner.
  const invitedByUserId =
    joinedViaCode || joinedViaLink ? challenge.ownerId : null;

  // Join atomically: lock the challenge row, re-check the participant limit
  // inside the transaction so concurrent joins cannot exceed it.
  let participantId: string;
  try {
    participantId = await db.transaction(async (tx) => {
      await tx
        .select({ id: challengesTable.id })
        .from(challengesTable)
        .where(eq(challengesTable.id, challenge.id))
        .for("update");

      if (challenge.participantLimit != null) {
        const [countRow] = await tx
          .select({ value: sql<number>`cast(count(*) as int)` })
          .from(challengeParticipantsTable)
          .where(
            and(
              eq(challengeParticipantsTable.challengeId, challenge.id),
              eq(challengeParticipantsTable.status, "active"),
            ),
          );
        if ((countRow?.value ?? 0) >= challenge.participantLimit) {
          throw new ParticipantLimitError();
        }
      }

      if (existing) {
        const [reactivated] = await tx
          .update(challengeParticipantsTable)
          .set({
            status: "active",
            joinedViaCode,
            joinedViaLink,
            invitedByUserId,
          })
          .where(eq(challengeParticipantsTable.id, existing.id))
          .returning();
        return reactivated.id;
      }
      const [created] = await tx
        .insert(challengeParticipantsTable)
        .values({
          challengeId: challenge.id,
          userId: record.user.id,
          status: "active",
          joinedViaCode,
          joinedViaLink,
          invitedByUserId,
        })
        .returning();
      return created.id;
    });
  } catch (err) {
    if (err instanceof ParticipantLimitError) {
      res.status(409).json({ error: "Participant limit reached" });
      return;
    }
    throw err;
  }

  await recordEvent({
    type: "challenge_joined",
    userId: record.user.id,
    entityType: "challenge",
    entityId: challenge.id,
  });

  res.json({ success: true, challengeId: challenge.id, participantId });
});

// List participants (visibility-gated).
router.get("/challenges/:id/participants", async (req, res) => {
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }

  let viewerIsParticipant = false;
  if (viewerId) {
    const member = await db.query.challengeParticipantsTable.findFirst({
      where: and(
        eq(challengeParticipantsTable.challengeId, challenge.id),
        eq(challengeParticipantsTable.userId, viewerId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    });
    viewerIsParticipant = Boolean(member);
  }
  if (!canView(challenge, viewerId, viewerIsParticipant)) {
    res.status(403).json({ error: "Not permitted" });
    return;
  }

  const rows = await db
    .select({
      userId: challengeParticipantsTable.userId,
      status: challengeParticipantsTable.status,
      points: challengeParticipantsTable.points,
      rank: challengeParticipantsTable.rank,
      exactPredictions: challengeParticipantsTable.exactPredictions,
      totalPredictions: challengeParticipantsTable.totalPredictions,
      joinedAt: challengeParticipantsTable.joinedAt,
      displayName: profilesTable.displayName,
      username: profilesTable.username,
      avatarUrl: profilesTable.avatarUrl,
    })
    .from(challengeParticipantsTable)
    .leftJoin(
      profilesTable,
      eq(profilesTable.userId, challengeParticipantsTable.userId),
    )
    .where(
      and(
        eq(challengeParticipantsTable.challengeId, challenge.id),
        eq(challengeParticipantsTable.status, "active"),
      ),
    )
    .orderBy(desc(challengeParticipantsTable.points));

  res.json(
    rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName ?? null,
      username: r.username ?? null,
      avatarUrl: r.avatarUrl ?? null,
      status: r.status,
      points: r.points,
      rank: r.rank ?? null,
      exactPredictions: r.exactPredictions,
      totalPredictions: r.totalPredictions,
      isOwner: r.userId === challenge.ownerId,
      joinedAt: r.joinedAt,
    })),
  );
});

// Remove a participant (owner only).
router.post("/challenges/:id/participants/remove", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = RemoveParticipantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing userId" });
    return;
  }

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }
  if (challenge.ownerId !== record.user.id) {
    res.status(403).json({ error: "Not the owner" });
    return;
  }
  if (parsed.data.userId === challenge.ownerId) {
    res.status(400).json({ error: "Cannot remove the owner" });
    return;
  }

  await db
    .delete(challengeParticipantsTable)
    .where(
      and(
        eq(challengeParticipantsTable.challengeId, challenge.id),
        eq(challengeParticipantsTable.userId, parsed.data.userId),
        ne(challengeParticipantsTable.userId, challenge.ownerId),
      ),
    );

  res.json({ success: true });
});

// Public invite preview (no auth required).
router.get("/invite/:code", async (req, res) => {
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.inviteCode, req.params.code.toUpperCase()),
  });
  if (!challenge) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const prizeRows = await db
    .select()
    .from(challengePrizesTable)
    .where(eq(challengePrizesTable.challengeId, challenge.id))
    .orderBy(challengePrizesTable.place);
  const participants = await participantCount(challenge.id);
  const ownerProfile = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.userId, challenge.ownerId),
  });

  let alreadyJoined = false;
  if (viewerId) {
    const member = await db.query.challengeParticipantsTable.findFirst({
      where: and(
        eq(challengeParticipantsTable.challengeId, challenge.id),
        eq(challengeParticipantsTable.userId, viewerId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    });
    alreadyJoined = Boolean(member);
  }

  const isFull =
    challenge.participantLimit != null &&
    participants >= challenge.participantLimit;

  res.json({
    id: challenge.id,
    name: challenge.name,
    description: challenge.description ?? null,
    type: challenge.type,
    status: challenge.status,
    participantCount: participants,
    participantLimit: challenge.participantLimit ?? null,
    prizes: prizeRows.map(serializePrize),
    ownerDisplayName: ownerProfile?.displayName ?? null,
    alreadyJoined,
    isFull,
  });
});

export default router;
