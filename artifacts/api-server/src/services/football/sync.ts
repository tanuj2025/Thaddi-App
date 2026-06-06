// Sync World Cup 2026 teams and fixtures from the active football provider into
// the local schema. Idempotent: rows are matched by external_id and updated in
// place, so repeated runs converge (and keep live score/status/minute fresh).
//
// predictionLockAt is computed here as kickoff - 30 minutes — the single
// authoritative lock boundary for predictions.

import { eq, inArray } from "drizzle-orm";
import {
  db,
  tournamentsTable,
  stagesTable,
  teamsTable,
  matchesTable,
} from "@workspace/db";
import { getFootballProvider } from "./index";
import { acquireFootballLock } from "./lock";
import type { ProviderStageType } from "./types";

const LOCK_LEAD_MS = 30 * 60 * 1000;

export interface SyncResult {
  provider: string;
  teamsUpserted: number;
  matchesUpserted: number;
  skipped?: string;
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
    const existingTeams = teamExternalIds.length
      ? await tx
          .select({ id: teamsTable.id, externalId: teamsTable.externalId })
          .from(teamsTable)
          .where(inArray(teamsTable.externalId, teamExternalIds))
      : [];
    const teamIdByExternal = new Map<string, string>();
    for (const t of existingTeams) {
      if (t.externalId) teamIdByExternal.set(t.externalId, t.id);
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
          .select({ id: matchesTable.id, externalId: matchesTable.externalId })
          .from(matchesTable)
          .where(inArray(matchesTable.externalId, matchExternalIds))
      : [];
    const matchIdByExternal = new Map<string, string>();
    for (const m of existingMatches) {
      if (m.externalId) matchIdByExternal.set(m.externalId, m.id);
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
        await tx
          .insert(matchesTable)
          .values({ ...values, externalId: m.externalId });
      }
      matchesUpserted += 1;
    }

    return {
      provider: provider.name,
      teamsUpserted,
      matchesUpserted,
    };
  });
}
