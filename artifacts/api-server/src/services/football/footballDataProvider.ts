// football-data.org adapter behind the provider-agnostic FootballProvider
// interface. Enabled when FOOTBALL_DATA_API_KEY is set; otherwise the system
// falls back to the next provider / mock (see index.ts). All football-data.org
// request/response shapes are confined to this file.
//
// football-data.org returns English team names only, so we enrich each team with
// an Arabic name + ISO country code (for flag artwork) via a curated lookup —
// THADDI is Arabic-first. Unknown teams gracefully fall back to the English name
// and the API-provided crest.

import type {
  FootballProvider,
  ProviderMatch,
  ProviderMatchStatus,
  ProviderStageType,
  ProviderTeam,
  ProviderTournament,
} from "./types";
import { flag, lookupTeamI18n } from "./teamI18n";

class ConfigurationError extends Error {}

// football-data.org match status -> internal status.
function mapStatus(status: string | null | undefined): ProviderMatchStatus {
  switch ((status || "").toUpperCase()) {
    case "IN_PLAY":
      return "live";
    case "PAUSED":
      return "half_time";
    case "FINISHED":
    case "AWARDED":
      return "finished";
    case "POSTPONED":
      return "postponed";
    case "CANCELLED":
    case "SUSPENDED":
      return "cancelled";
    case "SCHEDULED":
    case "TIMED":
    default:
      return "scheduled";
  }
}

// football-data.org stage codes -> seeded stage_type enum.
function mapStageType(stage: string | null | undefined): ProviderStageType {
  switch ((stage || "").toUpperCase()) {
    case "LAST_32":
      return "round_of_32";
    case "LAST_16":
      return "round_of_16";
    case "QUARTER_FINALS":
      return "quarter_final";
    case "SEMI_FINALS":
      return "semi_final";
    case "THIRD_PLACE":
      return "third_place";
    case "FINAL":
      return "final";
    case "GROUP_STAGE":
    case "LEAGUE_STAGE":
    default:
      return "group";
  }
}

interface FdTeam {
  id: number;
  name?: string;
  shortName?: string;
  tla?: string;
  crest?: string;
}

interface FdMatch {
  id: number;
  utcDate?: string;
  status?: string;
  minute?: number | null;
  stage?: string;
  group?: string | null;
  venue?: string | null;
  homeTeam?: FdTeam;
  awayTeam?: FdTeam;
  score?: {
    fullTime?: { home?: number | null; away?: number | null };
  };
}

class FootballDataProvider implements FootballProvider {
  readonly name = "football-data";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly competition: string;
  private readonly season: string | null;

  constructor() {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      throw new ConfigurationError(
        "FOOTBALL_DATA_API_KEY is not configured; football-data.org provider unavailable.",
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (
      process.env.FOOTBALL_DATA_BASE_URL || "https://api.football-data.org/v4"
    ).replace(/\/$/, "");
    // FIFA World Cup competition code; season is the starting year (2026).
    this.competition = process.env.FOOTBALL_DATA_COMPETITION || "WC";
    this.season = process.env.FOOTBALL_DATA_WC2026_SEASON || "2026";
  }

  private async get(
    path: string,
    params: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      headers: { "X-Auth-Token": this.apiKey, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(
        `football-data.org request failed (${res.status}) for ${path}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  }

  private toTeam(t: FdTeam): ProviderTeam {
    const i18n = lookupTeamI18n(t.name);
    return {
      externalId: String(t.id),
      nameEn: t.name ?? t.shortName ?? `Team ${t.id}`,
      nameAr: i18n?.ar ?? t.name ?? t.shortName ?? `Team ${t.id}`,
      code: t.tla ?? null,
      flagUrl: i18n ? flag(i18n.cc) : (t.crest ?? null),
      countryCode: i18n?.cc ?? null,
    };
  }

  private parseMatch(m: FdMatch): ProviderMatch | null {
    if (!m.utcDate) return null;
    const status = mapStatus(m.status);
    const full = m.score?.fullTime ?? {};
    return {
      externalId: String(m.id),
      stageType: mapStageType(m.stage),
      homeTeamExternalId: m.homeTeam?.id ? String(m.homeTeam.id) : null,
      awayTeamExternalId: m.awayTeam?.id ? String(m.awayTeam.id) : null,
      kickoffAt: new Date(m.utcDate),
      status,
      homeScore: typeof full.home === "number" ? full.home : null,
      awayScore: typeof full.away === "number" ? full.away : null,
      minute: typeof m.minute === "number" ? m.minute : null,
      venue: m.venue ?? null,
    };
  }

  async fetchTournament(slug: string): Promise<ProviderTournament> {
    const params: Record<string, string> = {};
    if (this.season) params.season = this.season;
    const data = await this.get(
      `/competitions/${this.competition}/matches`,
      params,
    );
    const fdMatches = (data.matches as FdMatch[]) ?? [];

    const teamMap = new Map<string, ProviderTeam>();
    const matches: ProviderMatch[] = [];
    for (const fm of fdMatches) {
      const m = this.parseMatch(fm);
      if (m) matches.push(m);
      for (const t of [fm.homeTeam, fm.awayTeam]) {
        if (!t?.id) continue;
        const id = String(t.id);
        if (!teamMap.has(id)) teamMap.set(id, this.toTeam(t));
      }
    }

    return { slug, teams: [...teamMap.values()], matches };
  }
}

export function tryCreateFootballDataProvider(): FootballProvider | null {
  try {
    return new FootballDataProvider();
  } catch (err) {
    if (err instanceof ConfigurationError) return null;
    throw err;
  }
}
