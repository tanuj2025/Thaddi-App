import { Router, type IRouter } from "express";
import { eq, count, asc, and, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  featureFlagsTable,
  usersTable,
  challengesTable,
  predictionsTable,
  matchesTable,
  teamsTable,
  stagesTable,
  tournamentsTable,
} from "@workspace/db";
import { toTeamRef } from "../lib/matchSerializers";

const router: IRouter = Router();

const upHomeTeam = alias(teamsTable, "up_home_team");
const upAwayTeam = alias(teamsTable, "up_away_team");

const UPCOMING_DEFAULT_LIMIT = 6;
const UPCOMING_MAX_LIMIT = 20;

router.get("/feature-flags", async (_req, res) => {
  const flags = await db.select().from(featureFlagsTable);
  res.json(
    flags.map((f) => ({
      key: f.key,
      name: f.name,
      description: f.description ?? null,
      enabled: f.enabled,
    })),
  );
});

router.get("/platform-stats", async (_req, res) => {
  const [users] = await db.select({ value: count() }).from(usersTable);
  const [challenges] = await db
    .select({ value: count() })
    .from(challengesTable);
  const [predictions] = await db
    .select({ value: count() })
    .from(predictionsTable);
  const [active] = await db
    .select({ value: count() })
    .from(challengesTable)
    .where(eq(challengesTable.status, "active"));

  // Absolute earliest match of the active tournament — used purely to tell
  // "no schedule published yet" (null) apart from "tournament under way / over".
  const [firstMatch] = await db
    .select({ kickoffAt: matchesTable.kickoffAt })
    .from(matchesTable)
    .innerJoin(
      tournamentsTable,
      eq(matchesTable.tournamentId, tournamentsTable.id),
    )
    .where(eq(tournamentsTable.isActive, true))
    .orderBy(asc(matchesTable.kickoffAt))
    .limit(1);

  // Earliest still-upcoming (scheduled, not-yet-kicked-off) match — drives the
  // public World Cup countdown so it rolls to the next match throughout the
  // tournament instead of freezing once the opener kicks off.
  const [nextMatch] = await db
    .select({ kickoffAt: matchesTable.kickoffAt })
    .from(matchesTable)
    .innerJoin(
      tournamentsTable,
      eq(matchesTable.tournamentId, tournamentsTable.id),
    )
    .where(
      and(
        eq(tournamentsTable.isActive, true),
        eq(matchesTable.status, "scheduled"),
        gt(matchesTable.kickoffAt, new Date()),
      ),
    )
    .orderBy(asc(matchesTable.kickoffAt))
    .limit(1);

  res.json({
    totalUsers: users?.value ?? 0,
    totalChallenges: challenges?.value ?? 0,
    totalPredictions: predictions?.value ?? 0,
    activeChallenges: active?.value ?? 0,
    firstMatchKickoff: firstMatch?.kickoffAt
      ? firstMatch.kickoffAt.toISOString()
      : null,
    nextMatchKickoff: nextMatch?.kickoffAt
      ? nextMatch.kickoffAt.toISOString()
      : null,
  });
});

// GET /upcoming-matches — public list of the next N scheduled, not-yet-kicked-off
// matches of the active tournament, for the landing schedule. scheduleState lets
// the client tell "no schedule published yet" apart from "no matches left".
router.get("/upcoming-matches", async (req, res) => {
  const parsed =
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), UPCOMING_MAX_LIMIT)
    : UPCOMING_DEFAULT_LIMIT;

  const [tournament] = await db
    .select({ id: tournamentsTable.id })
    .from(tournamentsTable)
    .where(eq(tournamentsTable.isActive, true))
    .limit(1);

  if (!tournament) {
    res.json({ scheduleState: "no_schedule", matches: [] });
    return;
  }

  // Is there any fixture at all? Distinguishes "no schedule yet" from "no
  // upcoming matches remaining" when the upcoming list comes back empty.
  const [anyMatch] = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(eq(matchesTable.tournamentId, tournament.id))
    .limit(1);

  if (!anyMatch) {
    res.json({ scheduleState: "no_schedule", matches: [] });
    return;
  }

  const rows = await db
    .select({
      id: matchesTable.id,
      kickoffAt: matchesTable.kickoffAt,
      venue: matchesTable.venue,
      stageType: stagesTable.type,
      home: upHomeTeam,
      away: upAwayTeam,
    })
    .from(matchesTable)
    .leftJoin(upHomeTeam, eq(matchesTable.homeTeamId, upHomeTeam.id))
    .leftJoin(upAwayTeam, eq(matchesTable.awayTeamId, upAwayTeam.id))
    .leftJoin(stagesTable, eq(matchesTable.stageId, stagesTable.id))
    .where(
      and(
        eq(matchesTable.tournamentId, tournament.id),
        eq(matchesTable.status, "scheduled"),
        gt(matchesTable.kickoffAt, new Date()),
      ),
    )
    .orderBy(asc(matchesTable.kickoffAt))
    .limit(limit);

  res.json({
    scheduleState: rows.length > 0 ? "upcoming" : "finished",
    matches: rows.map((r) => ({
      id: r.id,
      stageType: r.stageType ?? null,
      venue: r.venue ?? null,
      kickoffAt: r.kickoffAt.toISOString(),
      homeTeam: toTeamRef(r.home),
      awayTeam: toTeamRef(r.away),
    })),
  });
});

// GET /schedule — public full fixture list of the active tournament (every
// match, any status), ordered by kickoff, for the public schedule page. No
// predictions are exposed. scheduleState distinguishes "no schedule published
// yet" from a published schedule that still has upcoming matches vs one where
// every match has already kicked off / finished.
router.get("/schedule", async (_req, res) => {
  const [tournament] = await db
    .select({ id: tournamentsTable.id })
    .from(tournamentsTable)
    .where(eq(tournamentsTable.isActive, true))
    .limit(1);

  if (!tournament) {
    res.json({ scheduleState: "no_schedule", matches: [] });
    return;
  }

  const rows = await db
    .select({
      id: matchesTable.id,
      kickoffAt: matchesTable.kickoffAt,
      venue: matchesTable.venue,
      status: matchesTable.status,
      homeScore: matchesTable.homeScore,
      awayScore: matchesTable.awayScore,
      minute: matchesTable.minute,
      stageType: stagesTable.type,
      home: upHomeTeam,
      away: upAwayTeam,
    })
    .from(matchesTable)
    .leftJoin(upHomeTeam, eq(matchesTable.homeTeamId, upHomeTeam.id))
    .leftJoin(upAwayTeam, eq(matchesTable.awayTeamId, upAwayTeam.id))
    .leftJoin(stagesTable, eq(matchesTable.stageId, stagesTable.id))
    .where(eq(matchesTable.tournamentId, tournament.id))
    .orderBy(asc(matchesTable.kickoffAt));

  if (rows.length === 0) {
    res.json({ scheduleState: "no_schedule", matches: [] });
    return;
  }

  const now = Date.now();
  const hasUpcoming = rows.some(
    (r) => r.status === "scheduled" && r.kickoffAt.getTime() > now,
  );

  res.json({
    scheduleState: hasUpcoming ? "upcoming" : "finished",
    matches: rows.map((r) => {
      const hasKickedOff =
        r.status === "live" ||
        r.status === "half_time" ||
        r.status === "full_time" ||
        r.status === "finished" ||
        r.kickoffAt.getTime() <= now;
      return {
        id: r.id,
        stageType: r.stageType ?? null,
        venue: r.venue ?? null,
        kickoffAt: r.kickoffAt.toISOString(),
        status: r.status,
        homeScore: r.homeScore ?? null,
        awayScore: r.awayScore ?? null,
        minute: r.minute ?? null,
        hasKickedOff,
        homeTeam: toTeamRef(r.home),
        awayTeam: toTeamRef(r.away),
      };
    }),
  });
});

export default router;
