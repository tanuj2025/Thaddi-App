// Competition + club reference reads shared by the public platform routes and
// the ranking service. One tournament row = one competition-season; rows with
// the same competitionSlug are the seasons of a single competition.

import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  tournamentsTable,
  teamsTable,
  type Tournament,
} from "@workspace/db";

// Stable grouping slug for the World Championship. Unscoped schedule/upcoming reads
// prefer it so prod's landing schedule never silently switches to a domestic
// league once the other competitions go active.
export const WORLD_CHAMPIONSHIP_COMPETITION_SLUG = "world.champ";

// Resolve a specific competition-season tournament. With an explicit season key
// the matching row is used verbatim. Without one, the "current" season is picked
// the same way the provider's pickSeason does — the season covering now (most
// recently started on overlap), else the nearest UPCOMING one — so an ended
// campaign is never resurfaced. Coming-soon shells (no date window) are ignored,
// yielding a null result (caller treats it as "coming soon").
export async function resolveCompetitionTournament(
  competitionSlug: string,
  season: string | null,
  now: Date = new Date(),
): Promise<Tournament | null> {
  const rows = await db
    .select()
    .from(tournamentsTable)
    .where(
      season
        ? and(
            eq(tournamentsTable.competitionSlug, competitionSlug),
            eq(tournamentsTable.season, season),
          )
        : eq(tournamentsTable.competitionSlug, competitionSlug),
    );
  if (rows.length === 0) return null;
  if (season) return rows[0];

  const dated = rows.filter((r) => r.startDate && r.endDate);
  const covering = dated.filter(
    (r) => r.startDate! <= now && now <= r.endDate!,
  );
  if (covering.length > 0) {
    return covering.sort(
      (a, b) => b.startDate!.getTime() - a.startDate!.getTime(),
    )[0];
  }
  const upcoming = dated.filter((r) => r.startDate! > now);
  if (upcoming.length > 0) {
    return upcoming.sort(
      (a, b) => a.startDate!.getTime() - b.startDate!.getTime(),
    )[0];
  }
  return null;
}

// Default tournament for UNSCOPED schedule/upcoming reads (no competitionSlug
// param). Prefers the active World Championship so the public landing schedule stays
// pinned to it; otherwise the active competition with the lowest displayOrder.
// Deterministic, unlike the previous bare `isActive LIMIT 1`.
export async function resolveDefaultTournament(
  _now: Date = new Date(),
): Promise<Tournament | null> {
  const active = await db
    .select()
    .from(tournamentsTable)
    .where(eq(tournamentsTable.isActive, true));
  if (active.length === 0) return null;
  const wc = active.find(
    (t) => t.competitionSlug === WORLD_CHAMPIONSHIP_COMPETITION_SLUG,
  );
  if (wc) return wc;
  return active
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)[0];
}

// Featured tournament for the competitions list: the current/upcoming dated
// season (same rule as resolveCompetitionTournament), else an active coming-soon
// shell (no date window), else null when only ended seasons remain.
function pickFeatured(group: Tournament[], now: Date): Tournament | null {
  const dated = group.filter((r) => r.startDate && r.endDate);
  const covering = dated.filter(
    (r) => r.startDate! <= now && now <= r.endDate!,
  );
  if (covering.length > 0) {
    return covering.sort(
      (a, b) => b.startDate!.getTime() - a.startDate!.getTime(),
    )[0];
  }
  const upcoming = dated.filter((r) => r.startDate! > now);
  if (upcoming.length > 0) {
    return upcoming.sort(
      (a, b) => a.startDate!.getTime() - b.startDate!.getTime(),
    )[0];
  }
  return group.find((r) => r.isActive && !(r.startDate && r.endDate)) ?? null;
}

export interface CompetitionSeasonDto {
  season: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  officialStartDate: string | null;
  officialEndDate: string | null;
  hasPublishedFixtures: boolean;
  // True when this season has no published date window yet (coming-soon shell).
  comingSoon: boolean;
}

export interface CompetitionDto {
  competitionSlug: string;
  nameEn: string;
  nameAr: string;
  logoUrl: string | null;
  countryCode: string | null;
  displayOrder: number;
  isActive: boolean;
  // The current/upcoming season for this competition, or null when only ended
  // seasons exist.
  currentSeason: CompetitionSeasonDto | null;
  // All selectable seasons (those with published fixtures) for this
  // competition, most recent first. Empty when only coming-soon seasons exist.
  // currentSeason is the default selection within this list.
  seasons: CompetitionSeasonDto[];
}

// One competition-season row → public DTO. Shared by currentSeason and the
// selectable seasons list so the two never drift.
function toSeasonDto(t: Tournament): CompetitionSeasonDto {
  return {
    season: t.season,
    status: t.status,
    startDate: t.startDate?.toISOString() ?? null,
    endDate: t.endDate?.toISOString() ?? null,
    officialStartDate: t.officialStartDate?.toISOString() ?? null,
    officialEndDate: t.officialEndDate?.toISOString() ?? null,
    hasPublishedFixtures: t.hasPublishedFixtures,
    comingSoon: !(t.startDate && t.endDate),
  };
}

// Most-recent-first ordering for the seasons list. The date window is the
// source of truth (robust to mixed season-key formats like "2025" vs
// "2025-2026"); the season key only breaks ties when windows match or are
// absent.
function bySeasonRecency(a: Tournament, b: Tournament): number {
  const as = a.startDate?.getTime() ?? -Infinity;
  const bs = b.startDate?.getTime() ?? -Infinity;
  if (as !== bs) return bs - as;
  const ae = a.endDate?.getTime() ?? -Infinity;
  const be = b.endDate?.getTime() ?? -Infinity;
  if (ae !== be) return be - ae;
  return (b.season ?? "").localeCompare(a.season ?? "");
}

// Public list of competitions with their current/upcoming season, ordered by
// displayOrder. Competition metadata (names, country, order) is shared across
// seasons, so any row of the group is authoritative for it.
export async function listCompetitions(
  now: Date = new Date(),
): Promise<CompetitionDto[]> {
  const rows = await db
    .select()
    .from(tournamentsTable)
    .where(isNotNull(tournamentsTable.competitionSlug));

  const bySlug = new Map<string, Tournament[]>();
  for (const r of rows) {
    if (!r.competitionSlug) continue;
    const arr = bySlug.get(r.competitionSlug) ?? [];
    arr.push(r);
    bySlug.set(r.competitionSlug, arr);
  }

  const out: CompetitionDto[] = [];
  for (const [slug, group] of bySlug) {
    const featured = pickFeatured(group, now);
    const meta = featured ?? group[0];
    // Selectable seasons = those with a real, published leaderboard. Coming-soon
    // shells (no published fixtures) and rows missing a season key are excluded,
    // then ordered most-recent-first so the picker defaults to the latest.
    const seasons = group
      .filter((t) => t.hasPublishedFixtures && t.season != null)
      .sort(bySeasonRecency)
      .map(toSeasonDto);
    out.push({
      competitionSlug: slug,
      nameEn: meta.nameEn,
      nameAr: meta.nameAr,
      logoUrl: meta.logoUrl ?? null,
      countryCode: meta.countryCode ?? null,
      displayOrder: meta.displayOrder,
      isActive: group.some((t) => t.isActive),
      currentSeason: featured ? toSeasonDto(featured) : null,
      seasons,
    });
  }
  return out.sort((a, b) => a.displayOrder - b.displayOrder);
}

export interface ClubRefDto {
  id: string;
  nameEn: string;
  nameAr: string;
  code: string | null;
  countryCode: string | null;
  crestUrl: string | null;
}

export interface ClubGroupDto {
  competitionSlug: string | null;
  nameEn: string;
  nameAr: string;
  countryCode: string | null;
  displayOrder: number;
  clubs: ClubRefDto[];
}

// Public list of clubs (kind="club") grouped by their primary competition, for
// the favourite-club picker. National teams (GET /teams) are unaffected.
export async function listClubGroups(): Promise<ClubGroupDto[]> {
  const clubs = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.kind, "club"))
    .orderBy(asc(teamsTable.nameEn));

  const comps = await db
    .select({
      competitionSlug: tournamentsTable.competitionSlug,
      nameEn: tournamentsTable.nameEn,
      nameAr: tournamentsTable.nameAr,
      countryCode: tournamentsTable.countryCode,
      displayOrder: tournamentsTable.displayOrder,
    })
    .from(tournamentsTable)
    .where(isNotNull(tournamentsTable.competitionSlug));

  const metaBySlug = new Map<
    string,
    { nameEn: string; nameAr: string; countryCode: string | null; displayOrder: number }
  >();
  for (const c of comps) {
    if (!c.competitionSlug || metaBySlug.has(c.competitionSlug)) continue;
    metaBySlug.set(c.competitionSlug, {
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      countryCode: c.countryCode ?? null,
      displayOrder: c.displayOrder,
    });
  }

  const bySlug = new Map<string, ClubRefDto[]>();
  for (const t of clubs) {
    const slug = t.primaryCompetitionSlug ?? "";
    const arr = bySlug.get(slug) ?? [];
    arr.push({
      id: t.id,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      code: t.code ?? null,
      countryCode: t.countryCode ?? null,
      crestUrl: t.flagUrl ?? null,
    });
    bySlug.set(slug, arr);
  }

  const groups: ClubGroupDto[] = [];
  for (const [slug, clubList] of bySlug) {
    const meta = slug ? metaBySlug.get(slug) : undefined;
    groups.push({
      competitionSlug: slug || null,
      nameEn: meta?.nameEn ?? slug,
      nameAr: meta?.nameAr ?? slug,
      countryCode: meta?.countryCode ?? null,
      displayOrder: meta?.displayOrder ?? 999,
      clubs: clubList,
    });
  }
  return groups.sort((a, b) => a.displayOrder - b.displayOrder);
}
