// Platform billing-season ("pass season") resolution.
//
// THADDI sells ONE all-access pass PER SEASON. The pass is a premium PLAN
// (Professional/Legend/…) scoped to a season "edition" so each new season is a
// fresh purchase. Historically there was a single hardcoded edition
// "world_cup_2026"; this module generalizes that to a canonical, season-keyed
// edition while treating the legacy value as an ALIAS of the 2026 season — so
// no existing purchaser is stranded (their pass keeps working) and none is
// double-charged (re-buying the season they already own is recognized).
//
// "Season" here is a single PLATFORM billing season, not per-competition. The
// featured competitions run on two cadences (the World Cup season "2026" in
// summer 2026; the domestic leagues/cups on "2026/27" Aug 2026–May 2027), and a
// single pass spans whichever season the platform is currently in.

import { isNotNull } from "drizzle-orm";
import { db, tournamentsTable } from "@workspace/db";

// The legacy edition string written by the original single-World-Cup billing.
// It denotes the SAME season as the canonical 2026 pass.
export const LEGACY_WORLD_CUP_EDITION = "world_cup_2026";

// Canonical edition for the 2026 (World Cup) season. Legacy world_cup_2026 rows
// are equivalent to this; RevenueCat's unscoped entitlements belong to it too.
export const LEGACY_SEASON_EDITION = "season_2026";

// Canonicalize any raw edition string to the stable form `season_<key>`. Season
// keys use "/" or "-" (e.g. "2026/27"); we normalize separators to "_" so the
// edition is a single comparable token.
//   "world_cup_2026" -> "season_2026"   (legacy alias)
//   "2026"           -> "season_2026"
//   "2026/27"        -> "season_2026_27"
//   "season_2026_27" -> "season_2026_27" (already canonical, passthrough)
export function canonicalizePassEdition(raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return LEGACY_SEASON_EDITION; // defensive: empty -> legacy season
  if (v === LEGACY_WORLD_CUP_EDITION) return LEGACY_SEASON_EDITION;
  if (v.startsWith("season_")) return v;
  const norm = v.replace(/[/\-\s]+/g, "_").replace(/_+/g, "_");
  return `season_${norm}`;
}

// All edition strings EQUIVALENT to a canonical edition. The active-pass guards
// (checkout dedupe, supersede/upgrade, entitlement scoping) use this so a legacy
// world_cup_2026 row is treated as the same season as season_2026. Forward
// seasons have no legacy alias, so they alias only to themselves.
export function editionAliases(canonical: string): string[] {
  if (canonical === LEGACY_SEASON_EDITION) {
    return [LEGACY_SEASON_EDITION, LEGACY_WORLD_CUP_EDITION, "2026"];
  }
  return [canonical];
}

// True for the legacy 2026 season, whose pass RevenueCat sells via UNSCOPED
// entitlement lookup keys (the original "professional"/"legend" entitlements).
// Only during this season may those unscoped keys grant a pass; for any later
// season the buyer needs a season-scoped entitlement (see revenuecat.ts).
export function isLegacySeasonEdition(canonical: string): boolean {
  return canonical === LEGACY_SEASON_EDITION;
}

// A season's billing window as consumed by the season-selection policy below.
// Mirrors the columns deriveCurrentSeasonFromDb reads from `tournaments`.
export interface SeasonWindowRow {
  season: string | null;
  startDate: Date | null;
  endDate: Date | null;
  displayOrder: number;
}

// PURE season-selection policy. Given the dated season windows and a moment
// `now`, returns the raw current season key (e.g. "2026" or "2026/27") or null
// when no dated season applies.
//
// Among the seasons whose window covers `now` we pick the one ENDING SOONEST:
// the platform stays on the established season until it actually concludes, then
// rolls forward. (Picking the latest-START season would prematurely roll the
// pass forward during a competition overlap — e.g. the King's Cup opening on
// Jul 1 2026 would strand World Cup pass holders before the Jul 19 final.) With
// no covering season we take the nearest UPCOMING one (by start), so a pass can
// be pre-purchased; ties break by displayOrder.
//
// Kept separate from the DB read so the policy is unit-testable deterministically
// — the live `tournaments` table is mutated continuously by the sync scheduler,
// so asserting the policy against it directly is inherently racy.
export function pickCurrentSeasonFromWindows(
  rows: SeasonWindowRow[],
  now: Date,
): string | null {
  const dated = rows.filter(
    (r): r is SeasonWindowRow & {
      startDate: Date;
      endDate: Date;
      season: string;
    } => Boolean(r.startDate && r.endDate && r.season),
  );

  const covering = dated.filter((r) => r.startDate <= now && now <= r.endDate);
  if (covering.length > 0) {
    covering.sort(
      (a, b) =>
        a.endDate.getTime() - b.endDate.getTime() ||
        a.displayOrder - b.displayOrder,
    );
    return covering[0].season;
  }

  const upcoming = dated.filter((r) => r.startDate > now);
  if (upcoming.length > 0) {
    upcoming.sort(
      (a, b) =>
        a.startDate.getTime() - b.startDate.getTime() ||
        a.displayOrder - b.displayOrder,
    );
    return upcoming[0].season;
  }

  return null;
}

// DB-derived current pass season key (raw, e.g. "2026" or "2026/27"), or null
// when no dated season exists. Reads the live tournament windows and applies the
// pure pickCurrentSeasonFromWindows policy.
async function deriveCurrentSeasonFromDb(now: Date): Promise<string | null> {
  const rows = await db
    .select({
      season: tournamentsTable.season,
      startDate: tournamentsTable.startDate,
      endDate: tournamentsTable.endDate,
      displayOrder: tournamentsTable.displayOrder,
    })
    .from(tournamentsTable)
    .where(isNotNull(tournamentsTable.season));

  return pickCurrentSeasonFromWindows(rows, now);
}

// Resolves the CURRENT canonical pass edition. Resolution order:
//   1. PASS_SEASON_KEY env override (canonical knob for ops/testing),
//   2. deprecated TOURNAMENT_EDITION env (back-compat with the old single knob),
//   3. the DB-derived current/upcoming tournament season,
//   4. calendar-year fallback (season_<year>) when no tournament is dated.
// On Jun 19 2026 this resolves to season_2026 (the World Cup covers now), so
// existing world_cup_2026 holders keep premium without any data migration.
export async function resolveCurrentPassEdition(
  now: Date = new Date(),
): Promise<string> {
  const override = process.env.PASS_SEASON_KEY;
  if (override && override.trim()) return canonicalizePassEdition(override);

  const deprecated = process.env.TOURNAMENT_EDITION;
  if (deprecated && deprecated.trim()) {
    return canonicalizePassEdition(deprecated);
  }

  const derived = await deriveCurrentSeasonFromDb(now);
  if (derived) return canonicalizePassEdition(derived);

  return `season_${now.getUTCFullYear()}`;
}

// RevenueCat entitlement lookup-key convention for a season-scoped pass:
// `{edition}__{planCode}` (e.g. "season_2026_27__professional"). Future-season
// products use this so a season_2026 buyer's lifetime entitlement never silently
// grants a later season. The legacy 2026 products keep using the bare plan code
// (see parseRevenueCatEntitlementLookup / revenuecat.ts).
export function revenueCatEntitlementLookup(
  planCode: string,
  edition: string,
): string {
  return `${canonicalizePassEdition(edition)}__${planCode}`;
}

// Parse a RevenueCat entitlement lookup_key back into { edition, planCode }.
// A season-scoped key "season_2026_27__professional" yields its edition; a bare
// legacy key "professional" has no edition (null) and is honored only for the
// legacy 2026 season.
export function parseRevenueCatEntitlementLookup(lookupKey: string): {
  edition: string | null;
  planCode: string;
} {
  const idx = lookupKey.indexOf("__");
  if (idx === -1) return { edition: null, planCode: lookupKey };
  return {
    edition: canonicalizePassEdition(lookupKey.slice(0, idx)),
    planCode: lookupKey.slice(idx + 2),
  };
}
