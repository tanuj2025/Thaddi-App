// One-time, idempotent realignment of existing provider-managed rows onto the
// ESPN World Cup id scheme, run on boot BEFORE the tournament sync when ESPN is
// the active provider.
//
// Why this exists: teams/matches are keyed by external_id, but different
// providers use different schemes (football-data.org uses numeric ids like
// "537327"; ESPN uses "espnw-match-…" / "espnw-team-…"). Production rows already
// carry real users' predictions, which reference the match UUID — NOT the
// external_id. If we simply switched to ESPN, the sync would not recognise the
// old-scheme rows, would INSERT brand-new ESPN rows, and the prune step would be
// blocked from removing the old rows because predictions reference them — the
// app would show fresh, prediction-less duplicates while the real predictions
// sit on stale, never-updated rows.
//
// The fix: rewrite the external_id of the existing rows onto ESPN's scheme so
// the very next sync UPDATES them in place (live score/status/minute flow in)
// and predictions stay attached (match UUIDs never change). Only the external_id
// columns are touched here — never UUIDs, predictions, history, ledger, or
// challenge match selections.
//
// Matching is content-based: teams by ISO country code (fallback: normalized
// English name), matches by the unordered pair of (now-remapped) team UUIDs plus
// kickoff date. Unmatched rows are logged and left untouched (the sync's
// prune/insert handles genuinely stale or new rows). Once converged, every row
// is already on the espnw- scheme and excluded from the candidate set, so a
// second run is a no-op.

import { and, eq, inArray, isNotNull, notLike } from "drizzle-orm";
import {
  db,
  tournamentsTable,
  teamsTable,
  matchesTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import { getFootballProvider } from "./index";
import { acquireFootballLock } from "./lock";
import { normalizeName, lookupTeamI18n } from "./teamI18n";
import type { FootballProvider } from "./types";

const ESPN_PREFIX = "espnw-";

export interface ReconcileResult {
  provider: string;
  teamsRemapped: number;
  matchesRemapped: number;
  teamsUnmatched: number;
  matchesUnmatched: number;
  skipped?: string;
}

const EMPTY: Omit<ReconcileResult, "provider"> = {
  teamsRemapped: 0,
  matchesRemapped: 0,
  teamsUnmatched: 0,
  matchesUnmatched: 0,
};

// UTC calendar day of a kickoff, used as a tolerant tiebreaker when the same
// team pair could appear more than once across the tournament.
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

// Realign existing rows onto the ESPN id scheme. No-op (skipped) unless ESPN is
// the active provider, so it is safe to call unconditionally on boot.
export async function reconcileEspnExternalIds(
  slug = "fifa-world-cup-2026",
  providerOverride?: FootballProvider,
): Promise<ReconcileResult> {
  const provider = providerOverride ?? getFootballProvider();
  if (provider.name !== "espn-wc") {
    return { provider: provider.name, ...EMPTY, skipped: "provider not espn-wc" };
  }

  // Fetch outside the transaction so provider latency doesn't hold the lock.
  const snapshot = await provider.fetchTournament(slug);
  if (snapshot.teams.length === 0 || snapshot.matches.length === 0) {
    return {
      provider: provider.name,
      ...EMPTY,
      skipped: "empty ESPN snapshot",
    };
  }

  return db.transaction(async (tx) => {
    await acquireFootballLock(tx);

    const tournament = await tx.query.tournamentsTable.findFirst({
      where: eq(tournamentsTable.slug, slug),
    });
    if (!tournament) {
      return {
        provider: provider.name,
        ...EMPTY,
        skipped: `tournament '${slug}' not seeded`,
      };
    }

    // ---- Teams: remap old-scheme rows onto espnw-team-* ids ----
    // ESPN target lookups: by ISO country code and by normalized English name.
    const espnByCc = new Map<string, string>();
    const espnByName = new Map<string, string>();
    for (const t of snapshot.teams) {
      if (t.countryCode) espnByCc.set(t.countryCode.toLowerCase(), t.externalId);
      espnByName.set(normalizeName(t.nameEn), t.externalId);
    }

    const allTeams = await tx
      .select({
        id: teamsTable.id,
        externalId: teamsTable.externalId,
        nameEn: teamsTable.nameEn,
        countryCode: teamsTable.countryCode,
      })
      .from(teamsTable)
      .where(isNotNull(teamsTable.externalId));

    // External ids already on the ESPN scheme are off-limits as remap targets
    // (the team that owns them already converged) — prevents creating duplicate
    // external_ids and makes a second run a no-op.
    const takenEspnIds = new Set<string>();
    for (const t of allTeams) {
      if (t.externalId?.startsWith(ESPN_PREFIX)) takenEspnIds.add(t.externalId);
    }

    let teamsRemapped = 0;
    let teamsUnmatched = 0;
    for (const t of allTeams) {
      const ext = t.externalId;
      if (!ext || ext.startsWith(ESPN_PREFIX) || ext.startsWith("demo:")) {
        continue;
      }
      // Prefer the stored country code, but fall back to the curated map when it
      // is null (football-data left some teams uncoded, e.g. "Cape Verde
      // Islands") so they still resolve to the right ESPN team instead of
      // duplicating.
      const cc =
        t.countryCode?.toLowerCase() ?? lookupTeamI18n(t.nameEn)?.cc ?? null;
      const target =
        (cc && espnByCc.get(cc)) || espnByName.get(normalizeName(t.nameEn));
      if (!target) {
        teamsUnmatched += 1;
        logger.warn(
          { teamId: t.id, externalId: ext, nameEn: t.nameEn },
          "reconcile: no ESPN team match (left untouched)",
        );
        continue;
      }
      if (takenEspnIds.has(target)) {
        // Some other row already owns this ESPN id — would create a duplicate.
        teamsUnmatched += 1;
        logger.warn(
          { teamId: t.id, externalId: ext, target },
          "reconcile: ESPN team id already taken (left untouched)",
        );
        continue;
      }
      await tx
        .update(teamsTable)
        .set({ externalId: target })
        .where(eq(teamsTable.id, t.id));
      takenEspnIds.add(target);
      teamsRemapped += 1;
    }

    // ---- Matches: remap old-scheme rows onto espnw-match-* ids ----
    // Resolve every ESPN team external id (now present in the DB after the team
    // remap above) to its team UUID, so ESPN matches can be keyed by team UUID.
    const espnTeamExtIds = [...new Set(snapshot.teams.map((t) => t.externalId))];
    const teamRows = espnTeamExtIds.length
      ? await tx
          .select({ id: teamsTable.id, externalId: teamsTable.externalId })
          .from(teamsTable)
          .where(inArray(teamsTable.externalId, espnTeamExtIds))
      : [];
    const uuidByEspnExt = new Map<string, string>();
    for (const r of teamRows) {
      if (r.externalId) uuidByEspnExt.set(r.externalId, r.id);
    }

    // Build ESPN match lookups keyed by team-pair (+ day). Track how often each
    // pair occurs so we only trust a pair-without-day match when it is unique.
    const espnByPairDay = new Map<string, string>();
    const espnByPair = new Map<string, string>();
    const pairCount = new Map<string, number>();
    for (const m of snapshot.matches) {
      if (!m.homeTeamExternalId || !m.awayTeamExternalId) continue;
      const home = uuidByEspnExt.get(m.homeTeamExternalId);
      const away = uuidByEspnExt.get(m.awayTeamExternalId);
      if (!home || !away) continue;
      const pk = pairKey(home, away);
      espnByPairDay.set(`${pk}|${dayKey(m.kickoffAt)}`, m.externalId);
      espnByPair.set(pk, m.externalId);
      pairCount.set(pk, (pairCount.get(pk) ?? 0) + 1);
    }

    const candidateMatches = await tx
      .select({
        id: matchesTable.id,
        externalId: matchesTable.externalId,
        homeTeamId: matchesTable.homeTeamId,
        awayTeamId: matchesTable.awayTeamId,
        kickoffAt: matchesTable.kickoffAt,
      })
      .from(matchesTable)
      .where(
        and(
          eq(matchesTable.tournamentId, tournament.id),
          isNotNull(matchesTable.externalId),
          notLike(matchesTable.externalId, "demo:%"),
          notLike(matchesTable.externalId, `${ESPN_PREFIX}%`),
        ),
      );

    const takenEspnMatchIds = new Set<string>();
    const allMatchExt = await tx
      .select({ externalId: matchesTable.externalId })
      .from(matchesTable)
      .where(
        and(
          eq(matchesTable.tournamentId, tournament.id),
          isNotNull(matchesTable.externalId),
        ),
      );
    for (const r of allMatchExt) {
      if (r.externalId?.startsWith(ESPN_PREFIX)) {
        takenEspnMatchIds.add(r.externalId);
      }
    }

    let matchesRemapped = 0;
    let matchesUnmatched = 0;
    for (const m of candidateMatches) {
      if (!m.homeTeamId || !m.awayTeamId) {
        matchesUnmatched += 1;
        continue;
      }
      const pk = pairKey(m.homeTeamId, m.awayTeamId);
      let target = espnByPairDay.get(`${pk}|${dayKey(m.kickoffAt)}`);
      if (!target && (pairCount.get(pk) ?? 0) === 1) {
        // Pair is unique across the tournament → safe to match without the day,
        // tolerating small kickoff-time differences between providers.
        target = espnByPair.get(pk);
      }
      if (!target || takenEspnMatchIds.has(target)) {
        matchesUnmatched += 1;
        logger.warn(
          { matchId: m.id, externalId: m.externalId },
          "reconcile: no unique ESPN match (left untouched)",
        );
        continue;
      }
      await tx
        .update(matchesTable)
        .set({ externalId: target })
        .where(eq(matchesTable.id, m.id));
      takenEspnMatchIds.add(target);
      matchesRemapped += 1;
    }

    return {
      provider: provider.name,
      teamsRemapped,
      matchesRemapped,
      teamsUnmatched,
      matchesUnmatched,
    };
  });
}
