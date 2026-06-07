// Seed / teardown / status for the live demo-data testing harness.
//
// Seeding builds a self-contained demo world (dedicated tournament + stage +
// dummy teams + ~50 matches on a compressed clock + dummy users with pre-filled
// predictions + custom-scope demo challenges) so both the global and the
// challenge prediction -> scoring -> rankings flows are testable immediately.
//
// Teardown removes every demo-tagged row in dependency order inside a
// transaction and recomputes affected real users' totals, restoring the clean
// pre-demo state. Everything is tagged (see config.ts) so the sweep is exact and
// nothing real is ever touched.

import { and, desc, eq, gt, inArray, isNotNull, like, ne, count } from "drizzle-orm";
import {
  db,
  tournamentsTable,
  stagesTable,
  teamsTable,
  matchesTable,
  predictionsTable,
  usersTable,
  profilesTable,
  challengesTable,
  challengeParticipantsTable,
  challengeMatchesTable,
  userAchievementsTable,
  pointsLedgerTable,
  rankingsTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import {
  recomputeUserTotals,
  reconcileUserBadges,
  reconcileTopPredictor,
} from "../../lib/gamification";
import { snapshotGlobalRanking } from "../scoring/rankings";
import {
  DEMO_CHALLENGE_MARKER,
  DEMO_EXTERNAL_PREFIX,
  DEMO_LIFECYCLE_MS,
  DEMO_MATCH_COUNT,
  DEMO_MATCH_EXTERNAL_PREFIX,
  DEMO_SPACING_MS,
  DEMO_STAGE_EXTERNAL,
  DEMO_TEAM_EXTERNAL_PREFIX,
  DEMO_TOURNAMENT_EXTERNAL,
  DEMO_TOURNAMENT_SLUG,
  DEMO_USER_CLERK_PREFIX,
  DEMO_USER_COUNT,
  computeDesiredState,
  demoFinalScore,
  demoKickoffAt,
  demoPrediction,
  isProductionEnv,
} from "./config";
import {
  demoDataExists,
  isDemoEngineRunning,
  runDemoTick,
  startDemoEngine,
  stopDemoEngine,
} from "./engine";

const LIVE_STATUSES = ["live", "half_time"] as const;
const FINISHED_STATUSES = ["finished", "full_time"] as const;

// Bilingual dummy team pool. No real countries — purely fictional clubs.
const DEMO_TEAMS: { en: string; ar: string; code: string }[] = [
  { en: "Demo Falcons", ar: "صقور التجربة", code: "DFA" },
  { en: "Demo Lions", ar: "أسود التجربة", code: "DLI" },
  { en: "Demo Eagles", ar: "نسور التجربة", code: "DEA" },
  { en: "Demo Sharks", ar: "قروش التجربة", code: "DSH" },
  { en: "Demo Titans", ar: "عمالقة التجربة", code: "DTI" },
  { en: "Demo Wolves", ar: "ذئاب التجربة", code: "DWO" },
  { en: "Demo Dragons", ar: "تنانين التجربة", code: "DDR" },
  { en: "Demo Panthers", ar: "فهود التجربة", code: "DPA" },
  { en: "Demo Cobras", ar: "كوبرا التجربة", code: "DCO" },
  { en: "Demo Hawks", ar: "بزاة التجربة", code: "DHA" },
  { en: "Demo Bulls", ar: "ثيران التجربة", code: "DBU" },
  { en: "Demo Stallions", ar: "فحول التجربة", code: "DST" },
  { en: "Demo Ravens", ar: "غربان التجربة", code: "DRA" },
  { en: "Demo Scorpions", ar: "عقارب التجربة", code: "DSC" },
  { en: "Demo Vipers", ar: "أفاعي التجربة", code: "DVI" },
  { en: "Demo Foxes", ar: "ثعالب التجربة", code: "DFO" },
];

// Bilingual dummy player display names for the seeded demo users.
const DEMO_PLAYER_NAMES: { en: string; ar: string }[] = [
  { en: "Demo Faisal", ar: "فيصل التجريبي" },
  { en: "Demo Noura", ar: "نورة التجريبية" },
  { en: "Demo Saad", ar: "سعد التجريبي" },
  { en: "Demo Layla", ar: "ليلى التجريبية" },
  { en: "Demo Khalid", ar: "خالد التجريبي" },
  { en: "Demo Maha", ar: "مها التجريبية" },
  { en: "Demo Tariq", ar: "طارق التجريبي" },
  { en: "Demo Salma", ar: "سلمى التجريبية" },
  { en: "Demo Omar", ar: "عمر التجريبي" },
  { en: "Demo Hind", ar: "هند التجريبية" },
];

export interface DemoStatus {
  enabled: boolean;
  active: boolean;
  engineRunning: boolean;
  totalMatches: number;
  upcoming: number;
  live: number;
  finished: number;
  challenges: number;
  users: number;
}

function randomInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `DEMO-${s}`;
}

// Current demo status: counts of upcoming / live / finished demo matches plus
// demo challenge and user counts, and whether the harness is enabled (non-prod).
export async function getDemoStatus(): Promise<DemoStatus> {
  const matches = await db
    .select({ status: matchesTable.status })
    .from(matchesTable)
    .where(like(matchesTable.externalId, `${DEMO_MATCH_EXTERNAL_PREFIX}%`));
  const [challenges] = await db
    .select({ value: count() })
    .from(challengesTable)
    .where(eq(challengesTable.createdViaCode, DEMO_CHALLENGE_MARKER));
  const [users] = await db
    .select({ value: count() })
    .from(usersTable)
    .where(like(usersTable.clerkUserId, `${DEMO_USER_CLERK_PREFIX}%`));

  const upcoming = matches.filter((m) => m.status === "scheduled").length;
  const live = matches.filter((m) =>
    (LIVE_STATUSES as readonly string[]).includes(m.status),
  ).length;
  const finished = matches.filter((m) =>
    (FINISHED_STATUSES as readonly string[]).includes(m.status),
  ).length;

  return {
    enabled: !isProductionEnv(),
    active: matches.length > 0,
    engineRunning: isDemoEngineRunning(),
    totalMatches: matches.length,
    upcoming,
    live,
    finished,
    challenges: challenges?.value ?? 0,
    users: users?.value ?? 0,
  };
}

// ---- Live activity feed ---------------------------------------------------
// A small, read-only window onto what the harness has been doing lately, derived
// purely from existing data (matches / points ledger / ranking snapshots). It
// adds NO new scoring logic — it just surfaces rows the real engine already
// wrote, tagged to demo data, merged into one time-ordered stream.

export type DemoActivityKind =
  | "match_live"
  | "match_finished"
  | "points_awarded"
  | "ranking_change";

export interface DemoActivityEvent {
  id: string;
  kind: DemoActivityKind;
  at: string;
  homeTeamEn: string | null;
  homeTeamAr: string | null;
  awayTeamEn: string | null;
  awayTeamAr: string | null;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
  displayName: string | null;
  points: number | null;
  reason: string | null;
  rank: number | null;
  previousRank: number | null;
}

// How many rows to pull per category before merging, and how many events to
// return overall. Small caps keep the poll cheap.
const ACTIVITY_PER_CATEGORY = 20;
const ACTIVITY_LIMIT = 40;

interface DemoTeamLabels {
  homeEn: string | null;
  homeAr: string | null;
  awayEn: string | null;
  awayAr: string | null;
}

// Recent demo events, newest first: live/finished demo matches, points just
// awarded on demo matches, and global ranking shifts among demo users. Returns
// an empty list when no demo data is active.
export async function getDemoActivity(): Promise<DemoActivityEvent[]> {
  // All demo matches + a team-label lookup, fetched once and reused to enrich
  // every category (avoids self-joins for home/away team names).
  const demoMatches = await db
    .select({
      id: matchesTable.id,
      homeTeamId: matchesTable.homeTeamId,
      awayTeamId: matchesTable.awayTeamId,
      status: matchesTable.status,
      homeScore: matchesTable.homeScore,
      awayScore: matchesTable.awayScore,
      minute: matchesTable.minute,
      updatedAt: matchesTable.updatedAt,
    })
    .from(matchesTable)
    .where(like(matchesTable.externalId, `${DEMO_MATCH_EXTERNAL_PREFIX}%`));

  if (demoMatches.length === 0) return [];

  const teamRows = await db
    .select({ id: teamsTable.id, nameEn: teamsTable.nameEn, nameAr: teamsTable.nameAr })
    .from(teamsTable)
    .where(like(teamsTable.externalId, `${DEMO_TEAM_EXTERNAL_PREFIX}%`));
  const teamById = new Map(teamRows.map((t) => [t.id, t]));

  const matchById = new Map(demoMatches.map((m) => [m.id, m]));
  const demoMatchIds = demoMatches.map((m) => m.id);

  const labelsFor = (
    homeTeamId: string | null,
    awayTeamId: string | null,
  ): DemoTeamLabels => {
    const home = homeTeamId ? teamById.get(homeTeamId) : undefined;
    const away = awayTeamId ? teamById.get(awayTeamId) : undefined;
    return {
      homeEn: home?.nameEn ?? null,
      homeAr: home?.nameAr ?? null,
      awayEn: away?.nameEn ?? null,
      awayAr: away?.nameAr ?? null,
    };
  };

  const events: DemoActivityEvent[] = [];

  // 1) Match status: live/half_time and finished/full_time demo matches, newest
  // change first. Live matches naturally float to the top (their minute/score
  // ticks update updatedAt every cycle).
  const matchEvents = demoMatches
    .filter((m) => m.status !== "scheduled")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, ACTIVITY_PER_CATEGORY);
  for (const m of matchEvents) {
    const labels = labelsFor(m.homeTeamId, m.awayTeamId);
    const finished =
      (FINISHED_STATUSES as readonly string[]).includes(m.status);
    events.push({
      id: `match:${m.id}:${m.updatedAt.getTime()}`,
      kind: finished ? "match_finished" : "match_live",
      at: m.updatedAt.toISOString(),
      homeTeamEn: labels.homeEn,
      homeTeamAr: labels.homeAr,
      awayTeamEn: labels.awayEn,
      awayTeamAr: labels.awayAr,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      minute: m.minute,
      displayName: null,
      points: null,
      reason: null,
      rank: null,
      previousRank: null,
    });
  }

  // 2) Points just awarded on demo matches (points > 0 only), newest first.
  const ledgerRows = await db
    .select({
      id: pointsLedgerTable.id,
      matchId: pointsLedgerTable.matchId,
      points: pointsLedgerTable.points,
      reason: pointsLedgerTable.reason,
      createdAt: pointsLedgerTable.createdAt,
      displayName: profilesTable.displayName,
    })
    .from(pointsLedgerTable)
    .leftJoin(profilesTable, eq(profilesTable.userId, pointsLedgerTable.userId))
    .where(
      and(
        inArray(pointsLedgerTable.matchId, demoMatchIds),
        gt(pointsLedgerTable.points, 0),
      ),
    )
    .orderBy(desc(pointsLedgerTable.createdAt))
    .limit(ACTIVITY_PER_CATEGORY);
  for (const r of ledgerRows) {
    const match = r.matchId ? matchById.get(r.matchId) : undefined;
    const labels = match
      ? labelsFor(match.homeTeamId, match.awayTeamId)
      : { homeEn: null, homeAr: null, awayEn: null, awayAr: null };
    events.push({
      id: `points:${r.id}`,
      kind: "points_awarded",
      at: r.createdAt.toISOString(),
      homeTeamEn: labels.homeEn,
      homeTeamAr: labels.homeAr,
      awayTeamEn: labels.awayEn,
      awayTeamAr: labels.awayAr,
      homeScore: match?.homeScore ?? null,
      awayScore: match?.awayScore ?? null,
      minute: null,
      displayName: r.displayName,
      points: r.points,
      reason: r.reason,
      rank: null,
      previousRank: null,
    });
  }

  // 3) Global ranking shifts among demo users (rank changed vs. previous
  // snapshot), newest first.
  const rankingRows = await db
    .select({
      id: rankingsTable.id,
      rank: rankingsTable.rank,
      previousRank: rankingsTable.previousRank,
      computedAt: rankingsTable.computedAt,
      displayName: profilesTable.displayName,
    })
    .from(rankingsTable)
    .innerJoin(usersTable, eq(usersTable.id, rankingsTable.userId))
    .leftJoin(profilesTable, eq(profilesTable.userId, rankingsTable.userId))
    .where(
      and(
        eq(rankingsTable.scope, "global"),
        like(usersTable.clerkUserId, `${DEMO_USER_CLERK_PREFIX}%`),
        isNotNull(rankingsTable.previousRank),
        ne(rankingsTable.rank, rankingsTable.previousRank),
      ),
    )
    .orderBy(desc(rankingsTable.computedAt))
    .limit(ACTIVITY_PER_CATEGORY);
  for (const r of rankingRows) {
    events.push({
      id: `rank:${r.id}`,
      kind: "ranking_change",
      at: r.computedAt.toISOString(),
      homeTeamEn: null,
      homeTeamAr: null,
      awayTeamEn: null,
      awayTeamAr: null,
      homeScore: null,
      awayScore: null,
      minute: null,
      displayName: r.displayName,
      points: null,
      reason: null,
      rank: r.rank,
      previousRank: r.previousRank,
    });
  }

  // Merge into one newest-first stream.
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, ACTIVITY_LIMIT);
}

// Seed the full demo world. The caller (admin route) is added as a participant
// of the demo challenges so the owner's own predictions count there too. Starts
// the progression engine on success. No-op-safe: rejects if already active.
export async function seedDemoData(ownerUserId: string): Promise<DemoStatus> {
  if (await demoDataExists()) {
    throw new DemoAlreadyActiveError();
  }

  const seededAt = Date.now();

  await db.transaction(async (tx) => {
    // --- Tournament + stage (type `other` so it never becomes the active WC). ---
    const [tournament] = await tx
      .insert(tournamentsTable)
      .values({
        slug: DEMO_TOURNAMENT_SLUG,
        nameEn: "Demo Tournament",
        nameAr: "بطولة تجريبية",
        type: "other",
        status: "active",
        externalId: DEMO_TOURNAMENT_EXTERNAL,
        startDate: new Date(seededAt),
        isActive: true,
      })
      .returning();
    const [stage] = await tx
      .insert(stagesTable)
      .values({
        tournamentId: tournament.id,
        nameEn: "Demo Group",
        nameAr: "مجموعة تجريبية",
        type: "group",
        externalId: DEMO_STAGE_EXTERNAL,
      })
      .returning();

    // --- Teams ---
    const teamRows = await tx
      .insert(teamsTable)
      .values(
        DEMO_TEAMS.map((t, i) => ({
          nameEn: t.en,
          nameAr: t.ar,
          code: t.code,
          externalId: `${DEMO_TEAM_EXTERNAL_PREFIX}${i}`,
        })),
      )
      .returning({ id: teamsTable.id });
    const teamIds = teamRows.map((t) => t.id);
    const n = teamIds.length;

    // --- Matches: deterministic pairing + final score, staggered kickoffs,
    // each initialized to its correct current state on the compressed clock. ---
    const now = new Date(seededAt);
    const matchValues = [];
    for (let i = 0; i < DEMO_MATCH_COUNT; i++) {
      let homeIdx = i % n;
      let awayIdx = (i * 7 + 3) % n;
      if (awayIdx === homeIdx) awayIdx = (awayIdx + 1) % n;
      const kickoffAt = demoKickoffAt(i, seededAt);
      const final = demoFinalScore(i);
      const state = computeDesiredState(kickoffAt, final, now);
      matchValues.push({
        tournamentId: tournament.id,
        stageId: stage.id,
        homeTeamId: teamIds[homeIdx],
        awayTeamId: teamIds[awayIdx],
        kickoffAt,
        // Demo locks AT kickoff (vs. real kickoff-30min) so the compressed
        // window leaves time to predict on upcoming matches.
        predictionLockAt: kickoffAt,
        status: state.status,
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        minute: state.minute,
        externalId: `${DEMO_MATCH_EXTERNAL_PREFIX}${i}`,
      });
    }
    const matchRows = await tx
      .insert(matchesTable)
      .values(matchValues)
      .returning({ id: matchesTable.id });
    const matchIds = matchRows.map((m) => m.id);

    // --- Demo users + profiles ---
    const userCount = Math.min(DEMO_USER_COUNT, DEMO_PLAYER_NAMES.length);
    const userIds: string[] = [];
    for (let u = 0; u < userCount; u++) {
      const name = DEMO_PLAYER_NAMES[u];
      const [user] = await tx
        .insert(usersTable)
        .values({
          clerkUserId: `${DEMO_USER_CLERK_PREFIX}${u}-${seededAt}`,
          email: `demo${u}-${seededAt}@demo.thaddi.local`,
          emailVerified: true,
          mobileVerified: true,
          realName: name.en,
        })
        .returning({ id: usersTable.id });
      await tx.insert(profilesTable).values({
        userId: user.id,
        displayName: `${name.en}`,
        username: `demo_${u}_${seededAt}`,
      });
      userIds.push(user.id);
    }

    // --- Pre-filled predictions for every demo user on every demo match.
    // Inserted directly (bypassing the lock) so already-finished matches award
    // points immediately and upcoming ones are pre-populated. ---
    const predictionValues = [];
    for (let u = 0; u < userIds.length; u++) {
      for (let i = 0; i < matchIds.length; i++) {
        const p = demoPrediction(u, i);
        predictionValues.push({
          userId: userIds[u],
          matchId: matchIds[i],
          homeScore: p.home,
          awayScore: p.away,
        });
      }
    }
    if (predictionValues.length > 0) {
      await tx.insert(predictionsTable).values(predictionValues);
    }

    // --- Two custom-scope demo challenges (so challenge flows are testable).
    // Each links a half of the demo matches; participants = owner + demo users. ---
    const half = Math.ceil(matchIds.length / 2);
    const challengeDefs = [
      {
        name: "Demo League — Early Matches",
        matchIds: matchIds.slice(0, half),
      },
      {
        name: "Demo League — Late Matches",
        matchIds: matchIds.slice(half),
      },
    ];
    for (const def of challengeDefs) {
      const [challenge] = await tx
        .insert(challengesTable)
        .values({
          ownerId: ownerUserId,
          name: def.name,
          description: "Seeded by the live demo-data testing harness.",
          type: "custom",
          visibility: "unlisted",
          scope: "custom",
          tournamentId: tournament.id,
          inviteCode: randomInviteCode(),
          endCondition: "matches_finish",
          predictionVisibility: "reveal_after_kickoff",
          status: "active",
          createdViaCode: DEMO_CHALLENGE_MARKER,
        })
        .returning({ id: challengesTable.id });

      if (def.matchIds.length > 0) {
        await tx.insert(challengeMatchesTable).values(
          def.matchIds.map((mid) => ({
            challengeId: challenge.id,
            matchId: mid,
          })),
        );
      }

      const participantIds = [ownerUserId, ...userIds];
      await tx.insert(challengeParticipantsTable).values(
        participantIds.map((uid) => ({
          challengeId: challenge.id,
          userId: uid,
          status: "active" as const,
        })),
      );
    }
  });

  // Start the engine: its immediate first tick scores all already-finished demo
  // matches via the real scoring path (outside the seed tx).
  startDemoEngine();
  logger.info({ seededAt }, "demo data seeded");

  return getDemoStatus();
}

// Options for fast-forwarding the demo clock.
export interface AdvanceDemoOptions {
  // Shift the whole demo timeline earlier by this many minutes (fast-forward).
  minutes?: number;
  // Force every currently-live demo match straight to full time.
  finishLive?: boolean;
}

// Upper bound on a single advance so a typo can't park kickoffs absurdly far in
// the past (a full demo lifecycle is minutes long, not days).
const MAX_ADVANCE_MINUTES = 7 * 24 * 60; // one week of compressed clock

// Fast-forward the demo clock. The progression engine is stateless — each demo
// match's current status/score is recomputed purely from its stored kickoffAt
// vs. now — so "advancing the clock" simply means shifting demo matches' kickoff
// (and prediction lock) earlier. The very next tick re-derives every match's
// state and hands any that newly reached full time to the REAL scoring path,
// exactly like normal progression (no parallel scoring impl).
//
// `minutes` shifts the entire demo timeline earlier; `finishLive` parks every
// currently-live match a full lifecycle in the past so it immediately finishes.
// Both can be combined. No-op-safe when no demo data exists.
export async function advanceDemoClock(
  opts: AdvanceDemoOptions,
): Promise<DemoStatus> {
  if (!(await demoDataExists())) {
    return getDemoStatus();
  }

  const now = new Date();
  const rawMinutes = Number.isFinite(opts.minutes) ? (opts.minutes as number) : 0;
  const minutes = Math.max(0, Math.min(MAX_ADVANCE_MINUTES, rawMinutes));
  const deltaMs = Math.round(minutes * 60 * 1000);

  // Shift the whole demo timeline earlier by deltaMs (preserves relative spacing).
  if (deltaMs > 0) {
    const matches = await db
      .select({
        id: matchesTable.id,
        kickoffAt: matchesTable.kickoffAt,
        predictionLockAt: matchesTable.predictionLockAt,
      })
      .from(matchesTable)
      .where(like(matchesTable.externalId, `${DEMO_MATCH_EXTERNAL_PREFIX}%`));
    for (const m of matches) {
      await db
        .update(matchesTable)
        .set({
          kickoffAt: new Date(m.kickoffAt.getTime() - deltaMs),
          predictionLockAt: m.predictionLockAt
            ? new Date(m.predictionLockAt.getTime() - deltaMs)
            : null,
          updatedAt: now,
        })
        .where(eq(matchesTable.id, m.id));
    }
  }

  // Force currently-live matches to full time by parking their kickoff a full
  // lifecycle (plus a margin) in the past — computeDesiredState then returns
  // "finished" for them on the next tick.
  if (opts.finishLive) {
    const finishedKickoff = new Date(now.getTime() - DEMO_LIFECYCLE_MS - 1000);
    await db
      .update(matchesTable)
      .set({
        kickoffAt: finishedKickoff,
        predictionLockAt: finishedKickoff,
        updatedAt: now,
      })
      .where(
        and(
          like(matchesTable.externalId, `${DEMO_MATCH_EXTERNAL_PREFIX}%`),
          inArray(matchesTable.status, [...LIVE_STATUSES]),
        ),
      );
  }

  // Apply the new states + run the real scoring path immediately for anything
  // that just reached full time, then make sure the engine keeps ticking.
  await runDemoTick();
  if (!isDemoEngineRunning()) startDemoEngine();

  logger.info({ minutes, finishLive: Boolean(opts.finishLive) }, "demo clock advanced");

  return getDemoStatus();
}

// Tear down ALL demo data in dependency order inside a transaction, then
// recompute affected real users so leaderboards return to their clean state.
export async function teardownDemoData(): Promise<DemoStatus> {
  stopDemoEngine();

  const tournament = await db.query.tournamentsTable.findFirst({
    where: eq(tournamentsTable.slug, DEMO_TOURNAMENT_SLUG),
  });

  const demoMatches = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(like(matchesTable.externalId, `${DEMO_EXTERNAL_PREFIX}%`));
  const demoMatchIds = demoMatches.map((m) => m.id);

  const demoChallenges = await db
    .select({ id: challengesTable.id })
    .from(challengesTable)
    .where(eq(challengesTable.createdViaCode, DEMO_CHALLENGE_MARKER));
  const demoChallengeIds = demoChallenges.map((c) => c.id);

  const demoUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(like(usersTable.clerkUserId, `${DEMO_USER_CLERK_PREFIX}%`));
  const demoUserIds = demoUsers.map((u) => u.id);
  const demoUserSet = new Set(demoUserIds);

  // Real users who predicted on demo matches — their global totals & any
  // demo-window awards must be reverted after the demo rows are gone.
  let affectedRealUserIds: string[] = [];
  if (demoMatchIds.length > 0) {
    const rows = await db
      .select({ userId: predictionsTable.userId })
      .from(predictionsTable)
      .where(inArray(predictionsTable.matchId, demoMatchIds));
    affectedRealUserIds = [
      ...new Set(rows.map((r) => r.userId)),
    ].filter((id) => !demoUserSet.has(id));
  }

  // Delete only DEMO-TAGGED rows (no time-window heuristics). Everything a demo
  // touched on a REAL user is then re-derived from the remaining non-demo data
  // below, so a real user's legitimately-earned awards/history are never deleted.
  await db.transaction(async (tx) => {
    // 1) Achievements earned inside demo challenges. The challenge FK is
    // set-null, so deleting the challenge would orphan (not remove) these — do
    // it explicitly first.
    if (demoChallengeIds.length > 0) {
      await tx
        .delete(userAchievementsTable)
        .where(inArray(userAchievementsTable.challengeId, demoChallengeIds));
    }
    // 2) Demo challenges (cascades participants, challenge_matches, points
    // ledger by challengeId, challenge-scope ranking snapshots).
    if (demoChallengeIds.length > 0) {
      await tx
        .delete(challengesTable)
        .where(inArray(challengesTable.id, demoChallengeIds));
    }
    // 3) Demo matches (cascades remaining predictions, history, points ledger by
    // matchId, challenge_matches by matchId). Removing the predictions is what
    // makes the global scored-prediction aggregates demo-free for step 5/6.
    if (demoMatchIds.length > 0) {
      await tx.delete(matchesTable).where(inArray(matchesTable.id, demoMatchIds));
    }
    // 4) Demo teams.
    await tx
      .delete(teamsTable)
      .where(like(teamsTable.externalId, `${DEMO_EXTERNAL_PREFIX}%`));
    // 5) Demo tournament (cascades its stage).
    if (tournament) {
      await tx
        .delete(tournamentsTable)
        .where(eq(tournamentsTable.id, tournament.id));
    }
    // 6) Demo users (cascades their profiles, badges, achievements, points
    // ledger and ranking snapshot rows — all keyed by user_id).
    if (demoUserIds.length > 0) {
      await tx.delete(usersTable).where(inArray(usersTable.id, demoUserIds));
    }
  });

  // Re-derive each affected real user's denormalized state from the now-clean,
  // demo-free data: recompute totals/levels, then revoke any earnable badge they
  // no longer qualify for. This is equivalent to recomputing their gamification
  // from scratch on the remaining data — it removes exactly the demo-derived
  // effects while leaving anything justified by real predictions intact.
  for (const uid of affectedRealUserIds) {
    try {
      await recomputeUserTotals(uid);
      await reconcileUserBadges(uid);
    } catch (err) {
      logger.error({ err, userId: uid }, "demo teardown recompute failed");
    }
  }

  // Re-derive the single global Top Predictor achievement among the affected
  // users (revoke from any who are no longer the genuine #1, then re-award the
  // real leader). Then snapshot the global ranking from the remaining non-demo
  // data so rank movement is anchored to a clean baseline. Demo users' snapshot
  // rows were cascade-removed with the users; real users' snapshot history is
  // never deleted — the fresh snapshot simply supersedes it.
  try {
    await reconcileTopPredictor(affectedRealUserIds);
    await db.transaction((tx) => snapshotGlobalRanking(tx));
  } catch (err) {
    logger.error({ err }, "demo teardown ranking reconcile failed");
  }

  logger.info(
    {
      matches: demoMatchIds.length,
      challenges: demoChallengeIds.length,
      users: demoUserIds.length,
      affectedRealUsers: affectedRealUserIds.length,
    },
    "demo data torn down",
  );

  return getDemoStatus();
}

// Thrown when seeding is requested while demo data already exists.
export class DemoAlreadyActiveError extends Error {
  constructor() {
    super("Demo data is already active");
    this.name = "DemoAlreadyActiveError";
  }
}
