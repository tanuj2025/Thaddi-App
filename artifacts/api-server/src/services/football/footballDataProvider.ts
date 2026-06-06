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

// Normalize an English country name for lookup (lowercase, strip accents/punct).
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
}

interface TeamI18n {
  ar: string;
  cc: string; // ISO 3166-1 alpha-2 (flagcdn), or gb-eng/gb-wls/gb-sct.
}

// Curated bilingual lookup for likely World Cup nations. Keyed by normalized
// English name, with aliases for name variants used by football-data.org.
const TEAM_I18N: Record<string, TeamI18n> = {
  "saudi arabia": { ar: "السعودية", cc: "sa" },
  argentina: { ar: "الأرجنتين", cc: "ar" },
  brazil: { ar: "البرازيل", cc: "br" },
  france: { ar: "فرنسا", cc: "fr" },
  mexico: { ar: "المكسيك", cc: "mx" },
  japan: { ar: "اليابان", cc: "jp" },
  morocco: { ar: "المغرب", cc: "ma" },
  portugal: { ar: "البرتغال", cc: "pt" },
  spain: { ar: "إسبانيا", cc: "es" },
  germany: { ar: "ألمانيا", cc: "de" },
  england: { ar: "إنجلترا", cc: "gb-eng" },
  wales: { ar: "ويلز", cc: "gb-wls" },
  scotland: { ar: "اسكتلندا", cc: "gb-sct" },
  "united states": { ar: "الولايات المتحدة", cc: "us" },
  usa: { ar: "الولايات المتحدة", cc: "us" },
  canada: { ar: "كندا", cc: "ca" },
  netherlands: { ar: "هولندا", cc: "nl" },
  belgium: { ar: "بلجيكا", cc: "be" },
  croatia: { ar: "كرواتيا", cc: "hr" },
  italy: { ar: "إيطاليا", cc: "it" },
  uruguay: { ar: "الأوروغواي", cc: "uy" },
  colombia: { ar: "كولومبيا", cc: "co" },
  senegal: { ar: "السنغال", cc: "sn" },
  "south korea": { ar: "كوريا الجنوبية", cc: "kr" },
  "korea republic": { ar: "كوريا الجنوبية", cc: "kr" },
  switzerland: { ar: "سويسرا", cc: "ch" },
  denmark: { ar: "الدنمارك", cc: "dk" },
  poland: { ar: "بولندا", cc: "pl" },
  serbia: { ar: "صربيا", cc: "rs" },
  ecuador: { ar: "الإكوادور", cc: "ec" },
  ghana: { ar: "غانا", cc: "gh" },
  cameroon: { ar: "الكاميرون", cc: "cm" },
  tunisia: { ar: "تونس", cc: "tn" },
  algeria: { ar: "الجزائر", cc: "dz" },
  egypt: { ar: "مصر", cc: "eg" },
  nigeria: { ar: "نيجيريا", cc: "ng" },
  australia: { ar: "أستراليا", cc: "au" },
  iran: { ar: "إيران", cc: "ir" },
  "ir iran": { ar: "إيران", cc: "ir" },
  qatar: { ar: "قطر", cc: "qa" },
  "ivory coast": { ar: "ساحل العاج", cc: "ci" },
  "cote divoire": { ar: "ساحل العاج", cc: "ci" },
  mali: { ar: "مالي", cc: "ml" },
  norway: { ar: "النرويج", cc: "no" },
  sweden: { ar: "السويد", cc: "se" },
  austria: { ar: "النمسا", cc: "at" },
  turkey: { ar: "تركيا", cc: "tr" },
  turkiye: { ar: "تركيا", cc: "tr" },
  ukraine: { ar: "أوكرانيا", cc: "ua" },
  czechia: { ar: "التشيك", cc: "cz" },
  "czech republic": { ar: "التشيك", cc: "cz" },
  hungary: { ar: "المجر", cc: "hu" },
  greece: { ar: "اليونان", cc: "gr" },
  peru: { ar: "بيرو", cc: "pe" },
  chile: { ar: "تشيلي", cc: "cl" },
  paraguay: { ar: "باراغواي", cc: "py" },
  "costa rica": { ar: "كوستاريكا", cc: "cr" },
  panama: { ar: "بنما", cc: "pa" },
  jamaica: { ar: "جامايكا", cc: "jm" },
  honduras: { ar: "هندوراس", cc: "hn" },
  "new zealand": { ar: "نيوزيلندا", cc: "nz" },
  "south africa": { ar: "جنوب أفريقيا", cc: "za" },
  uzbekistan: { ar: "أوزبكستان", cc: "uz" },
  jordan: { ar: "الأردن", cc: "jo" },
  iraq: { ar: "العراق", cc: "iq" },
  "united arab emirates": { ar: "الإمارات", cc: "ae" },
  oman: { ar: "عمان", cc: "om" },
  "cape verde": { ar: "الرأس الأخضر", cc: "cv" },
  "cabo verde": { ar: "الرأس الأخضر", cc: "cv" },
  "dr congo": { ar: "الكونغو الديمقراطية", cc: "cd" },
  bolivia: { ar: "بوليفيا", cc: "bo" },
  venezuela: { ar: "فنزويلا", cc: "ve" },
};

function flag(cc: string): string {
  return `https://flagcdn.com/w160/${cc}.png`;
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
    const i18n = t.name ? TEAM_I18N[normalizeName(t.name)] : undefined;
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
