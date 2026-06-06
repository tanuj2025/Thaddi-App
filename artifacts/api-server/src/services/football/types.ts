// Provider-agnostic football data contract. Feature code depends ONLY on these
// types, never on a specific provider (SportMonks, mock, ...). Swap the active
// provider in index.ts without touching sync, routes, or UI.

export type ProviderMatchStatus =
  | "scheduled"
  | "live"
  | "half_time"
  | "full_time"
  | "finished"
  | "postponed"
  | "cancelled";

// Stage types align with the seeded stage_type enum so the sync can resolve a
// provider match to a local stage row.
export type ProviderStageType =
  | "group"
  | "round_of_32"
  | "round_of_16"
  | "quarter_final"
  | "semi_final"
  | "third_place"
  | "final";

export interface ProviderTeam {
  externalId: string;
  nameEn: string;
  nameAr: string;
  code: string | null;
  flagUrl: string | null;
  countryCode: string | null;
}

export interface ProviderMatch {
  externalId: string;
  stageType: ProviderStageType;
  homeTeamExternalId: string | null;
  awayTeamExternalId: string | null;
  kickoffAt: Date;
  status: ProviderMatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
  venue: string | null;
}

// The tournament these teams/matches belong to (matched locally by slug).
export interface ProviderTournament {
  slug: string;
  teams: ProviderTeam[];
  matches: ProviderMatch[];
}

// A football data provider returns the full World Cup 2026 snapshot. Live
// updates are obtained by re-fetching (status/score/minute reflect "now").
export interface FootballProvider {
  readonly name: string;
  fetchTournament(slug: string): Promise<ProviderTournament>;
}
