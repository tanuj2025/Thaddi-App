import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  challengesTable,
  challengeParticipantsTable,
  challengeAssistantsTable,
  challengePrizesTable,
  challengeMatchesTable,
  challengeMessagesTable,
  challengeTemplatesTable,
  challengeBadgeCatalogTable,
  challengePurchasedBadgesTable,
  pointsLedgerTable,
  rankingsTable,
  userAchievementsTable,
  profilesTable,
  matchesTable,
  teamsTable,
  predictionsTable,
  type Challenge as ChallengeRow,
  type ChallengePrize as ChallengePrizeRow,
} from "@workspace/db";
import { matchIdsForChallenge } from "../lib/challengeMatches";
import { hasKickedOff, toTeamRef } from "../lib/matchSerializers";
import {
  CreateChallengeBody,
  UpdateChallengeBody,
  JoinChallengeBody,
  RemoveParticipantBody,
  PromoteAssistantBody,
  DemoteAssistantBody,
  PostChallengeMessageBody,
} from "@workspace/api-zod";
import {
  requireCurrentUser,
  requireActivatedUser,
  getOrProvisionUser,
} from "../lib/currentUser";
import { getUserPlan, hasEntitlement } from "../lib/entitlements";
import {
  acquireOwnerPoolLock,
  countActiveParticipantsForOwner,
} from "../lib/participantPool";
import { generateInviteCode, inviteLinkFor } from "../lib/invite";
import { recordEvent } from "../lib/analytics";
import {
  createInvoice,
  isPaymentsConfigured,
} from "../services/payments/moyasar";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Sentinel used to roll back a join transaction when the owner's shared
// participant pool is full; translated to a 409 response by the join handler.
class ParticipantLimitError extends Error {}

// Chat message limits. Plain text + emoji only; length is enforced server-side
// because the OpenAPI/zod contract only types `body` as a string.
const MAX_MESSAGE_LENGTH = 1000;
const DEFAULT_MESSAGE_PAGE = 50;
const MAX_MESSAGE_PAGE = 100;

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

// True when the user is an assistant of the challenge. Assistant rows only
// exist for participants (composite FK), so existence is sufficient.
async function isChallengeAssistant(
  challengeId: string,
  userId: string,
): Promise<boolean> {
  const row = await db.query.challengeAssistantsTable.findFirst({
    where: and(
      eq(challengeAssistantsTable.challengeId, challengeId),
      eq(challengeAssistantsTable.userId, userId),
    ),
  });
  return Boolean(row);
}

// Member management is allowed for the owner OR an active assistant. This is
// the single source of truth for "can manage members" used by the
// participant-removal flow and surfaced in the challenge detail response.
async function canManageMembers(
  challenge: ChallengeRow,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  if (challenge.ownerId === userId) return true;
  return isChallengeAssistant(challenge.id, userId);
}

// The set of user ids that are assistants of a challenge (for serializing
// assistant status on a participant list).
async function assistantUserIds(challengeId: string): Promise<Set<string>> {
  const rows = await db
    .select({ userId: challengeAssistantsTable.userId })
    .from(challengeAssistantsTable)
    .where(eq(challengeAssistantsTable.challengeId, challengeId));
  return new Set(rows.map((r) => r.userId));
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

interface PurchasedBadgeMini {
  id: string;
  badgeId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  iconUrl: string;
  createdAt: Date;
}

// Batch-loads the shared per-challenge badge sets joined to their catalog rows.
async function badgesByChallenge(
  challengeIds: string[],
): Promise<Map<string, PurchasedBadgeMini[]>> {
  const map = new Map<string, PurchasedBadgeMini[]>();
  if (challengeIds.length === 0) return map;
  const rows = await db
    .select({
      id: challengePurchasedBadgesTable.id,
      challengeId: challengePurchasedBadgesTable.challengeId,
      badgeId: challengeBadgeCatalogTable.id,
      code: challengeBadgeCatalogTable.code,
      nameEn: challengeBadgeCatalogTable.nameEn,
      nameAr: challengeBadgeCatalogTable.nameAr,
      iconUrl: challengeBadgeCatalogTable.iconUrl,
      createdAt: challengePurchasedBadgesTable.createdAt,
    })
    .from(challengePurchasedBadgesTable)
    .innerJoin(
      challengeBadgeCatalogTable,
      eq(challengePurchasedBadgesTable.badgeId, challengeBadgeCatalogTable.id),
    )
    .where(inArray(challengePurchasedBadgesTable.challengeId, challengeIds))
    .orderBy(
      challengeBadgeCatalogTable.orderIndex,
      challengePurchasedBadgesTable.createdAt,
    );
  for (const r of rows) {
    const list = map.get(r.challengeId) ?? [];
    list.push({
      id: r.id,
      badgeId: r.badgeId,
      code: r.code,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      iconUrl: r.iconUrl,
      createdAt: r.createdAt,
    });
    map.set(r.challengeId, list);
  }
  return map;
}

function serializePurchasedBadge(b: PurchasedBadgeMini) {
  return {
    id: b.id,
    badgeId: b.badgeId,
    code: b.code,
    nameEn: b.nameEn,
    nameAr: b.nameAr,
    iconUrl: b.iconUrl,
    createdAt: b.createdAt,
  };
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
  badges: PurchasedBadgeMini[],
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
    badges: badges.map(serializePurchasedBadge),
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
  let isAssistant = false;
  if (viewerUserId) {
    const member = await db.query.challengeParticipantsTable.findFirst({
      where: and(
        eq(challengeParticipantsTable.challengeId, c.id),
        eq(challengeParticipantsTable.userId, viewerUserId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    });
    isParticipant = Boolean(member);
    if (viewerUserId !== c.ownerId) {
      isAssistant = await isChallengeAssistant(c.id, viewerUserId);
    }
  }
  const isOwner = viewerUserId === c.ownerId;

  const badges = (await badgesByChallenge([c.id])).get(c.id) ?? [];

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
    isOwner,
    isParticipant,
    isAssistant,
    canManageMembers: isOwner || isAssistant,
    prizes: prizeRows.map(serializePrize),
    badges: badges.map(serializePurchasedBadge),
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

  // Creating a challenge auto-adds the owner as the first participant, which
  // consumes a seat from the owner's shared participant pool. Serialize against
  // concurrent joins/creations for the same owner with the advisory lock and
  // re-check the pool inside the transaction so the owner can never exceed the
  // plan limit. A null plan limit means unlimited.
  let challenge: ChallengeRow;
  try {
    challenge = await db.transaction(async (tx) => {
      await acquireOwnerPoolLock(tx, record.user.id);

      if (plan.participantLimit != null) {
        const used = await countActiveParticipantsForOwner(tx, record.user.id);
        // +1 for the owner's own seat in the new challenge.
        if (used + 1 > plan.participantLimit) {
          throw new ParticipantLimitError();
        }
      }

      const [row] = await tx
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
      await tx.insert(challengeParticipantsTable).values({
        challengeId: row.id,
        userId: record.user.id,
        status: "active",
      });

      if (scope === "custom" && body.matchIds && body.matchIds.length > 0) {
        await tx
          .insert(challengeMatchesTable)
          .values(
            body.matchIds.map((matchId) => ({
              challengeId: row.id,
              matchId,
            })),
          )
          .onConflictDoNothing();
      }

      if (prizes.length > 0) {
        await tx.insert(challengePrizesTable).values(
          prizes.map((p) => ({
            challengeId: row.id,
            place: p.place,
            titleEn: p.titleEn ?? null,
            titleAr: p.titleAr ?? null,
            description: p.description ?? null,
            value: p.value ?? null,
            currency: p.currency ?? "SAR",
          })),
        );
      }

      return row;
    });
  } catch (err) {
    if (err instanceof ParticipantLimitError) {
      res.status(403).json({
        error: "You've reached your plan's total participant capacity",
        code: "owner_pool_full",
      });
      return;
    }
    throw err;
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
  const badges = await badgesByChallenge(all.map((c) => c.id));

  res.json({
    owned: owned.map((c) =>
      summarize(
        c,
        participants.get(c.id) ?? 0,
        prizes.get(c.id) ?? 0,
        names.get(c.ownerId) ?? null,
        badges.get(c.id) ?? [],
      ),
    ),
    joined: joined.map((c) =>
      summarize(
        c,
        participants.get(c.id) ?? 0,
        prizes.get(c.id) ?? 0,
        names.get(c.ownerId) ?? null,
        badges.get(c.id) ?? [],
      ),
    ),
  });
});

// Discovery of active challenges. Lists both public AND private challenges so
// users can find that a private challenge exists, but private challenges can
// only be joined by entering the invite code. Guests may browse.
router.get("/challenges/discover", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const featured = req.query.featured === "true";

  // Identify the viewer (if any) so we only reveal invite codes to challenges
  // they already own or have joined — private codes must never leak via Discover.
  const record = await getOrProvisionUser(req);
  const viewerId = record?.user.id ?? null;

  const discoverable = inArray(challengesTable.visibility, [
    "public",
    "private",
  ]);
  const where = q
    ? and(
        discoverable,
        eq(challengesTable.status, "active"),
        ilike(challengesTable.name, `%${q}%`),
      )
    : and(discoverable, eq(challengesTable.status, "active"));

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
  const badges = await badgesByChallenge(rows.map((c) => c.id));

  // Which of these challenges is the viewer an active member of? Only members
  // and owners are allowed to see the invite code.
  const memberIds = new Set<string>();
  if (viewerId && rows.length > 0) {
    const memberRows = await db
      .select({ challengeId: challengeParticipantsTable.challengeId })
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.userId, viewerId),
          eq(challengeParticipantsTable.status, "active"),
          inArray(
            challengeParticipantsTable.challengeId,
            rows.map((c) => c.id),
          ),
        ),
      );
    for (const r of memberRows) memberIds.add(r.challengeId);
  }

  // Most-popular first (participant count), stable by recency.
  let result = rows
    .map((c) => {
      const summary = summarize(
        c,
        participants.get(c.id) ?? 0,
        prizes.get(c.id) ?? 0,
        names.get(c.ownerId) ?? null,
        badges.get(c.id) ?? [],
      );
      // Strip the invite code for anyone who isn't already the owner or an
      // active member, so private codes are never exposed through Discover.
      const isMember = c.ownerId === viewerId || memberIds.has(c.id);
      if (!isMember) summary.inviteCode = null;
      return summary;
    })
    .sort((a, b) => b.participantCount - a.participantCount);

  // Featured surface: the most popular challenges, curated to a short
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

// Public catalog of purchasable decorative badges (active only). Guests allowed.
router.get("/challenge-badges", async (_req, res) => {
  const rows = await db
    .select()
    .from(challengeBadgeCatalogTable)
    .where(eq(challengeBadgeCatalogTable.isActive, true))
    .orderBy(
      challengeBadgeCatalogTable.orderIndex,
      challengeBadgeCatalogTable.createdAt,
    );
  res.json({
    badges: rows.map((b) => ({
      id: b.id,
      code: b.code,
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      iconUrl: b.iconUrl,
      priceSar: b.priceSar,
      orderIndex: b.orderIndex,
    })),
  });
});

// The badges attached to a challenge (shared per-challenge set). Visibility
// mirrors the challenge itself.
router.get("/challenges/:id/badges", async (req, res) => {
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

  const badges = (await badgesByChallenge([challenge.id])).get(challenge.id) ?? [];
  res.json({ badges: badges.map(serializePurchasedBadge) });
});

// Start a Moyasar checkout to buy a badge for a challenge. Only the owner or an
// active participant may buy. The badge becomes part of the shared set on the
// payment callback (see payments.ts), so we reject buying an already-attached
// badge up front.
router.post("/challenges/:id/badges/checkout", async (req, res) => {
  const record = await requireActivatedUser(req, res);
  if (!record) return;

  const badgeId = String(req.body?.badgeId ?? "");
  const callbackUrl = String(req.body?.callbackUrl ?? "");
  if (!badgeId) {
    res.status(400).json({ error: "badgeId is required" });
    return;
  }
  if (!/^https?:\/\//.test(callbackUrl)) {
    res.status(400).json({ error: "A valid callbackUrl is required" });
    return;
  }

  if (!isPaymentsConfigured()) {
    res.status(503).json({ error: "Payments are not configured" });
    return;
  }

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }

  // Gate: only the owner or an active participant may buy badges.
  const isOwner = challenge.ownerId === record.user.id;
  let isParticipant = false;
  if (!isOwner) {
    const member = await db.query.challengeParticipantsTable.findFirst({
      where: and(
        eq(challengeParticipantsTable.challengeId, challenge.id),
        eq(challengeParticipantsTable.userId, record.user.id),
        eq(challengeParticipantsTable.status, "active"),
      ),
    });
    isParticipant = Boolean(member);
  }
  if (!isOwner && !isParticipant) {
    res
      .status(403)
      .json({ error: "Only the owner or an active participant may buy badges" });
    return;
  }

  const badge = await db.query.challengeBadgeCatalogTable.findFirst({
    where: eq(challengeBadgeCatalogTable.id, badgeId),
  });
  if (!badge || !badge.isActive) {
    res.status(400).json({ error: "Badge unavailable" });
    return;
  }
  const amountHalalas = Math.round(Number(badge.priceSar) * 100);
  if (!Number.isFinite(amountHalalas) || amountHalalas <= 0) {
    res.status(400).json({ error: "Badge is not purchasable" });
    return;
  }

  // Reject if already part of the shared per-challenge set.
  const already = await db.query.challengePurchasedBadgesTable.findFirst({
    where: and(
      eq(challengePurchasedBadgesTable.challengeId, challenge.id),
      eq(challengePurchasedBadgesTable.badgeId, badge.id),
    ),
  });
  if (already) {
    res
      .status(409)
      .json({ error: "This badge is already attached to the challenge" });
    return;
  }

  try {
    const invoice = await createInvoice({
      amountHalalas,
      description: `THADDI — ${badge.nameEn} badge`,
      callbackUrl,
      metadata: {
        kind: "challenge_badge",
        userId: record.user.id,
        challengeId: challenge.id,
        badgeId: badge.id,
      },
    });
    res.json({
      paymentId: invoice.id,
      status: invoice.status,
      transactionUrl: invoice.url,
      publishableKey: process.env.MOYASAR_PUBLISHABLE_KEY ?? null,
    });
  } catch (err) {
    logger.error({ err }, "badge checkout failed");
    res.status(502).json({ error: "Could not start payment" });
  }
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
  // each child table's onDelete policy. Earned achievements are PRESERVED but
  // unlinked from the deleted challenge (challengeId -> null), matching the
  // user_achievements FK's onDelete: "set null" — a player keeps the badge
  // they earned even after the challenge it was won in is gone.
  await db.transaction(async (tx) => {
    await tx
      .update(userAchievementsTable)
      .set({ challengeId: null })
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

  // The participant budget is the challenge OWNER's plan limit, shared across
  // ALL of their challenges (not a per-challenge cap). Resolve it before opening
  // the transaction so plan lookups don't hold the lock.
  const ownerPlan = await getUserPlan(challenge.ownerId);

  // Join atomically: serialize concurrent joins for the SAME owner with an
  // advisory lock, then re-count the owner's shared pool inside the transaction
  // so concurrent joins can never exceed the limit.
  let participantId: string;
  try {
    participantId = await db.transaction(async (tx) => {
      await acquireOwnerPoolLock(tx, challenge.ownerId);

      if (ownerPlan.participantLimit != null) {
        const used = await countActiveParticipantsForOwner(
          tx,
          challenge.ownerId,
        );
        if (used >= ownerPlan.participantLimit) {
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
      res.status(409).json({
        error: "The host's plan capacity is full",
        code: "owner_pool_full",
      });
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

  const assistants = await assistantUserIds(challenge.id);

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
      isAssistant: assistants.has(r.userId),
      joinedAt: r.joinedAt,
    })),
  );
});

// Consolidated participant predictions across the challenge's matches
// (visibility-gated, challenge-scoped).
router.get("/challenges/:id/predictions", async (req, res) => {
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

  // Resolve the challenge's match set and load them (with teams) in kickoff
  // order so the consolidated grid reads chronologically.
  const matchIds = await matchIdsForChallenge(challenge);
  const homeTeamAlias = alias(teamsTable, "cp_home_team");
  const awayTeamAlias = alias(teamsTable, "cp_away_team");
  const matchRows = matchIds.length
    ? await db
        .select({
          match: matchesTable,
          home: homeTeamAlias,
          away: awayTeamAlias,
        })
        .from(matchesTable)
        .leftJoin(
          homeTeamAlias,
          eq(matchesTable.homeTeamId, homeTeamAlias.id),
        )
        .leftJoin(
          awayTeamAlias,
          eq(matchesTable.awayTeamId, awayTeamAlias.id),
        )
        .where(inArray(matchesTable.id, matchIds))
        .orderBy(asc(matchesTable.kickoffAt))
    : [];

  const now = new Date();
  // Per-match reveal rule, mirroring the challenge match-detail endpoint:
  //   always_visible       -> everyone, anytime
  //   reveal_after_kickoff -> only once the match has kicked off
  //   hidden               -> never (only the caller's own picks show)
  const revealedByMatch = new Map<string, boolean>();
  const matches = matchRows.map((r) => {
    const revealed =
      challenge.predictionVisibility === "always_visible" ||
      (challenge.predictionVisibility === "reveal_after_kickoff" &&
        hasKickedOff(r.match, now));
    revealedByMatch.set(r.match.id, revealed);
    return {
      matchId: r.match.id,
      homeTeam: toTeamRef(r.home),
      awayTeam: toTeamRef(r.away),
      kickoffAt: r.match.kickoffAt,
      status: r.match.status,
      homeScore: r.match.homeScore ?? null,
      awayScore: r.match.awayScore ?? null,
      hasKickedOff: hasKickedOff(r.match, now),
      revealed,
    };
  });

  // Active participants, ranked by points (matches the leaderboard ordering).
  const participantRows = await db
    .select({
      userId: challengeParticipantsTable.userId,
      points: challengeParticipantsTable.points,
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

  // All predictions for this challenge's matches by its active participants.
  const participantIds = participantRows.map((p) => p.userId);
  const predRows =
    matchIds.length && participantIds.length
      ? await db
          .select({
            userId: predictionsTable.userId,
            matchId: predictionsTable.matchId,
            homeScore: predictionsTable.homeScore,
            awayScore: predictionsTable.awayScore,
            outcome: predictionsTable.outcome,
            pointsAwarded: predictionsTable.pointsAwarded,
          })
          .from(predictionsTable)
          .where(
            and(
              inArray(predictionsTable.matchId, matchIds),
              inArray(predictionsTable.userId, participantIds),
            ),
          )
      : [];

  const byUser = new Map<string, typeof predRows>();
  for (const p of predRows) {
    const list = byUser.get(p.userId) ?? [];
    list.push(p);
    byUser.set(p.userId, list);
  }

  const participants = participantRows.map((p) => {
    const own = p.userId === viewerId;
    const predictions = (byUser.get(p.userId) ?? [])
      // Reveal a prediction only when the match is revealed to everyone, or it
      // belongs to the caller (own picks are always visible to oneself).
      .filter((pred) => own || revealedByMatch.get(pred.matchId))
      .map((pred) => ({
        matchId: pred.matchId,
        homeScore: pred.homeScore,
        awayScore: pred.awayScore,
        outcome: pred.outcome,
        pointsAwarded: pred.pointsAwarded,
      }));
    return {
      userId: p.userId,
      displayName: p.displayName ?? null,
      username: p.username ?? null,
      avatarUrl: p.avatarUrl ?? null,
      isOwner: p.userId === challenge.ownerId,
      points: p.points,
      predictions,
    };
  });

  res.json({
    predictionVisibility: challenge.predictionVisibility,
    matches,
    participants,
  });
});

// Remove a participant (owner or assistant). Assistants and owners can both
// manage members, but neither can remove the owner, an assistant, or themselves
// through this flow — an assistant must be demoted first.
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
  if (!(await canManageMembers(challenge, record.user.id))) {
    res.status(403).json({ error: "Not permitted to manage members" });
    return;
  }
  if (parsed.data.userId === challenge.ownerId) {
    res.status(400).json({ error: "Cannot remove the owner" });
    return;
  }
  if (parsed.data.userId === record.user.id) {
    res.status(400).json({ error: "Cannot remove yourself" });
    return;
  }
  if (await isChallengeAssistant(challenge.id, parsed.data.userId)) {
    res
      .status(400)
      .json({ error: "Demote this assistant before removing them" });
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

// Leave a challenge (participant self-removal; mirrors the owner-only remove
// route but scoped to the caller's own participation).
router.post("/challenges/:id/leave", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }
  // The owner cannot leave; they delete the challenge instead.
  if (challenge.ownerId === record.user.id) {
    res.status(403).json({ error: "The owner cannot leave their own challenge" });
    return;
  }

  // Reject anyone who is not an active participant.
  const membership = await db.query.challengeParticipantsTable.findFirst({
    where: and(
      eq(challengeParticipantsTable.challengeId, challenge.id),
      eq(challengeParticipantsTable.userId, record.user.id),
      eq(challengeParticipantsTable.status, "active"),
    ),
  });
  if (!membership) {
    res.status(404).json({ error: "Not a participant" });
    return;
  }

  // Remove the participant and all of their challenge-scoped standing in one
  // transaction so no orphaned ledger/ranking/achievement rows remain.
  await db.transaction(async (tx) => {
    await tx
      .delete(userAchievementsTable)
      .where(
        and(
          eq(userAchievementsTable.challengeId, challenge.id),
          eq(userAchievementsTable.userId, record.user.id),
        ),
      );
    await tx
      .delete(rankingsTable)
      .where(
        and(
          eq(rankingsTable.challengeId, challenge.id),
          eq(rankingsTable.userId, record.user.id),
        ),
      );
    await tx
      .delete(pointsLedgerTable)
      .where(
        and(
          eq(pointsLedgerTable.challengeId, challenge.id),
          eq(pointsLedgerTable.userId, record.user.id),
        ),
      );
    await tx
      .delete(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, challenge.id),
          eq(challengeParticipantsTable.userId, record.user.id),
          ne(challengeParticipantsTable.userId, challenge.ownerId),
        ),
      );
  });

  res.json({ success: true });
});

// Promote a participant to assistant (owner only). The target must be an
// active participant of this challenge.
router.post("/challenges/:id/assistants", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = PromoteAssistantBody.safeParse(req.body);
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
    res.status(400).json({ error: "The owner cannot be an assistant" });
    return;
  }

  // Target must be an active participant of THIS challenge.
  const participant = await db.query.challengeParticipantsTable.findFirst({
    where: and(
      eq(challengeParticipantsTable.challengeId, challenge.id),
      eq(challengeParticipantsTable.userId, parsed.data.userId),
      eq(challengeParticipantsTable.status, "active"),
    ),
  });
  if (!participant) {
    res
      .status(400)
      .json({ error: "Only active participants can be made assistants" });
    return;
  }

  await db
    .insert(challengeAssistantsTable)
    .values({
      challengeId: challenge.id,
      userId: parsed.data.userId,
      assignedByUserId: record.user.id,
    })
    .onConflictDoNothing({
      target: [
        challengeAssistantsTable.challengeId,
        challengeAssistantsTable.userId,
      ],
    });

  res.json({ success: true });
});

// Demote an assistant back to a regular participant (owner only).
router.post("/challenges/:id/assistants/remove", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = DemoteAssistantBody.safeParse(req.body);
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

  await db
    .delete(challengeAssistantsTable)
    .where(
      and(
        eq(challengeAssistantsTable.challengeId, challenge.id),
        eq(challengeAssistantsTable.userId, parsed.data.userId),
      ),
    );

  res.json({ success: true });
});

// ---------- chat messages ----------

// List chat messages for a challenge (visibility-gated read). Returns the most
// recent page oldest-to-newest; pass `before=<messageId>` to load older ones.
router.get("/challenges/:id/messages", async (req, res) => {
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
    res.status(403).json({ error: "Not permitted" });
    return;
  }

  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_MESSAGE_PAGE)
    : DEFAULT_MESSAGE_PAGE;

  // Cursor: anchor on the timestamp (and id, to break ties) of `before`.
  let cursor: { createdAt: Date; id: string } | null = null;
  if (typeof req.query.before === "string" && req.query.before) {
    const anchor = await db.query.challengeMessagesTable.findFirst({
      where: and(
        eq(challengeMessagesTable.id, req.query.before),
        eq(challengeMessagesTable.challengeId, challenge.id),
      ),
    });
    if (anchor) cursor = { createdAt: anchor.createdAt, id: anchor.id };
  }

  const conditions = [
    eq(challengeMessagesTable.challengeId, challenge.id),
    sql`${challengeMessagesTable.deletedAt} is null`,
  ];
  if (cursor) {
    conditions.push(
      sql`(${challengeMessagesTable.createdAt}, ${challengeMessagesTable.id}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
    );
  }

  // Fetch newest-first with one extra row to detect older history.
  const rows = await db
    .select({
      id: challengeMessagesTable.id,
      body: challengeMessagesTable.body,
      createdAt: challengeMessagesTable.createdAt,
      authorId: challengeMessagesTable.authorId,
      displayName: profilesTable.displayName,
      username: profilesTable.username,
      avatarUrl: profilesTable.avatarUrl,
    })
    .from(challengeMessagesTable)
    .leftJoin(
      profilesTable,
      eq(profilesTable.userId, challengeMessagesTable.authorId),
    )
    .where(and(...conditions))
    .orderBy(
      desc(challengeMessagesTable.createdAt),
      desc(challengeMessagesTable.id),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse();

  const isOwner = viewerId === challenge.ownerId;
  const canPost = isOwner || isParticipant;

  res.json({
    messages: page.map((m) => ({
      id: m.id,
      challengeId: challenge.id,
      body: m.body,
      createdAt: m.createdAt,
      author: {
        id: m.authorId,
        displayName: m.displayName ?? null,
        username: m.username ?? null,
        avatarUrl: m.avatarUrl ?? null,
      },
      isOwnMessage: m.authorId === viewerId,
      canDelete: m.authorId === viewerId || isOwner,
    })),
    hasMore,
    canPost,
  });
});

// Post a chat message (active participants/owner only).
router.post("/challenges/:id/messages", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const parsed = PostChallengeMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid message" });
    return;
  }
  const body = parsed.data.body.trim();
  if (!body) {
    res.status(400).json({ error: "Message cannot be empty" });
    return;
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: "Message is too long" });
    return;
  }

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }

  // Only active members (the owner is always a participant) may post.
  const member = await db.query.challengeParticipantsTable.findFirst({
    where: and(
      eq(challengeParticipantsTable.challengeId, challenge.id),
      eq(challengeParticipantsTable.userId, record.user.id),
      eq(challengeParticipantsTable.status, "active"),
    ),
  });
  if (!member) {
    res.status(403).json({ error: "Join the challenge to chat" });
    return;
  }

  const [created] = await db
    .insert(challengeMessagesTable)
    .values({
      challengeId: challenge.id,
      authorId: record.user.id,
      body,
    })
    .returning();

  const profile = await db.query.profilesTable.findFirst({
    where: eq(profilesTable.userId, record.user.id),
  });

  res.status(201).json({
    id: created.id,
    challengeId: challenge.id,
    body: created.body,
    createdAt: created.createdAt,
    author: {
      id: record.user.id,
      displayName: profile?.displayName ?? null,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
    },
    isOwnMessage: true,
    canDelete: true,
  });
});

// Soft-delete a chat message (author or challenge owner) for moderation.
router.post("/challenges/:id/messages/:messageId/delete", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;

  const challenge = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!challenge) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }

  const message = await db.query.challengeMessagesTable.findFirst({
    where: and(
      eq(challengeMessagesTable.id, req.params.messageId),
      eq(challengeMessagesTable.challengeId, challenge.id),
    ),
  });
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const isAuthor = message.authorId === record.user.id;
  const isOwner = challenge.ownerId === record.user.id;
  if (!isAuthor && !isOwner) {
    res.status(403).json({ error: "Not permitted" });
    return;
  }

  // Idempotent: already-deleted messages report success.
  if (!message.deletedAt) {
    await db
      .update(challengeMessagesTable)
      .set({ deletedAt: new Date(), deletedByUserId: record.user.id })
      .where(eq(challengeMessagesTable.id, message.id));
  }

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

  // Fullness reflects the OWNER's shared participant pool (their plan limit
  // across all their challenges), not this challenge's snapshotted limit.
  const ownerPlan = await getUserPlan(challenge.ownerId);
  const ownerPoolUsed = await countActiveParticipantsForOwner(
    db,
    challenge.ownerId,
  );
  const isFull =
    ownerPlan.participantLimit != null &&
    ownerPoolUsed >= ownerPlan.participantLimit;

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
