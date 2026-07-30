// Generic, season-adaptive ESPN adapter for the multi-competition engine.
//
// Where espnWorldChampionshipProvider.ts is hardwired to one league + a fixed bracket
// window, this module fetches ANY ESPN soccer league by slug for the season the
// competition is currently in (or the next upcoming one). It powers the new
// domestic competitions — Premier League (eng.1), LaLiga (esp.1), Saudi Pro
// League (ksa.1) and the Saudi King's Cup (ksa.kings.cup) — and is generic
// enough to also assemble a World Championship snapshot (type "WORLD_CHAMPIONSHIP").
//
// Season selection is the crux: ESPN's bare scoreboard returns the season that
// contains TODAY, so OFF-SEASON it hands back the just-ENDED campaign's final
// matchday. Featuring that would resurface a finished season. Instead we read
// the core API seasons list (which carries each season's start/end window) and
// deliberately pick the season covering now, else the nearest UPCOMING one,
// never an ended one. When no current/future season exists the competition is
// "coming soon" (resolves to null) and the sync leaves its shell untouched.
//
// External IDs are namespaced `espn:{competition}:{kind}:{id}` (e.g.
// `espn:eng.1:team:359`, `espn:eng.1:event:704321`) so they can never collide
// across competitions or with the World Championship's legacy `espnw-` scheme.

import type {
  ProviderMatch,
  ProviderStageType,
  ProviderTeam,
} from "./types";
import {
  isPlaceholderTeam,
  mapStage,
  mapStatus,
  type EspnWorldChampionshipEvent,
} from "./espnWorldChampionshipProvider";
import { flag, lookupClubI18n, lookupTeamI18n } from "./teamI18n";

const CORE_BASE =
  "https://sports.core.api.espn.com/v2/sports/soccer/leagues";
const SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

const FETCH_TIMEOUT_MS = 15_000;
// ESPN's scoreboard caps how many events a single date-range call returns, so a
// full domestic season (e.g. 380 PL fixtures) must be fetched in chunks and
// recombined. ~35 days comfortably covers a month of matchweeks per request.
const CHUNK_DAYS = 35;
// Live refresh window: yesterday through a few days out. Narrow + cheap, run
// often; never a complete snapshot so it never triggers a prune.
const LIVE_BACK_DAYS = 1;
const DEFAULT_LIVE_FORWARD_DAYS = 3;

export type CompetitionType = "league" | "cup" | "WORLD_CHAMPIONSHIP";

export interface SeasonWindow {
  year: number;
  startDate: Date;
  endDate: Date;
  displayName: string | null;
}

export interface CompetitionSnapshot {
  slug: string;
  teams: ProviderTeam[];
  matches: ProviderMatch[];
  // True only when the full season window was fetched without any failed chunk,
  // so the caller may safely prune rows the snapshot no longer references. Live
  // (narrow-window) fetches and partial failures are never complete.
  complete: boolean;
  // Whether the provider returned any fixtures at all for the resolved season.
  hasFixtures: boolean;
  // The resolved season, or null when the competition is "coming soon".
  season: SeasonWindow | null;
}

// ---------------------------------------------------------------------------
// External-ID namespacing
// ---------------------------------------------------------------------------

export function teamExternalId(
  competitionSlug: string,
  id: string | number,
): string {
  return `espn:${competitionSlug}:team:${id}`;
}

export function matchExternalId(
  competitionSlug: string,
  id: string | number,
): string {
  return `espn:${competitionSlug}:event:${id}`;
}

// ---------------------------------------------------------------------------
// Stage mapping
// ---------------------------------------------------------------------------

// Round-robin leagues collapse to a single "league" stage; knockout
// competitions (cups, the World Championship bracket) reuse the World Championship slug→stage
// mapper. Exported for unit testing.
export function mapCompetitionStage(
  type: CompetitionType,
  slug: string | null | undefined,
): ProviderStageType {
  if (type === "league") return "league";
  return mapStage(slug);
}

// ---------------------------------------------------------------------------
// Season resolution
// ---------------------------------------------------------------------------

// Pull the 4-digit season year out of a core-API season $ref such as
// "https://.../leagues/eng.1/seasons/2026?lang=en&region=us". Exported for
// unit testing.
export function parseYearFromRef(ref: string): number | null {
  const m = /\/seasons\/(\d{4})/.exec(ref ?? "");
  return m ? Number(m[1]) : null;
}

// Choose the season to feature from a set of candidate windows: the one
// CONTAINING `now` (most recently started, if several overlap), else the
// nearest UPCOMING one, else null (every candidate has already ended →
// "coming soon"). Pure + exported for unit testing.
export function pickSeason(
  windows: SeasonWindow[],
  now: Date,
): SeasonWindow | null {
  const t = now.getTime();
  const notEnded = windows.filter((w) => w.endDate.getTime() > t);
  if (notEnded.length === 0) return null;

  const current = notEnded
    .filter((w) => w.startDate.getTime() <= t)
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
  if (current) return current;

  return notEnded.sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  )[0];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`ESPN request failed (${res.status}) for ${url}`);
  }
  return (await res.json()) as T;
}

async function fetchSeasonRefs(providerLeagueSlug: string): Promise<string[]> {
  const url = `${CORE_BASE}/${providerLeagueSlug}/seasons?limit=12`;
  const data = await fetchJson<{ items?: { $ref: string }[] }>(url);
  return (data.items ?? []).map((i) => i.$ref).filter(Boolean);
}

async function fetchSeasonDetail(
  providerLeagueSlug: string,
  year: number,
): Promise<SeasonWindow | null> {
  const url = `${CORE_BASE}/${providerLeagueSlug}/seasons/${year}`;
  const data = await fetchJson<{
    year?: number;
    startDate?: string;
    endDate?: string;
    displayName?: string;
  }>(url);
  if (!data.startDate || !data.endDate) return null;
  return {
    year: data.year ?? year,
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
    displayName: data.displayName ?? null,
  };
}

// Resolve the season to feature for a league. Reads the seasons list, fetches
// the windows for the most recent few years, and applies pickSeason(). Returns
// null when the competition has no current/upcoming season ("coming soon").
export async function resolveSeasonWindow(
  providerLeagueSlug: string,
  now: Date = new Date(),
  maxSeasons = 4,
): Promise<SeasonWindow | null> {
  const refs = await fetchSeasonRefs(providerLeagueSlug);
  const years = [
    ...new Set(
      refs
        .map(parseYearFromRef)
        .filter((y): y is number => y != null),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, maxSeasons);

  const windows: SeasonWindow[] = [];
  for (const year of years) {
    try {
      const w = await fetchSeasonDetail(providerLeagueSlug, year);
      if (w) windows.push(w);
    } catch {
      // Skip an unreadable season; the others still inform the decision.
    }
  }
  return pickSeason(windows, now);
}

// ---------------------------------------------------------------------------
// Fixture fetching + snapshot assembly
// ---------------------------------------------------------------------------

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// Split an inclusive [start, end] window into <= CHUNK_DAYS sub-ranges so a long
// season fits under ESPN's per-request event cap. Exported for unit testing.
export function chunkWindows(
  start: Date,
  end: Date,
  chunkDays = CHUNK_DAYS,
): { start: string; end: string }[] {
  const ranges: { start: string; end: string }[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor <= endMs) {
    const chunkEnd = Math.min(cursor + (chunkDays - 1) * dayMs, endMs);
    ranges.push({
      start: formatYmd(new Date(cursor)),
      end: formatYmd(new Date(chunkEnd)),
    });
    cursor = chunkEnd + dayMs;
  }
  return ranges;
}

async function fetchScoreboard(
  providerLeagueSlug: string,
  startYmd: string,
  endYmd: string,
): Promise<EspnWorldChampionshipEvent[]> {
  // ESPN's scoreboard endpoint silently caps `events` at 100 items by default,
  // regardless of the date range. The 35-day chunk windows normally stay well
  // under that, but a congested league window (or ESPN lowering the cap) would
  // silently truncate fixtures — the same failure that hid the World Championship semis.
  // Pass an explicit high limit so a whole chunk always comes back complete.
  const url = `${SITE_BASE}/${providerLeagueSlug}/scoreboard?dates=${startYmd}-${endYmd}&limit=1000`;
  const data = await fetchJson<{ events?: EspnWorldChampionshipEvent[] }>(url);
  return data.events ?? [];
}

interface EspnTeamLike {
  id: string;
  displayName?: string;
  name?: string;
  abbreviation?: string;
  logo?: string;
}

function parseScore(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

interface BuildOpts {
  localSlug: string;
  competitionSlug: string;
  type: CompetitionType;
  countryCode: string | null;
}

function toProviderTeam(t: EspnTeamLike, opts: BuildOpts): ProviderTeam {
  const nameEn = t.displayName ?? t.name ?? `Team ${t.id}`;
  const externalId = teamExternalId(opts.competitionSlug, t.id);
  const code = t.abbreviation ?? null;

  // World Championship competitors are NATIONAL teams: enrich via the curated nation map
  // (Arabic name + flag) exactly like the legacy WC provider, and carry no
  // owning competition so the national picker keeps showing them.
  if (opts.type === "WORLD_CHAMPIONSHIP") {
    const i18n = lookupTeamI18n(nameEn);
    return {
      externalId,
      nameEn,
      nameAr: i18n?.ar ?? nameEn,
      code,
      flagUrl: i18n ? flag(i18n.cc) : (t.logo ?? null),
      countryCode: i18n?.cc ?? opts.countryCode,
      kind: "national",
      primaryCompetitionSlug: null,
    };
  }

  // Domestic leagues + cups are CLUBS: curated Arabic name only; keep ESPN's
  // crest as the logo and the league's country code.
  return {
    externalId,
    nameEn,
    nameAr: lookupClubI18n(nameEn) ?? nameEn,
    code,
    flagUrl: t.logo ?? null,
    countryCode: opts.countryCode,
    kind: "club",
    primaryCompetitionSlug: opts.competitionSlug,
  };
}

// Pure assembly of a competition snapshot from raw ESPN events. Knockout
// competitions (cup / WORLD_CHAMPIONSHIP) may carry bracket-placeholder competitors
// ("Group A Winner", "Match 5 Winner") for undecided slots: the match is still
// produced (so the schedule + prune logic see it) but the placeholder slot
// stays null. Round-robin leagues never have placeholders. Exported for testing.
export function buildCompetitionSnapshot(
  opts: BuildOpts,
  events: EspnWorldChampionshipEvent[],
): { slug: string; teams: ProviderTeam[]; matches: ProviderMatch[] } {
  const teamMap = new Map<string, ProviderTeam>();
  const matches: ProviderMatch[] = [];
  const knockout = opts.type !== "league";

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp?.competitors) continue;

    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home?.team?.id || !away?.team?.id) continue;

    const homePlaceholder =
      knockout && isPlaceholderTeam(home.team.displayName ?? home.team.name);
    const awayPlaceholder =
      knockout && isPlaceholderTeam(away.team.displayName ?? away.team.name);

    for (const c of [home, away]) {
      if (knockout && isPlaceholderTeam(c.team.displayName ?? c.team.name)) {
        continue;
      }
      const team = toProviderTeam(c.team, opts);
      if (!teamMap.has(team.externalId)) teamMap.set(team.externalId, team);
    }

    const sType = comp.status?.type;
    const status = mapStatus(
      sType?.name ?? "",
      sType?.state ?? "",
      sType?.completed ?? false,
    );
    const clock = comp.status?.clock;
    const minute =
      typeof clock === "number" && clock > 0 ? Math.floor(clock / 60) : null;

    matches.push({
      externalId: matchExternalId(opts.competitionSlug, comp.id),
      stageType: mapCompetitionStage(opts.type, event.season?.slug),
      homeTeamExternalId: homePlaceholder
        ? null
        : teamExternalId(opts.competitionSlug, home.team.id),
      awayTeamExternalId: awayPlaceholder
        ? null
        : teamExternalId(opts.competitionSlug, away.team.id),
      kickoffAt: new Date(event.date),
      status,
      homeScore: parseScore(home.score),
      awayScore: parseScore(away.score),
      minute,
      venue: comp.venue?.fullName ?? null,
    });
  }

  return { slug: opts.localSlug, teams: [...teamMap.values()], matches };
}

interface EspnRosterTeam {
  id: string;
  displayName?: string;
  name?: string;
  abbreviation?: string;
  logos?: { href?: string }[];
}

// Fetch the FULL club roster for a domestic league from ESPN's `teams` endpoint.
// Unlike fixtures, this returns every club regardless of whether the season's
// matches have been published yet, so the favourite-club picker is populated the
// moment a competition is featured — not only once games are scheduled.
export async function fetchLeagueTeams(
  providerLeagueSlug: string,
  opts: BuildOpts,
): Promise<ProviderTeam[]> {
  const url = `${SITE_BASE}/${providerLeagueSlug}/teams`;
  const data = await fetchJson<{
    sports?: { leagues?: { teams?: { team?: EspnRosterTeam }[] }[] }[];
  }>(url);
  const entries = data.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const teams: ProviderTeam[] = [];
  for (const entry of entries) {
    const t = entry.team;
    if (!t?.id) continue;
    teams.push(
      toProviderTeam(
        {
          id: t.id,
          displayName: t.displayName,
          name: t.name,
          abbreviation: t.abbreviation,
          logo: t.logos?.[0]?.href,
        },
        opts,
      ),
    );
  }
  return teams;
}

export interface FetchCompetitionOpts {
  // Local tournament slug stamped onto the snapshot (e.g. "eng.1-2026").
  localSlug: string;
  competitionSlug: string;
  providerLeagueSlug: string;
  type: CompetitionType;
  countryCode: string | null;
  now?: Date;
  // "full" walks the whole resolved season (chunked, prune-safe); "live" fetches
  // only a narrow recent window for fast score updates (never prune-safe).
  mode?: "full" | "live";
  liveForwardDays?: number;
  // Skip season resolution (tests, or a fixed-window competition like the WC).
  seasonOverride?: SeasonWindow | null;
}

// Fetch a complete (or live) snapshot for one competition. Resolves the season
// first; if none, returns an empty "coming soon" snapshot. Never throws on a
// single failed chunk — it returns the partial data with complete=false so the
// caller upserts what it has without pruning.
export async function fetchCompetitionSnapshot(
  opts: FetchCompetitionOpts,
): Promise<CompetitionSnapshot> {
  const now = opts.now ?? new Date();
  const season =
    opts.seasonOverride !== undefined
      ? opts.seasonOverride
      : await resolveSeasonWindow(opts.providerLeagueSlug, now);

  if (!season) {
    return {
      slug: opts.localSlug,
      teams: [],
      matches: [],
      complete: false,
      hasFixtures: false,
      season: null,
    };
  }

  const mode = opts.mode ?? "full";
  let ranges: { start: string; end: string }[];
  if (mode === "live") {
    const dayMs = 24 * 60 * 60 * 1000;
    const back = new Date(now.getTime() - LIVE_BACK_DAYS * dayMs);
    const forward = new Date(
      now.getTime() +
        (opts.liveForwardDays ?? DEFAULT_LIVE_FORWARD_DAYS) * dayMs,
    );
    ranges = [{ start: formatYmd(back), end: formatYmd(forward) }];
  } else {
    ranges = chunkWindows(season.startDate, season.endDate);
  }

  const eventsById = new Map<string, EspnWorldChampionshipEvent>();
  let complete = true;
  for (const r of ranges) {
    try {
      const evs = await fetchScoreboard(opts.providerLeagueSlug, r.start, r.end);
      for (const e of evs) eventsById.set(e.id, e);
    } catch {
      // A failed chunk makes the snapshot incomplete (don't prune) but we keep
      // whatever other chunks returned.
      complete = false;
    }
  }
  // Live refreshes only ever cover a sliver of the season, so they are never a
  // basis for pruning regardless of fetch success.
  if (mode === "live") complete = false;

  const events = [...eventsById.values()];
  const buildOpts: BuildOpts = {
    localSlug: opts.localSlug,
    competitionSlug: opts.competitionSlug,
    type: opts.type,
    countryCode: opts.countryCode,
  };
  const built = buildCompetitionSnapshot(buildOpts, events);

  // Domestic leagues also pull the full club roster so every club is available
  // to the favourite-club picker even before fixtures publish. Cups + the World
  // Cup derive their teams from the fixtures themselves. A roster-fetch failure
  // must NOT cause real clubs to be pruned, so it marks the snapshot incomplete.
  let teams = built.teams;
  let rosterComplete = true;
  if (mode === "full" && opts.type === "league") {
    try {
      const roster = await fetchLeagueTeams(opts.providerLeagueSlug, buildOpts);
      const byId = new Map<string, ProviderTeam>();
      for (const team of roster) byId.set(team.externalId, team);
      // Keep any team seen in fixtures but missing from the roster response.
      for (const team of built.teams) {
        if (!byId.has(team.externalId)) byId.set(team.externalId, team);
      }
      teams = [...byId.values()];
    } catch {
      rosterComplete = false;
    }
  }

  return {
    slug: built.slug,
    teams,
    matches: built.matches,
    complete: complete && rosterComplete,
    hasFixtures: events.length > 0,
    season,
  };
}
