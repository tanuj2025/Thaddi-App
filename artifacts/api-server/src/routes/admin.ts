import { Router, type IRouter, type Response } from "express";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  seedReferenceData,
  usersTable,
  profilesTable,
  tournamentsTable,
  stagesTable,
  matchesTable,
  teamsTable,
  challengesTable,
  challengeParticipantsTable,
  predictionsTable,
  subscriptionsTable,
  plansTable,
  planEntitlementsTable,
  challengeBadgeCatalogTable,
  challengePurchasedBadgesTable,
  auditLogsTable,
  type Tournament,
  type Stage,
  type Match,
  type Team,
  type User,
  type Profile,
  type AuditLog,
} from "@workspace/db";
import {
  AdminCreateTournamentBody,
  AdminUpdateTournamentBody,
  AdminCreateStageBody,
  AdminUpdateStageBody,
  AdminUpdateMatchBody,
  AdminUpdateTeamBody,
  AdminUpdateUserBody,
  AdminUpdateChallengeBody,
  AdminUpdateSubscriptionBody,
  AdminCreatePlanBody,
  AdminUpdatePlanBody,
  AdminCreateChallengeBadgeBody,
  AdminUpdateChallengeBadgeBody,
} from "@workspace/api-zod";
import { requireAdminUser } from "../lib/currentUser";
import { recordAudit } from "../lib/audit";
import { ENFORCED_ENTITLEMENT_KEYS } from "../lib/entitlements";
import {
  getFootballProvider,
  isLiveProviderConfigured,
} from "../services/football";
import { syncTournament } from "../services/football/sync";
import { applyScoringForFinalMatches } from "../services/scoring/engine";
import {
  runPostScoring,
  runScheduledNotifications,
} from "../services/scoring/afterScoring";
import {
  getDemoStatus,
  getDemoActivity,
  seedDemoData,
  teardownDemoData,
  advanceDemoClock,
  DemoAlreadyActiveError,
} from "../services/demo/harness";
import { demoDataExists } from "../services/demo/engine";
import { AdminAdvanceDemoBody } from "@workspace/api-zod";
import { isProductionEnv } from "../services/demo/config";

const router: IRouter = Router();

const homeTeamAlias = alias(teamsTable, "admin_home_team");
const awayTeamAlias = alias(teamsTable, "admin_away_team");

// Coerce an OpenAPI date-time string into a Date, or undefined when absent and
// null when explicitly cleared.
function toDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Clamp pagination inputs to safe bounds.
function pagination(req: { query: Record<string, unknown> }, maxLimit: number) {
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { limit, offset };
}

// ---------- Serializers ----------

function serializeTournament(t: Tournament, stageCount: number, matchCount: number) {
  return {
    id: t.id,
    slug: t.slug,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    type: t.type,
    season: t.season ?? null,
    status: t.status,
    logoUrl: t.logoUrl ?? null,
    startDate: t.startDate ?? null,
    endDate: t.endDate ?? null,
    externalProvider: t.externalProvider ?? null,
    externalId: t.externalId ?? null,
    isActive: t.isActive,
    stageCount,
    matchCount,
  };
}

function serializeStage(s: Stage) {
  return {
    id: s.id,
    tournamentId: s.tournamentId,
    nameEn: s.nameEn,
    nameAr: s.nameAr,
    type: s.type,
    orderIndex: s.orderIndex,
    startDate: s.startDate ?? null,
    endDate: s.endDate ?? null,
  };
}

function serializeTeamRef(t: Team | null) {
  if (!t) return null;
  return {
    id: t.id,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    flagUrl: t.flagUrl ?? null,
  };
}

function serializeMatch(match: Match, home: Team | null, away: Team | null) {
  return {
    id: match.id,
    tournamentId: match.tournamentId,
    stageId: match.stageId ?? null,
    homeTeam: serializeTeamRef(home),
    awayTeam: serializeTeamRef(away),
    kickoffAt: match.kickoffAt,
    status: match.status,
    homeScore: match.homeScore ?? null,
    awayScore: match.awayScore ?? null,
    minute: match.minute ?? null,
    venue: match.venue ?? null,
    externalId: match.externalId ?? null,
  };
}

function serializeTeam(t: Team) {
  return {
    id: t.id,
    nameEn: t.nameEn,
    nameAr: t.nameAr,
    code: t.code ?? null,
    flagUrl: t.flagUrl ?? null,
    countryCode: t.countryCode ?? null,
    externalId: t.externalId ?? null,
  };
}

function serializeUser(user: User, profile: Profile | null) {
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: profile?.displayName ?? null,
    username: profile?.username ?? null,
    realName: user.realName ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    mobileNumber: user.mobileNumber ?? null,
    role: user.role,
    status: user.status,
    level: user.level,
    totalPoints: user.totalPoints,
    emailVerified: user.emailVerified,
    mobileVerified: user.mobileVerified,
    countryCode: user.countryCode ?? null,
    createdAt: user.createdAt,
  };
}

function serializeAuditLog(log: AuditLog, actorName: string | null) {
  return {
    id: log.id,
    actorUserId: log.actorUserId ?? null,
    actorName,
    action: log.action,
    entityType: log.entityType ?? null,
    entityId: log.entityId ?? null,
    metadata: (log.metadata as Record<string, unknown> | null) ?? null,
    ip: log.ip ?? null,
    userAgent: log.userAgent ?? null,
    createdAt: log.createdAt,
  };
}

// ---------- Overview ----------

router.get("/admin/overview", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;

  const [
    [users],
    [admins],
    [suspended],
    [tournaments],
    [matches],
    [teams],
    [challenges],
    [activeChallenges],
    [predictions],
    [subscriptions],
    [activeSubscriptions],
  ] = await Promise.all([
    db.select({ value: count() }).from(usersTable),
    db.select({ value: count() }).from(usersTable).where(eq(usersTable.role, "admin")),
    db.select({ value: count() }).from(usersTable).where(eq(usersTable.status, "suspended")),
    db.select({ value: count() }).from(tournamentsTable),
    db.select({ value: count() }).from(matchesTable),
    db.select({ value: count() }).from(teamsTable),
    db.select({ value: count() }).from(challengesTable),
    db.select({ value: count() }).from(challengesTable).where(eq(challengesTable.status, "active")),
    db.select({ value: count() }).from(predictionsTable),
    db.select({ value: count() }).from(subscriptionsTable),
    db.select({ value: count() }).from(subscriptionsTable).where(eq(subscriptionsTable.status, "active")),
  ]);

  res.json({
    totalUsers: users?.value ?? 0,
    totalAdmins: admins?.value ?? 0,
    suspendedUsers: suspended?.value ?? 0,
    totalTournaments: tournaments?.value ?? 0,
    totalMatches: matches?.value ?? 0,
    totalTeams: teams?.value ?? 0,
    totalChallenges: challenges?.value ?? 0,
    activeChallenges: activeChallenges?.value ?? 0,
    totalPredictions: predictions?.value ?? 0,
    totalSubscriptions: subscriptions?.value ?? 0,
    activeSubscriptions: activeSubscriptions?.value ?? 0,
    provider: getFootballProvider().name,
    liveProviderConfigured: isLiveProviderConfigured(),
  });
});

// ---------- Tournaments & stages ----------

async function countsForTournaments(
  ids: string[],
): Promise<{ stages: Map<string, number>; matches: Map<string, number> }> {
  const stages = new Map<string, number>();
  const matches = new Map<string, number>();
  if (ids.length === 0) return { stages, matches };
  const stageRows = await db
    .select({ id: stagesTable.tournamentId, value: count() })
    .from(stagesTable)
    .where(inArray(stagesTable.tournamentId, ids))
    .groupBy(stagesTable.tournamentId);
  for (const r of stageRows) stages.set(r.id, r.value);
  const matchRows = await db
    .select({ id: matchesTable.tournamentId, value: count() })
    .from(matchesTable)
    .where(inArray(matchesTable.tournamentId, ids))
    .groupBy(matchesTable.tournamentId);
  for (const r of matchRows) matches.set(r.id, r.value);
  return { stages, matches };
}

router.get("/admin/tournaments", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const rows = await db
    .select()
    .from(tournamentsTable)
    .orderBy(desc(tournamentsTable.createdAt));
  const { stages, matches } = await countsForTournaments(rows.map((t) => t.id));
  res.json(
    rows.map((t) => serializeTournament(t, stages.get(t.id) ?? 0, matches.get(t.id) ?? 0)),
  );
});

router.post("/admin/tournaments", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminCreateTournamentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid tournament" });
    return;
  }
  const data = parsed.data;
  const existing = await db.query.tournamentsTable.findFirst({
    where: eq(tournamentsTable.slug, data.slug),
  });
  if (existing) {
    res.status(409).json({ error: "Slug already exists" });
    return;
  }
  const [created] = await db
    .insert(tournamentsTable)
    .values({
      slug: data.slug,
      nameEn: data.nameEn,
      nameAr: data.nameAr,
      type: data.type ?? "other",
      season: data.season ?? null,
      status: data.status ?? "upcoming",
      logoUrl: data.logoUrl ?? null,
      startDate: toDate(data.startDate) ?? null,
      endDate: toDate(data.endDate) ?? null,
    })
    .returning();
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "tournament.create",
      entityType: "tournament",
      entityId: created.id,
      metadata: { slug: created.slug },
    },
    req,
  );
  res.status(201).json(serializeTournament(created, 0, 0));
});

router.patch("/admin/tournaments/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdateTournamentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.tournamentsTable.findFirst({
    where: eq(tournamentsTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  const d = parsed.data;
  const [updated] = await db
    .update(tournamentsTable)
    .set({
      ...(d.nameEn !== undefined ? { nameEn: d.nameEn } : {}),
      ...(d.nameAr !== undefined ? { nameAr: d.nameAr } : {}),
      ...(d.type !== undefined ? { type: d.type } : {}),
      ...(d.season !== undefined ? { season: d.season } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.logoUrl !== undefined ? { logoUrl: d.logoUrl } : {}),
      ...(d.startDate !== undefined ? { startDate: toDate(d.startDate) ?? null } : {}),
      ...(d.endDate !== undefined ? { endDate: toDate(d.endDate) ?? null } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tournamentsTable.id, existing.id))
    .returning();
  const { stages, matches } = await countsForTournaments([updated.id]);
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "tournament.update",
      entityType: "tournament",
      entityId: updated.id,
      metadata: d,
    },
    req,
  );
  res.json(serializeTournament(updated, stages.get(updated.id) ?? 0, matches.get(updated.id) ?? 0));
});

router.get("/admin/tournaments/:id/stages", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const rows = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.tournamentId, req.params.id))
    .orderBy(asc(stagesTable.orderIndex));
  res.json(rows.map(serializeStage));
});

router.post("/admin/tournaments/:id/stages", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminCreateStageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid stage" });
    return;
  }
  const tournament = await db.query.tournamentsTable.findFirst({
    where: eq(tournamentsTable.id, req.params.id),
  });
  if (!tournament) {
    res.status(404).json({ error: "Tournament not found" });
    return;
  }
  const d = parsed.data;
  const [created] = await db
    .insert(stagesTable)
    .values({
      tournamentId: tournament.id,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      type: d.type,
      orderIndex: d.orderIndex ?? 0,
      startDate: toDate(d.startDate) ?? null,
      endDate: toDate(d.endDate) ?? null,
    })
    .returning();
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "stage.create",
      entityType: "stage",
      entityId: created.id,
      metadata: { tournamentId: tournament.id },
    },
    req,
  );
  res.status(201).json(serializeStage(created));
});

router.patch("/admin/stages/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdateStageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.stagesTable.findFirst({
    where: eq(stagesTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Stage not found" });
    return;
  }
  const d = parsed.data;
  const [updated] = await db
    .update(stagesTable)
    .set({
      ...(d.nameEn !== undefined ? { nameEn: d.nameEn } : {}),
      ...(d.nameAr !== undefined ? { nameAr: d.nameAr } : {}),
      ...(d.type !== undefined ? { type: d.type } : {}),
      ...(d.orderIndex !== undefined ? { orderIndex: d.orderIndex } : {}),
      ...(d.startDate !== undefined ? { startDate: toDate(d.startDate) ?? null } : {}),
      ...(d.endDate !== undefined ? { endDate: toDate(d.endDate) ?? null } : {}),
    })
    .where(eq(stagesTable.id, existing.id))
    .returning();
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "stage.update",
      entityType: "stage",
      entityId: updated.id,
      metadata: d,
    },
    req,
  );
  res.json(serializeStage(updated));
});

// ---------- Matches ----------

router.get("/admin/matches", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const { limit, offset } = pagination(req, 500);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = status
    ? eq(matchesTable.status, status as Match["status"])
    : undefined;

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(matchesTable).where(where),
    db
      .select({ match: matchesTable, home: homeTeamAlias, away: awayTeamAlias })
      .from(matchesTable)
      .leftJoin(homeTeamAlias, eq(matchesTable.homeTeamId, homeTeamAlias.id))
      .leftJoin(awayTeamAlias, eq(matchesTable.awayTeamId, awayTeamAlias.id))
      .where(where)
      .orderBy(asc(matchesTable.kickoffAt))
      .limit(limit)
      .offset(offset),
  ]);

  res.json({
    matches: rows.map((r) => serializeMatch(r.match, r.home, r.away)),
    total: total?.value ?? 0,
  });
});

router.patch("/admin/matches/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdateMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.matchesTable.findFirst({
    where: eq(matchesTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  const d = parsed.data;
  const kickoff = toDate(d.kickoffAt);
  const [updated] = await db
    .update(matchesTable)
    .set({
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.homeScore !== undefined ? { homeScore: d.homeScore } : {}),
      ...(d.awayScore !== undefined ? { awayScore: d.awayScore } : {}),
      ...(d.minute !== undefined ? { minute: d.minute } : {}),
      ...(kickoff ? { kickoffAt: kickoff, predictionLockAt: new Date(kickoff.getTime() - 30 * 60 * 1000) } : {}),
      ...(d.venue !== undefined ? { venue: d.venue } : {}),
      updatedAt: new Date(),
    })
    .where(eq(matchesTable.id, existing.id))
    .returning();

  const [row] = await db
    .select({ match: matchesTable, home: homeTeamAlias, away: awayTeamAlias })
    .from(matchesTable)
    .leftJoin(homeTeamAlias, eq(matchesTable.homeTeamId, homeTeamAlias.id))
    .leftJoin(awayTeamAlias, eq(matchesTable.awayTeamId, awayTeamAlias.id))
    .where(eq(matchesTable.id, updated.id))
    .limit(1);

  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "match.update",
      entityType: "match",
      entityId: updated.id,
      metadata: d,
    },
    req,
  );
  res.json(serializeMatch(row.match, row.home, row.away));
});

// ---------- Teams ----------

router.get("/admin/teams", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const rows = await db.select().from(teamsTable).orderBy(asc(teamsTable.nameEn));
  res.json(rows.map(serializeTeam));
});

router.patch("/admin/teams/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.teamsTable.findFirst({
    where: eq(teamsTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  const d = parsed.data;
  const [updated] = await db
    .update(teamsTable)
    .set({
      ...(d.nameEn !== undefined ? { nameEn: d.nameEn } : {}),
      ...(d.nameAr !== undefined ? { nameAr: d.nameAr } : {}),
      ...(d.code !== undefined ? { code: d.code } : {}),
      ...(d.flagUrl !== undefined ? { flagUrl: d.flagUrl } : {}),
      ...(d.countryCode !== undefined ? { countryCode: d.countryCode } : {}),
    })
    .where(eq(teamsTable.id, existing.id))
    .returning();
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "team.update",
      entityType: "team",
      entityId: updated.id,
      metadata: d,
    },
    req,
  );
  res.json(serializeTeam(updated));
});

// ---------- Football data sync ----------

router.get("/admin/sync/status", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const [[teams], [matches], [latest]] = await Promise.all([
    db.select({ value: count() }).from(teamsTable),
    db.select({ value: count() }).from(matchesTable),
    db
      .select({ updatedAt: matchesTable.updatedAt })
      .from(matchesTable)
      .orderBy(desc(matchesTable.updatedAt))
      .limit(1),
  ]);
  res.json({
    provider: getFootballProvider().name,
    liveProviderConfigured: isLiveProviderConfigured(),
    totalTeams: teams?.value ?? 0,
    totalMatches: matches?.value ?? 0,
    lastMatchUpdatedAt: latest?.updatedAt ?? null,
  });
});

router.post("/admin/sync", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const sync = await syncTournament();
  // Score any finished matches and run post-scoring side effects, mirroring the
  // public refresh cycle (there is no background scheduler).
  const scored = await applyScoringForFinalMatches();
  await runPostScoring(scored);
  await runScheduledNotifications();
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "sync.trigger",
      entityType: "tournament",
      entityId: null,
      metadata: {
        provider: sync.provider,
        teamsUpserted: sync.teamsUpserted,
        matchesUpserted: sync.matchesUpserted,
        teamsPruned: sync.teamsPruned,
        matchesPruned: sync.matchesPruned,
      },
    },
    req,
  );
  res.json({
    provider: sync.provider,
    teamsUpserted: sync.teamsUpserted,
    matchesUpserted: sync.matchesUpserted,
    teamsPruned: sync.teamsPruned,
    matchesPruned: sync.matchesPruned,
    skipped: Boolean(sync.skipped),
  });
});

// ---------- Live demo-data testing harness ----------
// Seeds dummy matches on a compressed clock and reuses the real scoring engine
// so the owner can fully test prediction -> live -> scoring -> rankings without
// waiting for real matches. Disabled entirely in production.

// Guards a demo endpoint: 403 in production. Returns true when the request was
// rejected so the caller can `return` early.
function rejectIfDemoDisabled(res: Response): boolean {
  if (isProductionEnv()) {
    res.status(403).json({ error: "Demo harness is disabled in production" });
    return true;
  }
  return false;
}

router.get("/admin/demo/status", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  if (rejectIfDemoDisabled(res)) return;
  res.json(await getDemoStatus());
});

router.get("/admin/demo/activity", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  if (rejectIfDemoDisabled(res)) return;
  res.json({ events: await getDemoActivity() });
});

router.post("/admin/demo/seed", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  if (rejectIfDemoDisabled(res)) return;
  try {
    const status = await seedDemoData(admin.user.id);
    await recordAudit(
      {
        actorUserId: admin.user.id,
        action: "demo.seed",
        entityType: "system",
        entityId: null,
        metadata: {
          totalMatches: status.totalMatches,
          challenges: status.challenges,
          users: status.users,
        },
      },
      req,
    );
    res.json(status);
  } catch (err) {
    if (err instanceof DemoAlreadyActiveError) {
      res.status(409).json({ error: "Demo data is already active" });
      return;
    }
    throw err;
  }
});

router.post("/admin/demo/teardown", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  if (rejectIfDemoDisabled(res)) return;
  const status = await teardownDemoData();
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "demo.teardown",
      entityType: "system",
      entityId: null,
      metadata: null,
    },
    req,
  );
  res.json(status);
});

// Fast-forward the demo clock and/or force-finish currently-live matches.
// Reuses the real scoring path via the engine's tick. Non-production only.
router.post("/admin/demo/advance", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  if (rejectIfDemoDisabled(res)) return;
  const parsed = AdminAdvanceDemoBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid advance request" });
    return;
  }
  if (!(await demoDataExists())) {
    res.status(409).json({ error: "No demo data is active" });
    return;
  }
  const status = await advanceDemoClock({
    minutes: parsed.data.minutes,
    finishLive: parsed.data.finishLive,
  });
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "demo.advance",
      entityType: "system",
      entityId: null,
      metadata: {
        minutes: parsed.data.minutes ?? 0,
        finishLive: Boolean(parsed.data.finishLive),
      },
    },
    req,
  );
  res.json(status);
});

// ---------- Reference data seeding ----------

// Idempotently tops up missing reference rows (badges, plans, levels, etc.) in
// the connected database. Every insert uses onConflictDoNothing, so existing
// rows are never modified or deleted — only genuinely missing rows are added.
// This lets an admin bring a live database's reference data up to date (e.g.
// after a deploy that added a new catalog) without a destructive data overwrite.
router.post("/admin/seed-reference-data", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const summary = await seedReferenceData();
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "reference_data.seed",
      entityType: "system",
      entityId: null,
      metadata: { ...summary },
    },
    req,
  );
  res.json(summary);
});

// ---------- Users ----------

router.get("/admin/users", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const { limit, offset } = pagination(req, 200);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const role = typeof req.query.role === "string" ? req.query.role : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const conditions = [];
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(usersTable.email, like),
        ilike(usersTable.realName, like),
        ilike(profilesTable.displayName, like),
        ilike(profilesTable.username, like),
      ),
    );
  }
  if (role === "user" || role === "admin") conditions.push(eq(usersTable.role, role));
  if (status === "active" || status === "suspended" || status === "deleted") {
    conditions.push(eq(usersTable.status, status));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [[total], rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(usersTable)
      .leftJoin(profilesTable, eq(profilesTable.userId, usersTable.id))
      .where(where),
    db
      .select({ user: usersTable, profile: profilesTable })
      .from(usersTable)
      .leftJoin(profilesTable, eq(profilesTable.userId, usersTable.id))
      .where(where)
      .orderBy(desc(usersTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  res.json({
    users: rows.map((r) => serializeUser(r.user, r.profile)),
    total: total?.value ?? 0,
  });
});

async function loadUserDetail(userId: string) {
  const [row] = await db
    .select({ user: usersTable, profile: profilesTable })
    .from(usersTable)
    .leftJoin(profilesTable, eq(profilesTable.userId, usersTable.id))
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!row) return null;
  const [[owned], [joined], [preds], [subs]] = await Promise.all([
    db.select({ value: count() }).from(challengesTable).where(eq(challengesTable.ownerId, userId)),
    db
      .select({ value: count() })
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.userId, userId),
          eq(challengeParticipantsTable.status, "active"),
        ),
      ),
    db.select({ value: count() }).from(predictionsTable).where(eq(predictionsTable.userId, userId)),
    db.select({ value: count() }).from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)),
  ]);
  return {
    ...serializeUser(row.user, row.profile),
    challengesOwned: owned?.value ?? 0,
    challengesJoined: joined?.value ?? 0,
    predictionsCount: preds?.value ?? 0,
    subscriptionsCount: subs?.value ?? 0,
  };
}

router.get("/admin/users/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const detail = await loadUserDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(detail);
});

router.patch("/admin/users/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const d = parsed.data;
  // Guard: an admin cannot strip their own admin role or suspend themselves,
  // preventing an accidental self-lockout from the admin panel.
  if (existing.id === admin.user.id) {
    if (d.role !== undefined && d.role !== "admin") {
      res.status(400).json({ error: "You cannot remove your own admin role" });
      return;
    }
    if (d.status !== undefined && d.status !== "active") {
      res.status(400).json({ error: "You cannot deactivate your own account" });
      return;
    }
  }
  await db
    .update(usersTable)
    .set({
      ...(d.role !== undefined ? { role: d.role } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, existing.id));
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "user.update",
      entityType: "user",
      entityId: existing.id,
      metadata: d,
    },
    req,
  );
  const detail = await loadUserDetail(existing.id);
  res.json(detail);
});

// ---------- Challenges ----------

router.get("/admin/challenges", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const { limit, offset } = pagination(req, 200);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const visibility = typeof req.query.visibility === "string" ? req.query.visibility : undefined;

  const conditions = [];
  if (q) conditions.push(ilike(challengesTable.name, `%${q}%`));
  if (["draft", "active", "completed", "cancelled"].includes(status ?? "")) {
    conditions.push(eq(challengesTable.status, status as "draft" | "active" | "completed" | "cancelled"));
  }
  if (["private", "unlisted", "public"].includes(visibility ?? "")) {
    conditions.push(eq(challengesTable.visibility, visibility as "private" | "unlisted" | "public"));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const ownerProfile = alias(profilesTable, "owner_profile");
  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(challengesTable).where(where),
    db
      .select({ challenge: challengesTable, ownerName: ownerProfile.displayName })
      .from(challengesTable)
      .leftJoin(ownerProfile, eq(ownerProfile.userId, challengesTable.ownerId))
      .where(where)
      .orderBy(desc(challengesTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const ids = rows.map((r) => r.challenge.id);
  const counts = new Map<string, number>();
  if (ids.length) {
    const partRows = await db
      .select({ id: challengeParticipantsTable.challengeId, value: count() })
      .from(challengeParticipantsTable)
      .where(
        and(
          inArray(challengeParticipantsTable.challengeId, ids),
          eq(challengeParticipantsTable.status, "active"),
        ),
      )
      .groupBy(challengeParticipantsTable.challengeId);
    for (const r of partRows) counts.set(r.id, r.value);
  }

  res.json({
    challenges: rows.map((r) => ({
      id: r.challenge.id,
      name: r.challenge.name,
      ownerId: r.challenge.ownerId,
      ownerName: r.ownerName ?? null,
      type: r.challenge.type,
      visibility: r.challenge.visibility,
      scope: r.challenge.scope,
      status: r.challenge.status,
      participantCount: counts.get(r.challenge.id) ?? 0,
      createdAt: r.challenge.createdAt,
    })),
    total: total?.value ?? 0,
  });
});

router.patch("/admin/challenges/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdateChallengeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.challengesTable.findFirst({
    where: eq(challengesTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Challenge not found" });
    return;
  }
  const d = parsed.data;
  const [updated] = await db
    .update(challengesTable)
    .set({
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.visibility !== undefined ? { visibility: d.visibility } : {}),
      updatedAt: new Date(),
    })
    .where(eq(challengesTable.id, existing.id))
    .returning();
  const [[participants], ownerRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, updated.id),
          eq(challengeParticipantsTable.status, "active"),
        ),
      ),
    db
      .select({ displayName: profilesTable.displayName })
      .from(profilesTable)
      .where(eq(profilesTable.userId, updated.ownerId))
      .limit(1),
  ]);
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "challenge.update",
      entityType: "challenge",
      entityId: updated.id,
      metadata: d,
    },
    req,
  );
  res.json({
    id: updated.id,
    name: updated.name,
    ownerId: updated.ownerId,
    ownerName: ownerRows[0]?.displayName ?? null,
    type: updated.type,
    visibility: updated.visibility,
    scope: updated.scope,
    status: updated.status,
    participantCount: participants?.value ?? 0,
    createdAt: updated.createdAt,
  });
});

// ---------- Plans (packages) ----------

const PLAN_CODE_RE = /^[a-z0-9_]+$/;
const ENFORCED_KEYS = new Set<string>(ENFORCED_ENTITLEMENT_KEYS);

// Keeps only recognized (enforced) entitlement keys, de-duplicated. Display-only
// marketing lines live on `displayFeatures`, never here.
function sanitizeEntitlements(
  entitlements: { key: string; value: string }[] | undefined,
): { key: string; value: string }[] {
  if (!entitlements) return [];
  const seen = new Set<string>();
  const out: { key: string; value: string }[] = [];
  for (const e of entitlements) {
    if (!ENFORCED_KEYS.has(e.key) || seen.has(e.key)) continue;
    seen.add(e.key);
    out.push({ key: e.key, value: e.value });
  }
  return out;
}

async function fetchPlanResponse(planId: string) {
  const p = await db.query.plansTable.findFirst({
    where: eq(plansTable.id, planId),
  });
  if (!p) return null;
  const ents = await db
    .select({
      key: planEntitlementsTable.key,
      value: planEntitlementsTable.value,
    })
    .from(planEntitlementsTable)
    .where(eq(planEntitlementsTable.planId, planId));
  return {
    id: p.id,
    code: p.code,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    priceSar: p.priceSar,
    participantLimit: p.participantLimit ?? null,
    isActive: p.isActive,
    isComingSoon: p.isComingSoon,
    orderIndex: p.orderIndex,
    entitlements: ents,
    displayFeatures: p.displayFeatures ?? [],
  };
}

router.get("/admin/plans", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const plans = await db
    .select()
    .from(plansTable)
    .orderBy(asc(plansTable.orderIndex));
  const ents = plans.length
    ? await db
        .select()
        .from(planEntitlementsTable)
        .where(
          inArray(
            planEntitlementsTable.planId,
            plans.map((p) => p.id),
          ),
        )
    : [];
  const byPlan = new Map<string, { key: string; value: string }[]>();
  for (const e of ents) {
    const list = byPlan.get(e.planId) ?? [];
    list.push({ key: e.key, value: e.value });
    byPlan.set(e.planId, list);
  }
  res.json({
    plans: plans.map((p) => ({
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      priceSar: p.priceSar,
      participantLimit: p.participantLimit ?? null,
      isActive: p.isActive,
      isComingSoon: p.isComingSoon,
      orderIndex: p.orderIndex,
      entitlements: byPlan.get(p.id) ?? [],
      displayFeatures: p.displayFeatures ?? [],
    })),
  });
});

router.post("/admin/plans", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminCreatePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }
  const code = parsed.data.code.trim().toLowerCase();
  if (!PLAN_CODE_RE.test(code)) {
    res.status(400).json({
      error: "Code must use only lowercase letters, numbers, or underscores",
    });
    return;
  }
  const existing = await db.query.plansTable.findFirst({
    where: eq(plansTable.code, code),
  });
  if (existing) {
    res.status(409).json({ error: "A package with this code already exists" });
    return;
  }
  const participantLimit = parsed.data.participantLimit ?? null;
  const newId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(plansTable)
      .values({
        code,
        nameEn: parsed.data.nameEn,
        nameAr: parsed.data.nameAr,
        priceSar: parsed.data.priceSar,
        participantLimit,
        isActive: parsed.data.isActive ?? true,
        isComingSoon: parsed.data.isComingSoon ?? false,
        orderIndex: parsed.data.orderIndex ?? 0,
        displayFeatures: parsed.data.displayFeatures ?? [],
      })
      .returning({ id: plansTable.id });
    const entitlements = sanitizeEntitlements(parsed.data.entitlements);
    if (participantLimit != null) {
      entitlements.push({
        key: "max_participants",
        value: String(participantLimit),
      });
    }
    if (entitlements.length) {
      await tx
        .insert(planEntitlementsTable)
        .values(
          entitlements.map((e) => ({
            planId: row.id,
            key: e.key,
            value: e.value,
          })),
        );
    }
    return row.id;
  });
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "plan.create",
      entityType: "plan",
      entityId: newId,
      metadata: { code },
    },
    req,
  );
  res.status(201).json(await fetchPlanResponse(newId));
});

router.patch("/admin/plans/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdatePlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.plansTable.findFirst({
    where: eq(plansTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Package not found" });
    return;
  }
  const d = parsed.data;
  const effectiveLimit =
    d.participantLimit !== undefined
      ? (d.participantLimit ?? null)
      : (existing.participantLimit ?? null);

  await db.transaction(async (tx) => {
    const set: Record<string, unknown> = {};
    if (d.nameEn !== undefined) set.nameEn = d.nameEn;
    if (d.nameAr !== undefined) set.nameAr = d.nameAr;
    if (d.priceSar !== undefined) set.priceSar = d.priceSar;
    if (d.participantLimit !== undefined)
      set.participantLimit = d.participantLimit ?? null;
    if (d.isActive !== undefined) set.isActive = d.isActive;
    if (d.isComingSoon !== undefined) set.isComingSoon = d.isComingSoon;
    if (d.orderIndex !== undefined) set.orderIndex = d.orderIndex;
    if (d.displayFeatures !== undefined) set.displayFeatures = d.displayFeatures;
    if (Object.keys(set).length) {
      await tx.update(plansTable).set(set).where(eq(plansTable.id, existing.id));
    }

    if (d.entitlements !== undefined) {
      // Full replace of enforced entitlements, re-deriving max_participants.
      await tx
        .delete(planEntitlementsTable)
        .where(eq(planEntitlementsTable.planId, existing.id));
      const entitlements = sanitizeEntitlements(d.entitlements);
      if (effectiveLimit != null) {
        entitlements.push({
          key: "max_participants",
          value: String(effectiveLimit),
        });
      }
      if (entitlements.length) {
        await tx
          .insert(planEntitlementsTable)
          .values(
            entitlements.map((e) => ({
              planId: existing.id,
              key: e.key,
              value: e.value,
            })),
          );
      }
    } else if (d.participantLimit !== undefined) {
      // Only the limit changed — keep the mirrored entitlement in sync.
      await tx
        .delete(planEntitlementsTable)
        .where(
          and(
            eq(planEntitlementsTable.planId, existing.id),
            eq(planEntitlementsTable.key, "max_participants"),
          ),
        );
      if (effectiveLimit != null) {
        await tx.insert(planEntitlementsTable).values({
          planId: existing.id,
          key: "max_participants",
          value: String(effectiveLimit),
        });
      }
    }
  });

  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "plan.update",
      entityType: "plan",
      entityId: existing.id,
      metadata: d as Record<string, unknown>,
    },
    req,
  );
  res.json(await fetchPlanResponse(existing.id));
});

router.delete("/admin/plans/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const existing = await db.query.plansTable.findFirst({
    where: eq(plansTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Package not found" });
    return;
  }
  if (existing.code === "free") {
    res
      .status(400)
      .json({ error: "The Free package is required and cannot be deleted" });
    return;
  }
  const [used] = await db
    .select({ value: count() })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.planId, existing.id));
  if ((used?.value ?? 0) > 0) {
    res
      .status(409)
      .json({ error: "This package is used by existing subscriptions" });
    return;
  }
  await db.delete(plansTable).where(eq(plansTable.id, existing.id));
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "plan.delete",
      entityType: "plan",
      entityId: existing.id,
      metadata: { code: existing.code },
    },
    req,
  );
  res.status(204).end();
});

// ---------- Challenge badges (decorative, purchasable) ----------

const BADGE_CODE_RE = /^[a-z0-9_]+$/;

function serializeAdminBadge(b: {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  iconUrl: string;
  priceSar: string;
  isActive: boolean;
  orderIndex: number;
}) {
  return {
    id: b.id,
    code: b.code,
    nameEn: b.nameEn,
    nameAr: b.nameAr,
    iconUrl: b.iconUrl,
    priceSar: b.priceSar,
    isActive: b.isActive,
    orderIndex: b.orderIndex,
  };
}

router.get("/admin/challenge-badges", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const rows = await db
    .select()
    .from(challengeBadgeCatalogTable)
    .orderBy(asc(challengeBadgeCatalogTable.orderIndex));
  res.json({ badges: rows.map(serializeAdminBadge) });
});

router.post("/admin/challenge-badges", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminCreateChallengeBadgeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid badge" });
    return;
  }
  const code = parsed.data.code.trim().toLowerCase();
  if (!BADGE_CODE_RE.test(code)) {
    res.status(400).json({
      error: "Code must use only lowercase letters, numbers, or underscores",
    });
    return;
  }
  const existing = await db.query.challengeBadgeCatalogTable.findFirst({
    where: eq(challengeBadgeCatalogTable.code, code),
  });
  if (existing) {
    res.status(409).json({ error: "A badge with this code already exists" });
    return;
  }
  const [row] = await db
    .insert(challengeBadgeCatalogTable)
    .values({
      code,
      nameEn: parsed.data.nameEn,
      nameAr: parsed.data.nameAr,
      iconUrl: parsed.data.iconUrl,
      priceSar: parsed.data.priceSar,
      isActive: parsed.data.isActive ?? true,
      orderIndex: parsed.data.orderIndex ?? 0,
    })
    .returning();
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "challenge_badge.create",
      entityType: "challenge_badge",
      entityId: row.id,
      metadata: { code },
    },
    req,
  );
  res.status(201).json(serializeAdminBadge(row));
});

router.patch("/admin/challenge-badges/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdateChallengeBadgeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.challengeBadgeCatalogTable.findFirst({
    where: eq(challengeBadgeCatalogTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Badge not found" });
    return;
  }
  const d = parsed.data;
  const set: Record<string, unknown> = {};
  if (d.nameEn !== undefined) set.nameEn = d.nameEn;
  if (d.nameAr !== undefined) set.nameAr = d.nameAr;
  if (d.iconUrl !== undefined) set.iconUrl = d.iconUrl;
  if (d.priceSar !== undefined) set.priceSar = d.priceSar;
  if (d.isActive !== undefined) set.isActive = d.isActive;
  if (d.orderIndex !== undefined) set.orderIndex = d.orderIndex;
  if (Object.keys(set).length) {
    set.updatedAt = new Date();
    await db
      .update(challengeBadgeCatalogTable)
      .set(set)
      .where(eq(challengeBadgeCatalogTable.id, existing.id));
  }
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "challenge_badge.update",
      entityType: "challenge_badge",
      entityId: existing.id,
      metadata: d as Record<string, unknown>,
    },
    req,
  );
  const updated = await db.query.challengeBadgeCatalogTable.findFirst({
    where: eq(challengeBadgeCatalogTable.id, existing.id),
  });
  res.json(serializeAdminBadge(updated!));
});

router.delete("/admin/challenge-badges/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const existing = await db.query.challengeBadgeCatalogTable.findFirst({
    where: eq(challengeBadgeCatalogTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Badge not found" });
    return;
  }
  const [used] = await db
    .select({ value: count() })
    .from(challengePurchasedBadgesTable)
    .where(eq(challengePurchasedBadgesTable.badgeId, existing.id));
  if ((used?.value ?? 0) > 0) {
    res
      .status(409)
      .json({ error: "This badge has been purchased and cannot be deleted" });
    return;
  }
  await db
    .delete(challengeBadgeCatalogTable)
    .where(eq(challengeBadgeCatalogTable.id, existing.id));
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "challenge_badge.delete",
      entityType: "challenge_badge",
      entityId: existing.id,
      metadata: { code: existing.code },
    },
    req,
  );
  res.status(204).end();
});

// ---------- Subscriptions ----------

function serializeSubscriptionRow(r: {
  sub: typeof subscriptionsTable.$inferSelect;
  userName: string | null;
  planCode: string | null;
  planNameEn: string | null;
  planNameAr: string | null;
}) {
  return {
    id: r.sub.id,
    userId: r.sub.userId,
    userName: r.userName ?? null,
    planCode: r.planCode ?? null,
    planNameEn: r.planNameEn ?? null,
    planNameAr: r.planNameAr ?? null,
    edition: r.sub.edition ?? null,
    status: r.sub.status,
    startedAt: r.sub.startedAt,
    expiresAt: r.sub.expiresAt ?? null,
    paymentProvider: r.sub.paymentProvider ?? null,
    paymentReference: r.sub.paymentReference ?? null,
    createdAt: r.sub.createdAt,
  };
}

router.get("/admin/subscriptions", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const { limit, offset } = pagination(req, 200);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const where = ["active", "expired", "cancelled"].includes(status ?? "")
    ? eq(subscriptionsTable.status, status as "active" | "expired" | "cancelled")
    : undefined;

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(subscriptionsTable).where(where),
    db
      .select({
        sub: subscriptionsTable,
        userName: profilesTable.displayName,
        planCode: plansTable.code,
        planNameEn: plansTable.nameEn,
        planNameAr: plansTable.nameAr,
      })
      .from(subscriptionsTable)
      .leftJoin(profilesTable, eq(profilesTable.userId, subscriptionsTable.userId))
      .leftJoin(plansTable, eq(plansTable.id, subscriptionsTable.planId))
      .where(where)
      .orderBy(desc(subscriptionsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  res.json({
    subscriptions: rows.map(serializeSubscriptionRow),
    total: total?.value ?? 0,
  });
});

router.patch("/admin/subscriptions/:id", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const parsed = AdminUpdateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  const existing = await db.query.subscriptionsTable.findFirst({
    where: eq(subscriptionsTable.id, req.params.id),
  });
  if (!existing) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  await db
    .update(subscriptionsTable)
    .set({ status: parsed.data.status })
    .where(eq(subscriptionsTable.id, existing.id));
  await recordAudit(
    {
      actorUserId: admin.user.id,
      action: "subscription.update",
      entityType: "subscription",
      entityId: existing.id,
      metadata: parsed.data,
    },
    req,
  );
  const [row] = await db
    .select({
      sub: subscriptionsTable,
      userName: profilesTable.displayName,
      planCode: plansTable.code,
      planNameEn: plansTable.nameEn,
      planNameAr: plansTable.nameAr,
    })
    .from(subscriptionsTable)
    .leftJoin(profilesTable, eq(profilesTable.userId, subscriptionsTable.userId))
    .leftJoin(plansTable, eq(plansTable.id, subscriptionsTable.planId))
    .where(eq(subscriptionsTable.id, existing.id))
    .limit(1);
  res.json(serializeSubscriptionRow(row));
});

// ---------- Audit logs ----------

router.get("/admin/audit-logs", async (req, res) => {
  const admin = await requireAdminUser(req, res);
  if (!admin) return;
  const { limit, offset } = pagination(req, 200);
  const actorUserId =
    typeof req.query.actorUserId === "string" && req.query.actorUserId.trim()
      ? req.query.actorUserId.trim()
      : undefined;
  const action = typeof req.query.action === "string" && req.query.action.trim()
    ? req.query.action.trim()
    : undefined;
  const entityType =
    typeof req.query.entityType === "string" && req.query.entityType.trim()
      ? req.query.entityType.trim()
      : undefined;
  const from = toDate(
    typeof req.query.from === "string" && req.query.from ? req.query.from : undefined,
  );
  const to = toDate(
    typeof req.query.to === "string" && req.query.to ? req.query.to : undefined,
  );

  const conditions = [];
  if (actorUserId) conditions.push(eq(auditLogsTable.actorUserId, actorUserId));
  if (action) conditions.push(eq(auditLogsTable.action, action));
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
  if (from) conditions.push(sql`${auditLogsTable.createdAt} >= ${from}`);
  if (to) conditions.push(sql`${auditLogsTable.createdAt} <= ${to}`);
  const where = conditions.length ? and(...conditions) : undefined;

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(auditLogsTable).where(where),
    db
      .select({ log: auditLogsTable, actorName: profilesTable.displayName })
      .from(auditLogsTable)
      .leftJoin(profilesTable, eq(profilesTable.userId, auditLogsTable.actorUserId))
      .where(where)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  res.json({
    logs: rows.map((r) => serializeAuditLog(r.log, r.actorName ?? null)),
    total: total?.value ?? 0,
  });
});

export default router;
