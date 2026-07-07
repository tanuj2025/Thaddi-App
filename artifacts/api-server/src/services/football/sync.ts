// Sync World Cup 2026 teams and fixtures from the active football provider into
// the local schema. Idempotent: rows are matched by external_id and updated in
// place, so repeated runs converge (and keep live score/status/minute fresh).
//
// predictionLockAt is computed here from kickoff minus LOCK_LEAD_MS — the single
// authoritative lock boundary for predictions. The lead is 0 by default, so
// predictions lock exactly at kickoff.
//
// Self-heal: teams/matches are keyed by external_id, but external_id is NOT
// unique and different providers use different id schemes (mock: 'm-a1'/'sa';
// football-data.org: numeric). Switching providers — or a legacy concurrent run
// before the advisory lock existed — leaves the previous scheme's rows behind as
// stale duplicates. After upserting the current snapshot, sync prunes any
// provider-managed row that is NOT part of the current snapshot, so an
// environment fixes itself instead of needing a manual DB cleanup. Pruning is
// guarded: rows referenced by user data (predictions, prediction history, the
// points ledger, or a challenge's match selection) are SKIPPED, never deleted,
// so a stale row that someone has interacted with is preserved rather than
// silently destroying their predictions/standings.

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  ne,
  notInArray,
  notLike,
  or,
} from "drizzle-orm";
import {
  db,
  tournamentsTable,
  stagesTable,
  teamsTable,
  matchesTable,
  predictionsTable,
  predictionHistoryTable,
  pointsLedgerTable,
  challengesTable,
  challengeMatchesTable,
} from "@workspace/db";
import { getFootballProvider, isLiveProviderConfigured } from "./index";
import { acquireFootballLock } from "./lock";
import {
  fetchCompetitionSnapshot,
  type CompetitionSnapshot,
  type CompetitionType,
} from "./espnProvider";
import type {
  FootballProvider,
  ProviderMatch,
  ProviderStageType,
  ProviderTeam,
} from "./types";

// The World Cup keeps its dedicated, well-tested legacy provider path; only the
// new domestic competitions flow through the generic ESPN engine.
const WORLD_CUP_SLUG = "fifa-world-cup-2026";
export const WORLD_CUP_COMPETITION_SLUG = "fifa.world";

const LOCK_LEAD_MS = 0;

export interface SyncResult {
  // The tournament-season row slug and its competition grouping, set by the
  // per-competition callers so a multi-competition sync result can be attributed
  // back to each competition (used by the admin trigger-sync response).
  slug?: string;
  competitionSlug?: string | null;
  provider: string;
  teamsUpserted: number;
  matchesUpserted: number;
  // Stale provider-managed rows removed because they are no longer part of the
  // current provider's snapshot (e.g. left behind after switching providers).
  teamsPruned: number;
  matchesPruned: number;
  // Stale rows kept because user data references them — pruning them would
  // destroy predictions/ledger entries or break a challenge's match selection.
  teamsPruneSkipped: number;
  matchesPruneSkipped: number;
  skipped?: string;
}

// Drizzle transaction client type (inferred from db.transaction's callback).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Remove matches in this tournament that are provider-managed (external_id set)
// but not part of the current snapshot — both rows from a previous provider's
// id scheme AND legacy duplicate rows of a current external_id (only the
// canonical row id is kept in currentMatchIds). Matches referenced by user data
// are skipped to avoid cascade-deleting predictions/ledger/challenge selections.
async function pruneStaleMatches(
  tx: Tx,
  tournamentId: string,
  currentMatchIds: string[],
): Promise<{ pruned: number; skipped: number }> {
  // Safety: never prune when the snapshot has no matches (a provider hiccup
  // returning an empty set must not wipe the whole tournament).
  if (currentMatchIds.length === 0) return { pruned: 0, skipped: 0 };

  const candidates = await tx
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(
      and(
        eq(matchesTable.tournamentId, tournamentId),
        isNotNull(matchesTable.externalId),
        // Never consider demo-harness rows: they belong to the demo tournament
        // and are owned by the demo service, not the real provider.
        notLike(matchesTable.externalId, "demo:%"),
        notInArray(matchesTable.id, currentMatchIds),
      ),
    );
  const candidateIds = candidates.map((c) => c.id);
  if (candidateIds.length === 0) return { pruned: 0, skipped: 0 };

  // Collect candidate ids referenced by any user-facing dependent table.
  const referenced = new Set<string>();
  const collect = async (
    rows: Promise<{ matchId: string | null }[]>,
  ): Promise<void> => {
    for (const r of await rows) if (r.matchId) referenced.add(r.matchId);
  };
  await Promise.all([
    collect(
      tx
        .select({ matchId: predictionsTable.matchId })
        .from(predictionsTable)
        .where(inArray(predictionsTable.matchId, candidateIds)),
    ),
    collect(
      tx
        .select({ matchId: predictionHistoryTable.matchId })
        .from(predictionHistoryTable)
        .where(inArray(predictionHistoryTable.matchId, candidateIds)),
    ),
    collect(
      tx
        .select({ matchId: pointsLedgerTable.matchId })
        .from(pointsLedgerTable)
        .where(inArray(pointsLedgerTable.matchId, candidateIds)),
    ),
    collect(
      tx
        .select({ matchId: challengeMatchesTable.matchId })
        .from(challengeMatchesTable)
        .where(inArray(challengeMatchesTable.matchId, candidateIds)),
    ),
  ]);

  const deletable = candidateIds.filter((id) => !referenced.has(id));
  if (deletable.length) {
    await tx.delete(matchesTable).where(inArray(matchesTable.id, deletable));
  }
  return { pruned: deletable.length, skipped: referenced.size };
}

// Which slice of teams a prune pass is allowed to touch. National-team syncs
// (the World Cup) must never delete club rows, and a domestic competition sync
// must never delete another competition's clubs — so team pruning is scoped to
// the snapshot's own slice instead of every provider-managed team.
type TeamPruneScope = { kind: "national" } | { competitionSlug: string };

// Remove teams that are provider-managed (external_id set) but not part of the
// current snapshot, once they are no longer referenced by any match or used as a
// challenge's team filter (FK is set-null, so deleting would silently drop a
// challenge's scope). Run AFTER match pruning so teams orphaned by removed
// matches become deletable. Scoped (see TeamPruneScope) so each competition only
// prunes its own teams.
async function pruneStaleTeams(
  tx: Tx,
  currentTeamIds: string[],
  scope: TeamPruneScope,
): Promise<{ pruned: number; skipped: number }> {
  if (currentTeamIds.length === 0) return { pruned: 0, skipped: 0 };

  const scopeFilter =
    "kind" in scope
      ? eq(teamsTable.kind, "national")
      : eq(teamsTable.primaryCompetitionSlug, scope.competitionSlug);

  const candidates = await tx
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(
      and(
        isNotNull(teamsTable.externalId),
        // Demo-harness teams are owned by the demo service, never the provider.
        notLike(teamsTable.externalId, "demo:%"),
        scopeFilter,
        notInArray(teamsTable.id, currentTeamIds),
      ),
    );
  const candidateIds = candidates.map((c) => c.id);
  if (candidateIds.length === 0) return { pruned: 0, skipped: 0 };

  const referenced = new Set<string>();
  const matchRefs = await tx
    .select({
      homeTeamId: matchesTable.homeTeamId,
      awayTeamId: matchesTable.awayTeamId,
    })
    .from(matchesTable)
    .where(
      or(
        inArray(matchesTable.homeTeamId, candidateIds),
        inArray(matchesTable.awayTeamId, candidateIds),
      ),
    );
  for (const r of matchRefs) {
    if (r.homeTeamId) referenced.add(r.homeTeamId);
    if (r.awayTeamId) referenced.add(r.awayTeamId);
  }
  const challengeRefs = await tx
    .select({ teamId: challengesTable.teamId })
    .from(challengesTable)
    .where(inArray(challengesTable.teamId, candidateIds));
  for (const r of challengeRefs) if (r.teamId) referenced.add(r.teamId);

  const deletable = candidateIds.filter((id) => !referenced.has(id));
  if (deletable.length) {
    await tx.delete(teamsTable).where(inArray(teamsTable.id, deletable));
  }
  return { pruned: deletable.length, skipped: referenced.size };
}

// A pre-fetched snapshot ready to be written. Both the legacy World Cup provider
// and the generic ESPN engine reduce to this same teams+matches shape.
interface SnapshotInput {
  teams: ProviderTeam[];
  matches: ProviderMatch[];
}

type TournamentStatus = NonNullable<
  (typeof tournamentsTable.$inferInsert)["status"]
>;

// Optional metadata patch applied to the tournament row inside the SAME locked
// transaction as the upsert, so the season window / status / fixtures-published
// flag flip atomically with the fixtures they describe.
interface TournamentPatch {
  status?: TournamentStatus;
  hasPublishedFixtures?: boolean;
  startDate?: Date | null;
  endDate?: Date | null;
}

// Upsert one pre-fetched snapshot into one tournament row, under the shared
// football advisory lock. Teams and matches are keyed by external_id (oldest row
// canonical), then stale rows are pruned when allowed. Pruning is opt-in and
// team-pruning is scoped (see TeamPruneScope) so competitions never delete each
// other's rows.
async function applySnapshot(
  tournament: { id: string },
  snapshot: SnapshotInput,
  opts: {
    provider: string;
    prune: boolean;
    teamPruneScope: TeamPruneScope;
    tournamentPatch?: TournamentPatch;
  },
): Promise<SyncResult> {
  // Run all upserts under the shared football advisory lock so two concurrent
  // syncs (e.g. startup racing a refresh) can't both insert the same
  // external_id and create duplicate teams/matches.
  return db.transaction(async (tx) => {
    await acquireFootballLock(tx);

    if (opts.tournamentPatch && Object.keys(opts.tournamentPatch).length) {
      await tx
        .update(tournamentsTable)
        .set(opts.tournamentPatch)
        .where(eq(tournamentsTable.id, tournament.id));
    }

    // Map provider stage types to local stage ids.
    const stages = await tx.query.stagesTable.findMany({
      where: eq(stagesTable.tournamentId, tournament.id),
    });
    const stageByType = new Map<ProviderStageType, string>();
    for (const s of stages) stageByType.set(s.type as ProviderStageType, s.id);

    // ---- Upsert teams (keyed by external_id) ----
    const teamExternalIds = snapshot.teams.map((t) => t.externalId);
    // Order deterministically and keep the OLDEST row as the canonical target
    // when legacy duplicates share an external_id, so selection is stable; the
    // newer duplicates fall out of currentTeamIds and are pruned below.
    const existingTeams = teamExternalIds.length
      ? await tx
          .select({
            id: teamsTable.id,
            externalId: teamsTable.externalId,
          })
          .from(teamsTable)
          .where(inArray(teamsTable.externalId, teamExternalIds))
          .orderBy(asc(teamsTable.createdAt), asc(teamsTable.id))
      : [];
    const teamIdByExternal = new Map<string, string>();
    for (const t of existingTeams) {
      if (t.externalId && !teamIdByExternal.has(t.externalId)) {
        teamIdByExternal.set(t.externalId, t.id);
      }
    }

    let teamsUpserted = 0;
    for (const t of snapshot.teams) {
      // Default to a national team when the provider omits the kind, so the
      // legacy World Cup path keeps its national semantics.
      const kind = t.kind ?? "national";
      const primaryCompetitionSlug = t.primaryCompetitionSlug ?? null;
      const existingId = teamIdByExternal.get(t.externalId);
      if (existingId) {
        await tx
          .update(teamsTable)
          .set({
            nameEn: t.nameEn,
            nameAr: t.nameAr,
            code: t.code,
            flagUrl: t.flagUrl,
            countryCode: t.countryCode,
            kind,
            primaryCompetitionSlug,
          })
          .where(eq(teamsTable.id, existingId));
      } else {
        const [created] = await tx
          .insert(teamsTable)
          .values({
            nameEn: t.nameEn,
            nameAr: t.nameAr,
            code: t.code,
            flagUrl: t.flagUrl,
            countryCode: t.countryCode,
            externalId: t.externalId,
            kind,
            primaryCompetitionSlug,
          })
          .returning({ id: teamsTable.id });
        teamIdByExternal.set(t.externalId, created.id);
      }
      teamsUpserted += 1;
    }

    // ---- Upsert matches (keyed by external_id) ----
    const matchExternalIds = snapshot.matches.map((m) => m.externalId);
    const existingMatches = matchExternalIds.length
      ? await tx
          .select({
            id: matchesTable.id,
            externalId: matchesTable.externalId,
          })
          .from(matchesTable)
          .where(inArray(matchesTable.externalId, matchExternalIds))
          .orderBy(asc(matchesTable.createdAt), asc(matchesTable.id))
      : [];
    const matchIdByExternal = new Map<string, string>();
    for (const m of existingMatches) {
      if (m.externalId && !matchIdByExternal.has(m.externalId)) {
        matchIdByExternal.set(m.externalId, m.id);
      }
    }

    let matchesUpserted = 0;
    for (const m of snapshot.matches) {
      const lockAt = new Date(m.kickoffAt.getTime() - LOCK_LEAD_MS);
      const values = {
        tournamentId: tournament.id,
        stageId: stageByType.get(m.stageType) ?? null,
        homeTeamId: m.homeTeamExternalId
          ? (teamIdByExternal.get(m.homeTeamExternalId) ?? null)
          : null,
        awayTeamId: m.awayTeamExternalId
          ? (teamIdByExternal.get(m.awayTeamExternalId) ?? null)
          : null,
        kickoffAt: m.kickoffAt,
        predictionLockAt: lockAt,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        minute: m.minute,
        venue: m.venue,
      };
      const existingId = matchIdByExternal.get(m.externalId);
      if (existingId) {
        await tx
          .update(matchesTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(matchesTable.id, existingId));
      } else {
        const [created] = await tx
          .insert(matchesTable)
          .values({ ...values, externalId: m.externalId })
          .returning({ id: matchesTable.id });
        matchIdByExternal.set(m.externalId, created.id);
      }
      matchesUpserted += 1;
    }

    // ---- Self-heal: prune stale provider-managed rows ----
    // Matches first (frees teams referenced only by removed matches), then the
    // now-orphaned teams. Both run inside this same locked transaction. Skipped
    // entirely for narrow live fetches / partial snapshots (opts.prune=false).
    let matchPrune = { pruned: 0, skipped: 0 };
    let teamPrune = { pruned: 0, skipped: 0 };
    if (opts.prune) {
      matchPrune = await pruneStaleMatches(tx, tournament.id, [
        ...matchIdByExternal.values(),
      ]);
      teamPrune = await pruneStaleTeams(
        tx,
        [...teamIdByExternal.values()],
        opts.teamPruneScope,
      );
    }

    return {
      provider: opts.provider,
      teamsUpserted,
      matchesUpserted,
      teamsPruned: teamPrune.pruned,
      matchesPruned: matchPrune.pruned,
      teamsPruneSkipped: teamPrune.skipped,
      matchesPruneSkipped: matchPrune.skipped,
    };
  });
}

// Sync the World Cup via its dedicated legacy provider path. The WC snapshot is
// always a complete national-team bracket, so it always prunes (scoped to
// national teams, never touching club rows from the domestic competitions).
export async function syncTournament(
  slug = WORLD_CUP_SLUG,
  providerOverride?: FootballProvider,
): Promise<SyncResult> {
  const provider = providerOverride ?? getFootballProvider();

  const tournament = await db.query.tournamentsTable.findFirst({
    where: eq(tournamentsTable.slug, slug),
  });
  if (!tournament) {
    return {
      slug,
      competitionSlug: null,
      provider: provider.name,
      teamsUpserted: 0,
      matchesUpserted: 0,
      teamsPruned: 0,
      matchesPruned: 0,
      teamsPruneSkipped: 0,
      matchesPruneSkipped: 0,
      skipped: `tournament '${slug}' not seeded`,
    };
  }

  // Fetch outside the transaction so provider latency doesn't hold the lock.
  const snapshot = await provider.fetchTournament(slug);

  const result = await applySnapshot(
    tournament,
    { teams: snapshot.teams, matches: snapshot.matches },
    {
      provider: provider.name,
      prune: true,
      teamPruneScope: { kind: "national" },
    },
  );
  return {
    ...result,
    slug: tournament.slug,
    competitionSlug: tournament.competitionSlug,
  };
}

// The fields syncCompetition needs from a tournament row. Accepting this minimal
// shape (rather than the full row) keeps callers free to pass query results
// directly.
export interface CompetitionRow {
  id: string;
  slug: string;
  competitionSlug: string | null;
  providerLeagueSlug: string | null;
  type: CompetitionType;
  countryCode: string | null;
  hasPublishedFixtures: boolean;
}

// Derive the tournament status from where "now" falls in the season window.
function computeCompetitionStatus(
  season: { startDate: Date; endDate: Date },
  now: Date,
): TournamentStatus {
  if (now < season.startDate) return "upcoming";
  if (now > season.endDate) return "completed";
  return "active";
}

// Sync one domestic competition-season through the generic ESPN engine. Resolves
// the active season, refuses to write a different season's fixtures into this
// row, updates the row's season metadata, and prunes only on a complete
// full-window snapshot (never on a narrow live fetch or an empty/coming-soon
// result).
export async function syncCompetition(
  tournament: CompetitionRow,
  opts: {
    mode?: "full" | "live";
    snapshotOverride?: CompetitionSnapshot;
    now?: Date;
  } = {},
): Promise<SyncResult> {
  const provider = "espn";
  const skip = (skipped: string): SyncResult => ({
    slug: tournament.slug,
    competitionSlug: tournament.competitionSlug,
    provider,
    teamsUpserted: 0,
    matchesUpserted: 0,
    teamsPruned: 0,
    matchesPruned: 0,
    teamsPruneSkipped: 0,
    matchesPruneSkipped: 0,
    skipped,
  });

  const { competitionSlug, providerLeagueSlug } = tournament;
  if (!competitionSlug || !providerLeagueSlug) {
    return skip(`competition '${tournament.slug}' missing provider mapping`);
  }

  const now = opts.now ?? new Date();

  // Fetch outside the transaction so provider latency doesn't hold the lock.
  const snapshot =
    opts.snapshotOverride ??
    (await fetchCompetitionSnapshot({
      localSlug: tournament.slug,
      competitionSlug,
      providerLeagueSlug,
      type: tournament.type,
      countryCode: tournament.countryCode,
      mode: opts.mode ?? "full",
      now,
    }));

  // No current/upcoming season yet → "coming soon": leave the row untouched so
  // its seeded coming-soon state is preserved.
  if (!snapshot.season) {
    return skip(`competition '${competitionSlug}' has no active season`);
  }

  // Guard against writing one season's fixtures into another season's row. The
  // resolver may legitimately return next year's season as it approaches; only
  // the matching season row should receive those fixtures (admin "roll to next"
  // creates that row). Bypassed when a snapshot is injected for tests.
  if (!opts.snapshotOverride) {
    const expectedSlug = `${competitionSlug}-${snapshot.season.year}`;
    if (expectedSlug !== tournament.slug) {
      return skip(
        `season ${snapshot.season.year} is not the active row for '${tournament.slug}'`,
      );
    }
  }

  const tournamentPatch: TournamentPatch = {
    // Monotonic: once fixtures publish, don't flip back to "coming soon" on a
    // transient empty fetch.
    hasPublishedFixtures:
      tournament.hasPublishedFixtures || snapshot.hasFixtures,
    startDate: snapshot.season.startDate,
    endDate: snapshot.season.endDate,
    status: computeCompetitionStatus(snapshot.season, now),
  };

  const result = await applySnapshot(
    tournament,
    { teams: snapshot.teams, matches: snapshot.matches },
    {
      provider,
      // Prune only on a complete (full-window) snapshot with fixtures; a narrow
      // live fetch, a partial failure, or an empty result must never delete.
      prune: snapshot.complete && snapshot.matches.length > 0,
      teamPruneScope: { competitionSlug },
      tournamentPatch,
    },
  );
  return { ...result, slug: tournament.slug, competitionSlug };
}

// Sync a single tournament-season row, routing the World Cup through its
// dedicated legacy bracket path and every other competition through the generic
// ESPN engine. Used by the admin trigger-sync endpoint when targeting one
// competition.
export async function syncCompetitionRow(
  row: typeof tournamentsTable.$inferSelect,
  opts: { mode?: "full" | "live"; now?: Date } = {},
): Promise<SyncResult> {
  if (row.competitionSlug === WORLD_CUP_COMPETITION_SLUG) {
    return syncTournament(row.slug);
  }
  return syncCompetition(
    {
      id: row.id,
      slug: row.slug,
      competitionSlug: row.competitionSlug,
      providerLeagueSlug: row.providerLeagueSlug,
      type: row.type as CompetitionType,
      countryCode: row.countryCode,
      hasPublishedFixtures: row.hasPublishedFixtures,
    },
    { mode: opts.mode, now: opts.now },
  );
}

// Sync every active competition: the World Cup via its legacy path, then each
// active domestic competition through the ESPN engine. Domestic syncs only run
// when a live (non-mock) provider is configured — in offline/mock mode they stay
// in their seeded "coming soon" state. Per-competition errors are caught so one
// failing competition never aborts the rest.
export async function syncAllCompetitions(
  opts: {
    mode?: "full" | "live";
    now?: Date;
    // When provided, restrict the sync to these tournament ids (used by the hot
    // cycle to fetch ONLY competitions with a live/overdue match). Omit for a
    // full sweep across every active competition (boot, admin, idle tick).
    onlyTournamentIds?: ReadonlySet<string>;
  } = {},
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const filter = opts.onlyTournamentIds;

  // The World Cup uses its dedicated legacy path (no id in hand), so resolve its
  // row id only when a filter is present to decide whether to include it.
  if (!filter) {
    results.push(await syncTournament());
  } else {
    const wc = await db.query.tournamentsTable.findFirst({
      columns: { id: true },
      where: eq(tournamentsTable.slug, WORLD_CUP_SLUG),
    });
    if (wc && filter.has(wc.id)) {
      results.push(await syncTournament());
    }
  }

  if (!isLiveProviderConfigured()) return results;

  const competitions = await db.query.tournamentsTable.findMany({
    where: and(
      eq(tournamentsTable.isActive, true),
      isNotNull(tournamentsTable.competitionSlug),
      ne(tournamentsTable.competitionSlug, WORLD_CUP_COMPETITION_SLUG),
    ),
    orderBy: [asc(tournamentsTable.displayOrder), asc(tournamentsTable.slug)],
  });

  for (const c of competitions) {
    if (filter && !filter.has(c.id)) continue;
    try {
      results.push(
        await syncCompetition(
          {
            id: c.id,
            slug: c.slug,
            competitionSlug: c.competitionSlug,
            providerLeagueSlug: c.providerLeagueSlug,
            type: c.type as CompetitionType,
            countryCode: c.countryCode,
            hasPublishedFixtures: c.hasPublishedFixtures,
          },
          { mode: opts.mode, now: opts.now },
        ),
      );
    } catch (err) {
      results.push({
        slug: c.slug,
        competitionSlug: c.competitionSlug,
        provider: "espn",
        teamsUpserted: 0,
        matchesUpserted: 0,
        teamsPruned: 0,
        matchesPruned: 0,
        teamsPruneSkipped: 0,
        matchesPruneSkipped: 0,
        skipped: `competition '${c.slug}' sync failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  return results;
}
