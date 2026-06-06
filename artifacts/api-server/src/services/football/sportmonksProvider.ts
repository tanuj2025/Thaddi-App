// SportMonks adapter behind the provider-agnostic FootballProvider interface.
// Enabled when SPORTMONKS_API_KEY is set; otherwise the system falls back to the
// mock provider (see index.ts). All SportMonks-specific request/response shapes
// are confined to this file — feature code never imports it directly.

import type {
  FootballProvider,
  ProviderMatch,
  ProviderMatchStatus,
  ProviderStageType,
  ProviderTeam,
  ProviderTournament,
} from "./types";

class ConfigurationError extends Error {}

// SportMonks "state" short codes mapped to our internal match status.
function mapStatus(state: string | null | undefined): ProviderMatchStatus {
  switch ((state || "").toUpperCase()) {
    case "INPLAY_1ST_HALF":
    case "INPLAY_2ND_HALF":
    case "INPLAY_ET":
    case "INPLAY_PENALTIES":
    case "LIVE":
      return "live";
    case "HT":
    case "BREAK":
      return "half_time";
    case "FT":
    case "AET":
    case "FT_PEN":
      return "finished";
    case "POSTPONED":
      return "postponed";
    case "CANCELLED":
    case "ABANDONED":
      return "cancelled";
    default:
      return "scheduled";
  }
}

// SportMonks round/stage names mapped to our seeded stage_type enum.
function mapStageType(name: string | null | undefined): ProviderStageType {
  const n = (name || "").toLowerCase();
  if (n.includes("final") && !n.includes("semi") && !n.includes("quarter"))
    return "final";
  if (n.includes("3rd") || n.includes("third")) return "third_place";
  if (n.includes("semi")) return "semi_final";
  if (n.includes("quarter")) return "quarter_final";
  if (n.includes("16")) return "round_of_16";
  if (n.includes("32")) return "round_of_32";
  return "group";
}

interface SmParticipant {
  id: number;
  name: string;
  image_path?: string;
  short_code?: string;
  country_id?: number;
  meta?: { location?: "home" | "away" };
}

interface SmScore {
  description?: string;
  score?: { participant?: "home" | "away"; goals?: number };
}

interface SmFixture {
  id: number;
  name?: string;
  starting_at?: string;
  state?: { state?: string; short_name?: string };
  minute?: number | null;
  venue?: { name?: string };
  round?: { name?: string };
  stage?: { name?: string };
  participants?: SmParticipant[];
  scores?: SmScore[];
}

class SportMonksProvider implements FootballProvider {
  readonly name = "sportmonks";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  // Optional explicit override. When unset, the season is resolved from the
  // SportMonks API so the provider works with the API key alone.
  private readonly seasonIdOverride: string | null;
  private readonly seasonName: string;
  private resolvedSeasonId: string | null = null;

  constructor() {
    const apiKey =
      process.env.SPORTMONKS_API_KEY || process.env.SPORTMONKS_API_TOKEN;
    if (!apiKey) {
      throw new ConfigurationError(
        "SPORTMONKS_API_KEY is not configured; football data provider unavailable.",
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (
      process.env.SPORTMONKS_BASE_URL || "https://api.sportmonks.com/v3/football"
    ).replace(/\/$/, "");
    // Optional explicit season id; otherwise auto-resolved (see resolveSeasonId).
    this.seasonIdOverride = process.env.SPORTMONKS_WC2026_SEASON_ID || null;
    this.seasonName = process.env.SPORTMONKS_WC2026_SEASON_NAME || "2026";
  }

  // Resolve the FIFA World Cup 2026 season id. Uses the explicit override when
  // provided; otherwise looks up the World Cup league and its 2026 season via
  // the SportMonks API so only SPORTMONKS_API_KEY is required. Result is cached.
  private async resolveSeasonId(): Promise<string> {
    if (this.seasonIdOverride) return this.seasonIdOverride;
    if (this.resolvedSeasonId) return this.resolvedSeasonId;

    const leaguesResp = await this.get(
      `/leagues/search/${encodeURIComponent("World Cup")}`,
    );
    const leagues =
      (leaguesResp.data as Array<{ id: number; name: string }>) ?? [];
    const league =
      leagues.find(
        (l) => /world cup/i.test(l.name) && !/women|u-?\d/i.test(l.name),
      ) ?? leagues[0];
    if (!league) {
      throw new Error(
        "SportMonks: could not resolve the FIFA World Cup league via API.",
      );
    }

    const leagueResp = await this.get(`/leagues/${league.id}`, {
      include: "seasons",
    });
    const seasons =
      ((leagueResp.data as { seasons?: Array<{ id: number; name: string }> })
        ?.seasons) ?? [];
    const season =
      seasons.find((s) => String(s.name).includes(this.seasonName)) ??
      seasons[seasons.length - 1];
    if (!season) {
      throw new Error(
        `SportMonks: could not resolve the ${this.seasonName} World Cup season via API.`,
      );
    }

    this.resolvedSeasonId = String(season.id);
    return this.resolvedSeasonId;
  }

  private async get(
    path: string,
    params: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("api_token", this.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`SportMonks request failed (${res.status}) for ${path}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  private parseFixture(fx: SmFixture): ProviderMatch | null {
    const home = fx.participants?.find((p) => p.meta?.location === "home");
    const away = fx.participants?.find((p) => p.meta?.location === "away");
    const status = mapStatus(fx.state?.short_name || fx.state?.state);

    let homeScore: number | null = null;
    let awayScore: number | null = null;
    for (const s of fx.scores ?? []) {
      if (s.description === "CURRENT" || s.description === "FT") {
        if (s.score?.participant === "home")
          homeScore = s.score.goals ?? homeScore;
        if (s.score?.participant === "away")
          awayScore = s.score.goals ?? awayScore;
      }
    }

    if (!fx.starting_at) return null;
    return {
      externalId: String(fx.id),
      stageType: mapStageType(fx.round?.name || fx.stage?.name),
      homeTeamExternalId: home ? String(home.id) : null,
      awayTeamExternalId: away ? String(away.id) : null,
      kickoffAt: new Date(fx.starting_at.replace(" ", "T") + "Z"),
      status,
      homeScore,
      awayScore,
      minute: typeof fx.minute === "number" ? fx.minute : null,
      venue: fx.venue?.name ?? null,
    };
  }

  async fetchTournament(slug: string): Promise<ProviderTournament> {
    const seasonId = await this.resolveSeasonId();
    const data = await this.get(`/fixtures/seasons/${seasonId}`, {
      include: "participants;scores;state;round;stage;venue",
      per_page: "200",
    });
    const fixtures = (data.data as SmFixture[]) ?? [];

    const teamMap = new Map<string, ProviderTeam>();
    const matches: ProviderMatch[] = [];
    for (const fx of fixtures) {
      const m = this.parseFixture(fx);
      if (m) matches.push(m);
      for (const p of fx.participants ?? []) {
        const id = String(p.id);
        if (!teamMap.has(id)) {
          teamMap.set(id, {
            externalId: id,
            nameEn: p.name,
            nameAr: p.name,
            code: p.short_code ?? null,
            flagUrl: p.image_path ?? null,
            countryCode: null,
          });
        }
      }
    }

    return { slug, teams: [...teamMap.values()], matches };
  }
}

export function tryCreateSportMonksProvider(): FootballProvider | null {
  try {
    return new SportMonksProvider();
  } catch (err) {
    if (err instanceof ConfigurationError) return null;
    throw err;
  }
}
