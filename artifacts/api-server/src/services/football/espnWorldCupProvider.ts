// ESPN public API adapter for the FIFA World Cup 2026 (ESPN league
// `fifa.world`, id 606, season 2026). No API key required — the scoreboard
// endpoint is fully public and has no tight free-tier limits, so this is a
// keyless alternative to the football-data.org provider.
//
// Unlike the friendlies adapter (which polls a rolling today/yesterday window),
// the World Cup adapter fetches the ENTIRE tournament in a single date-range
// call (Jun 11 – Jul 20 2026). A complete snapshot is required so the sync's
// prune logic sees every valid match and never mistakes a not-yet-fetched
// fixture for a stale row (which would delete it).
//
// External IDs are prefixed with "espnw-" so they cannot collide with
// football-data.org numeric IDs or the friendlies adapter's "espnf-" IDs.
//
// ESPN returns English team names only, so each team is enriched with an Arabic
// name + flag via the shared curated lookup (teamI18n.ts); unknown teams fall
// back to the English name and ESPN's logo artwork.

import type {
  FootballProvider,
  ProviderMatch,
  ProviderMatchStatus,
  ProviderStageType,
  ProviderTeam,
  ProviderTournament,
} from "./types";
import { flag, lookupTeamI18n } from "./teamI18n";

// Maps ESPN's status fields onto our provider status enum. ESPN reports a coarse
// `state` ("pre" / "in" / "post") plus a specific `status.type.name`
// (STATUS_FIRST_HALF / STATUS_HALFTIME / ...); explicit names take precedence so
// live phases and stoppages are detected correctly. Exported for unit testing.
export function mapStatus(
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

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

// Full tournament window. The whole bracket is returned by a single date-range
// call spanning the first group match (Jun 11) through the final (Jul 19);
// Jul 20 gives a one-day margin. Overridable via env for ops/testing.
const DEFAULT_START = "20260611";
const DEFAULT_END = "20260720";

// Map an ESPN event's `season.slug` to our seeded stage_type enum. ESPN uses
// slugs like "group-stage", "round-of-32", "round-of-16", "quarterfinals",
// "semifinals", a third-place slug, and "final". Order matters: the knockout
// slugs ("quarterfinals", "semifinals") contain the substring "final", so the
// specific rounds must be checked BEFORE the generic "final" fallback.
export function mapStage(slug: string | null | undefined): ProviderStageType {
  const s = (slug ?? "").toLowerCase();
  if (s.includes("round-of-32") || s.includes("round of 32")) return "round_of_32";
  if (s.includes("round-of-16") || s.includes("round of 16")) return "round_of_16";
  if (s.includes("quarter")) return "quarter_final";
  if (s.includes("semi")) return "semi_final";
  if (s.includes("third") || s.includes("3rd")) return "third_place";
  if (s.includes("final")) return "final";
  return "group";
}

interface EspnTeam {
  id: string;
  displayName?: string;
  name?: string;
  abbreviation?: string;
  logo?: string;
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

export interface EspnWorldCupEvent {
  id: string;
  date: string;
  season?: { slug?: string };
  competitions: EspnCompetition[];
}

function parseScore(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ESPN's date-range snapshot includes bracket-placeholder "competitors" for
// not-yet-determined knockout slots — e.g. "Group A Winner", "Group A 2nd
// Place", "Round of 16 1 Winner", "Round of 32 14 Winner", "Third Place Group
// …". These are not real national teams: they have no country/flag and would
// otherwise pollute the teams table and the public favourite-team picker
// (GET /teams). They are detected purely by name ("winner"/"place" never appear
// in a real nation's name) and skipped, so the affected knockout matches stay
// TBD (null teams) until the real teams are known — matching the football-data
// baseline. Exported for unit testing.
export function isPlaceholderTeam(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return /\bwinner\b/.test(n) || /\bplace\b/.test(n);
}

function toTeam(t: EspnTeam): ProviderTeam {
  const nameEn = t.displayName ?? t.name ?? `Team ${t.id}`;
  const i18n = lookupTeamI18n(nameEn);
  return {
    externalId: `espnw-team-${t.id}`,
    nameEn,
    nameAr: i18n?.ar ?? nameEn,
    code: t.abbreviation ?? null,
    flagUrl: i18n ? flag(i18n.cc) : (t.logo ?? null),
    countryCode: i18n?.cc ?? null,
  };
}

// Pure assembly of a ProviderTournament from raw ESPN World Cup events.
// Exported for unit testing (no network). Skips malformed events (missing a
// competition or a home/away competitor) rather than throwing, so one bad
// event can't break the whole snapshot.
export function buildTournament(
  slug: string,
  events: EspnWorldCupEvent[],
): ProviderTournament {
  const teamMap = new Map<string, ProviderTeam>();
  const matches: ProviderMatch[] = [];

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp?.competitors) continue;

    const home = comp.competitors.find((c) => c.homeAway === "home");
    const away = comp.competitors.find((c) => c.homeAway === "away");
    if (!home?.team?.id || !away?.team?.id) continue;

    // Bracket-placeholder slots ("Group A Winner", etc.) are not real teams: the
    // match is still created (so the bracket/schedule is complete and the prune
    // step sees it) but its team slot stays null until the real team is known.
    const homePlaceholder = isPlaceholderTeam(home.team.displayName ?? home.team.name);
    const awayPlaceholder = isPlaceholderTeam(away.team.displayName ?? away.team.name);

    for (const c of [home, away]) {
      if (isPlaceholderTeam(c.team.displayName ?? c.team.name)) continue;
      const team = toTeam(c.team);
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
      externalId: `espnw-match-${comp.id}`,
      stageType: mapStage(event.season?.slug),
      homeTeamExternalId: homePlaceholder ? null : `espnw-team-${home.team.id}`,
      awayTeamExternalId: awayPlaceholder ? null : `espnw-team-${away.team.id}`,
      kickoffAt: new Date(event.date),
      status,
      homeScore: parseScore(home.score),
      awayScore: parseScore(away.score),
      minute,
      venue: comp.venue?.fullName ?? null,
    });
  }

  return { slug, teams: [...teamMap.values()], matches };
}

export class EspnWorldCupProvider implements FootballProvider {
  readonly name = "espn-wc";
  private readonly startDate: string;
  private readonly endDate: string;

  constructor() {
    this.startDate = process.env.ESPN_WC2026_START_DATE || DEFAULT_START;
    this.endDate = process.env.ESPN_WC2026_END_DATE || DEFAULT_END;
  }

  async fetchTournament(slug: string): Promise<ProviderTournament> {
    const events = await this.fetchEvents();
    return buildTournament(slug, events);
  }

  private async fetchEvents(): Promise<EspnWorldCupEvent[]> {
    const url = `${ESPN_BASE}?dates=${this.startDate}-${this.endDate}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`ESPN World Cup request failed (${res.status}) for ${url}`);
    }
    const data = (await res.json()) as { events?: EspnWorldCupEvent[] };
    return data.events ?? [];
  }
}

// Create the keyless ESPN World Cup provider. No API key required, so this
// never returns null — it is the keyless fallback selected when neither
// football-data.org nor SportMonks is configured (see index.ts).
export function createEspnWorldCupProvider(): FootballProvider {
  return new EspnWorldCupProvider();
}
