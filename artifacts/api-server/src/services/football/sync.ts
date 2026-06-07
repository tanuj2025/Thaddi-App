// Sync World Cup 2026 teams and fixtures from the active football provider into
// the local schema. Idempotent: rows are matched by external_id and updated in
// place, so repeated runs converge (and keep live score/status/minute fresh).
//
// predictionLockAt is computed here as kickoff - 30 minutes — the single
// authoritative lock boundary for predictions.
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

import { and, asc, eq, inArray, isNotNull, notInArray, or } from "drizzle-orm";
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
import { getFootballProvider } from "./index";
import { acquireFootballLock } from "./lock";
import type { ProviderStageType } from "./types";

const LOCK_LEAD_MS = 30 * 60 * 1000;

export interface SyncResult {
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

// Remove teams that are provider-managed (external_id set) but not part of the
// current snapshot, once they are no longer referenced by any match or used as a
// challenge's team filter (FK is set-null, so deleting would silently drop a
// challenge's scope). Run AFTER match pruning so teams orphaned by removed
// matches become deletable.
async function pruneStaleTeams(
  tx: Tx,
  currentTeamIds: string[],
): Promise<{ pruned: number; skipped: number }> {
  if (currentTeamIds.length === 0) return { pruned: 0, skipped: 0 };

  const candidates = await tx
    .select({ id: teamsTable.id })
    .from(teamsTable)
    .where(
      and(
        isNotNull(teamsTable.externalId),
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

export async function syncTournament(
  slug = "fifa-world-cup-2026",
): Promise<SyncResult> {
  const provider = getFootballProvider();

  const tournament = await db.query.tournamentsTable.findFirst({
    where: eq(tournamentsTable.slug, slug),
  });
  if (!tournament) {
    return {
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

  // Run all upserts under the shared football advisory lock so two concurrent
  // syncs (e.g. startup racing a refresh) can't both insert the same
  // external_id and create duplicate teams/matches.
  return db.transaction(async (tx) => {
    await acquireFootballLock(tx);

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
    // now-orphaned teams. Both run inside this same locked transaction.
    const matchPrune = await pruneStaleMatches(tx, tournament.id, [
      ...matchIdByExternal.values(),
    ]);
    const teamPrune = await pruneStaleTeams(tx, [...teamIdByExternal.values()]);

    return {
      provider: provider.name,
      teamsUpserted,
      matchesUpserted,
      teamsPruned: teamPrune.pruned,
      matchesPruned: matchPrune.pruned,
      teamsPruneSkipped: teamPrune.skipped,
      matchesPruneSkipped: matchPrune.skipped,
    };
  });
}
