// Deterministic mock football provider. Used as a graceful fallback when no
// real provider (SportMonks) is configured, so the Match Center, predictions,
// lock countdown, and scoring engine are fully demonstrable in development.
//
// Fixtures are anchored relative to "now" so the board always shows finished
// matches (for scoring), a live match, a half-time match, and upcoming matches
// (open for prediction with a live countdown to lock).

import type {
  FootballProvider,
  ProviderMatch,
  ProviderTeam,
  ProviderTournament,
} from "./types";

const HOUR = 60 * 60 * 1000;

interface MockTeam {
  externalId: string;
  nameEn: string;
  nameAr: string;
  code: string;
  countryCode: string;
}

const TEAMS: MockTeam[] = [
  { externalId: "sa", nameEn: "Saudi Arabia", nameAr: "السعودية", code: "KSA", countryCode: "sa" },
  { externalId: "ar", nameEn: "Argentina", nameAr: "الأرجنتين", code: "ARG", countryCode: "ar" },
  { externalId: "mx", nameEn: "Mexico", nameAr: "المكسيك", code: "MEX", countryCode: "mx" },
  { externalId: "jp", nameEn: "Japan", nameAr: "اليابان", code: "JPN", countryCode: "jp" },
  { externalId: "br", nameEn: "Brazil", nameAr: "البرازيل", code: "BRA", countryCode: "br" },
  { externalId: "fr", nameEn: "France", nameAr: "فرنسا", code: "FRA", countryCode: "fr" },
  { externalId: "ma", nameEn: "Morocco", nameAr: "المغرب", code: "MAR", countryCode: "ma" },
  { externalId: "pt", nameEn: "Portugal", nameAr: "البرتغال", code: "PRT", countryCode: "pt" },
];

function flag(countryCode: string): string {
  return `https://flagcdn.com/w160/${countryCode}.png`;
}

// home, away, hoursFromNow (negative = past), status, scores, minute, venue.
interface FixtureSpec {
  id: string;
  home: string;
  away: string;
  offsetHours: number;
  status: ProviderMatch["status"];
  home_score: number | null;
  away_score: number | null;
  minute: number | null;
  venue: string;
}

const FIXTURES: FixtureSpec[] = [
  // ---- Group A (Saudi Arabia, Argentina, Mexico, Japan) ----
  { id: "m-a1", home: "sa", away: "mx", offsetHours: -72, status: "finished", home_score: 2, away_score: 1, minute: 90, venue: "Lusail Stadium" },
  { id: "m-a2", home: "ar", away: "jp", offsetHours: -69, status: "finished", home_score: 3, away_score: 0, minute: 90, venue: "MetLife Stadium" },
  { id: "m-a3", home: "sa", away: "ar", offsetHours: -2, status: "live", home_score: 1, away_score: 1, minute: 67, venue: "SoFi Stadium" },
  { id: "m-a4", home: "mx", away: "jp", offsetHours: -1, status: "half_time", home_score: 0, away_score: 1, minute: 45, venue: "Azteca Stadium" },
  { id: "m-a5", home: "sa", away: "jp", offsetHours: 3, status: "scheduled", home_score: null, away_score: null, minute: null, venue: "AT&T Stadium" },
  { id: "m-a6", home: "ar", away: "mx", offsetHours: 27, status: "scheduled", home_score: null, away_score: null, minute: null, venue: "Hard Rock Stadium" },
  // ---- Group B (Brazil, France, Morocco, Portugal) ----
  { id: "m-b1", home: "br", away: "ma", offsetHours: -70, status: "finished", home_score: 1, away_score: 1, minute: 90, venue: "Rose Bowl" },
  { id: "m-b2", home: "fr", away: "pt", offsetHours: -67, status: "finished", home_score: 2, away_score: 2, minute: 90, venue: "Levi's Stadium" },
  { id: "m-b3", home: "br", away: "fr", offsetHours: -3, status: "live", home_score: 0, away_score: 0, minute: 32, venue: "Mercedes-Benz Stadium" },
  { id: "m-b4", home: "ma", away: "pt", offsetHours: 5, status: "scheduled", home_score: null, away_score: null, minute: null, venue: "Lincoln Financial Field" },
  { id: "m-b5", home: "br", away: "pt", offsetHours: 30, status: "scheduled", home_score: null, away_score: null, minute: null, venue: "NRG Stadium" },
  { id: "m-b6", home: "fr", away: "ma", offsetHours: 52, status: "scheduled", home_score: null, away_score: null, minute: null, venue: "Arrowhead Stadium" },
];

class MockFootballProvider implements FootballProvider {
  readonly name = "mock";

  async fetchTournament(slug: string): Promise<ProviderTournament> {
    const now = Date.now();

    const teams: ProviderTeam[] = TEAMS.map((t) => ({
      externalId: t.externalId,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      code: t.code,
      flagUrl: flag(t.countryCode),
      countryCode: t.countryCode,
    }));

    const matches: ProviderMatch[] = FIXTURES.map((f) => ({
      externalId: f.id,
      stageType: "group",
      homeTeamExternalId: f.home,
      awayTeamExternalId: f.away,
      kickoffAt: new Date(now + f.offsetHours * HOUR),
      status: f.status,
      homeScore: f.home_score,
      awayScore: f.away_score,
      minute: f.minute,
      venue: f.venue,
    }));

    return { slug, teams, matches };
  }
}

export function createMockFootballProvider(): FootballProvider {
  return new MockFootballProvider();
}
