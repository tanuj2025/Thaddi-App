// ESPN public API adapter for international friendly matches. No API key
// required — the scoreboard endpoint is fully public. Only the two confirmed
// WC-prep friendly matches are imported (Portugal vs Nigeria, England vs Costa
// Rica); all other ESPN events are filtered out. External IDs are prefixed with
// "espnf-" so they cannot collide with football-data.org / SportMonks IDs.

import type {
  FootballProvider,
  ProviderMatch,
  ProviderMatchStatus,
  ProviderTeam,
  ProviderTournament,
} from "./types";

// Only these team-name pairs are allowed through. Any other ESPN friendly event
// is silently skipped so the friendlies tournament stays clean.
const ALLOWED_TEAMS = new Set([
  "portugal",
  "nigeria",
  "england",
  "costa rica",
]);

interface TeamI18n {
  ar: string;
  cc: string;
}

const TEAM_I18N: Record<string, TeamI18n> = {
  portugal: { ar: "البرتغال", cc: "pt" },
  nigeria: { ar: "نيجيريا", cc: "ng" },
  england: { ar: "إنجلترا", cc: "gb-eng" },
  "costa rica": { ar: "كوستاريكا", cc: "cr" },
};

function flag(cc: string): string {
  return `https://flagcdn.com/w160/${cc}.png`;
}

function normName(name: string): string {
  return (name ?? "").toLowerCase().trim();
}

function mapStatus(
  statusName: string,
  state: string,
  completed: boolean,
): ProviderMatchStatus {
  const u = (statusName ?? "").toUpperCase();
  const s = (state ?? "").toLowerCase();
  // Explicit statuses take precedence over the coarse state field.
  if (u.includes("HALFTIME") || u.includes("HALF_TIME")) return "half_time";
  if (u.includes("POSTPONED")) return "postponed";
  if (u.includes("CANCEL")) return "cancelled";
  if (completed || s === "post") return "finished";
  // ESPN soccer reports period-specific statuses while a match is being played
  // (STATUS_FIRST_HALF / STATUS_SECOND_HALF / STATUS_IN_PROGRESS / ...). Rather
  // than enumerate every period name, treat any "in" state as live.
  if (s === "in") return "live";
  if (u.includes("IN_PROGRESS")) return "live";
  return "scheduled";
}

interface EspnTeam {
  id: string;
  displayName?: string;
  abbreviation?: string;
}

interface EspnCompetitor {
  homeAway: "home" | "away";
  team: EspnTeam;
  score?: string;
}

interface EspnCompetition {
  id: string;
  competitors: EspnCompetitor[];
  venue?: { fullName?: string };
  status?: {
    clock?: number;
    type?: { name?: string; state?: string; completed?: boolean };
  };
}

interface EspnEvent {
  id: string;
  date: string;
  competitions: EspnCompetition[];
}

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.friendly/scoreboard";

export class EspnFriendliesProvider implements FootballProvider {
  readonly name = "espn-friendlies";

  async fetchTournament(slug: string): Promise<ProviderTournament> {
    // Fetch the rolling ESPN scoreboard window (no date param → ESPN returns
    // events in a ~2-week window around today). We also probe yesterday's date
    // so results from yesterday's matches are still visible today.
    const events = await this.fetchEvents();

    const teamMap = new Map<string, ProviderTeam>();
    const matches: ProviderMatch[] = [];

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp?.competitors) continue;

      const home = comp.competitors.find((c) => c.homeAway === "home");
      const away = comp.competitors.find((c) => c.homeAway === "away");
      if (!home || !away) continue;

      const homeNorm = normName(home.team.displayName ?? "");
      const awayNorm = normName(away.team.displayName ?? "");

      // Only allow the two confirmed matches.
      if (!ALLOWED_TEAMS.has(homeNorm) || !ALLOWED_TEAMS.has(awayNorm)) {
        continue;
      }

      for (const c of [home, away]) {
        const norm = normName(c.team.displayName ?? "");
        const extId = `espnf-team-${c.team.id}`;
        if (!teamMap.has(extId)) {
          const i18n = TEAM_I18N[norm];
          teamMap.set(extId, {
            externalId: extId,
            nameEn: c.team.displayName ?? `Team ${c.team.id}`,
            nameAr: i18n?.ar ?? c.team.displayName ?? `Team ${c.team.id}`,
            code: c.team.abbreviation ?? null,
            flagUrl: i18n ? flag(i18n.cc) : null,
            countryCode: i18n?.cc ?? null,
          });
        }
      }

      const sType = comp.status?.type;
      const status = mapStatus(
        sType?.name ?? "",
        sType?.state ?? "",
        sType?.completed ?? false,
      );
      const homeScore = parseScore(home.score);
      const awayScore = parseScore(away.score);
      const clock = comp.status?.clock;
      const minute =
        typeof clock === "number" && clock > 0
          ? Math.floor(clock / 60)
          : null;

      matches.push({
        externalId: `espnf-match-${comp.id}`,
        stageType: "group",
        homeTeamExternalId: `espnf-team-${home.team.id}`,
        awayTeamExternalId: `espnf-team-${away.team.id}`,
        kickoffAt: new Date(event.date),
        status,
        homeScore,
        awayScore,
        minute,
        venue: comp.venue?.fullName ?? null,
      });
    }

    return { slug, teams: [...teamMap.values()], matches };
  }

  private async fetchEvents(): Promise<EspnEvent[]> {
    // Fetch today's events + yesterday's (handles timezone edge cases where
    // a match played yesterday is still showing live results today).
    const today = utcDateStr(new Date());
    const yesterday = utcDateStr(new Date(Date.now() - 86_400_000));

    const results = await Promise.allSettled([
      this.fetchForDate(today),
      // Only fetch yesterday if it's a different date (always true, just guard).
      yesterday !== today ? this.fetchForDate(yesterday) : Promise.resolve([]),
    ]);

    const events: EspnEvent[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      if (r.status === "fulfilled") {
        for (const e of r.value) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            events.push(e);
          }
        }
      }
    }
    return events;
  }

  private async fetchForDate(dateStr: string): Promise<EspnEvent[]> {
    const url = `${ESPN_BASE}?dates=${dateStr}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`ESPN friendlies request failed (${res.status}) for ${url}`);
    }
    const data = (await res.json()) as { events?: EspnEvent[] };
    return data.events ?? [];
  }
}

function utcDateStr(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function parseScore(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function createEspnFriendliesProvider(): FootballProvider {
  return new EspnFriendliesProvider();
}
