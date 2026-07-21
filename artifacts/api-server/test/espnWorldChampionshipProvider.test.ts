// Unit tests for the ESPN World Championship 2026 provider
// (src/services/football/espnworldchampionshipProvider.ts).
//
// Two layers are locked in here, both pure (no network):
//   1. mapStage — maps ESPN's `season.slug` onto our seeded stage_type enum.
//      The knockout slugs ("quarterfinals", "semifinals") embed the substring
//      "final", so a regression in ordering would silently misclassify every
//      knockout match as the final.
//   2. buildTournament — assembles a full ProviderTournament snapshot from raw
//      ESPN events: dedupes teams across matches, prefixes external IDs with
//      "espnw-", enriches Arabic names/flags via the curated map, and skips
//      malformed events. A correct full-range snapshot is what lets sync's
//      prune logic run safely (an incomplete snapshot would delete valid rows).
//
// Run with: pnpm --filter @workspace/api-server exec tsx --test test/espnworldchampionshipProvider.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapStage,
  buildTournament,
  isPlaceholderTeam,
  type EspnworldchampionshipEvent,
} from "../src/services/football/espnworldchampionshipProvider.ts";

test("mapStage maps every ESPN season slug to the right stage", () => {
  assert.equal(mapStage("group-stage"), "group");
  assert.equal(mapStage("round-of-32"), "round_of_32");
  assert.equal(mapStage("round-of-16"), "round_of_16");
  assert.equal(mapStage("quarterfinals"), "quarter_final");
  assert.equal(mapStage("semifinals"), "semi_final");
  assert.equal(mapStage("final"), "final");
});

test("mapStage: knockout slugs containing 'final' are not misread as the final", () => {
  // "quarterfinals"/"semifinals" both embed "final" — the specific rounds must
  // win over the generic final fallback.
  assert.notEqual(mapStage("quarterfinals"), "final");
  assert.notEqual(mapStage("semifinals"), "final");
});

test("mapStage maps third-place variants and falls back to group", () => {
  assert.equal(mapStage("third-place"), "third_place");
  assert.equal(mapStage("3rd-place-match"), "third_place");
  // Unknown / missing slug → group (the safe default stage).
  assert.equal(mapStage(""), "group");
  assert.equal(mapStage(undefined), "group");
  assert.equal(mapStage("something-weird"), "group");
});

// Minimal raw-event factory mirroring ESPN's scoreboard shape.
function makeEvent(opts: {
  id: string;
  date: string;
  slug: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  compId?: string;
  homeScore?: string;
  awayScore?: string;
  statusName?: string;
  state?: string;
  completed?: boolean;
  clock?: number;
  venue?: string;
  homeAbbr?: string;
  homeLogo?: string;
}): EspnworldchampionshipEvent {
  return {
    id: opts.id,
    date: opts.date,
    season: { slug: opts.slug },
    competitions: [
      {
        id: opts.compId ?? opts.id,
        venue: opts.venue ? { fullName: opts.venue } : undefined,
        status: {
          clock: opts.clock,
          type: {
            name: opts.statusName ?? "STATUS_SCHEDULED",
            state: opts.state ?? "pre",
            completed: opts.completed ?? false,
          },
        },
        competitors: [
          {
            homeAway: "home",
            score: opts.homeScore,
            team: {
              id: opts.homeId,
              displayName: opts.homeName,
              abbreviation: opts.homeAbbr,
              logo: opts.homeLogo,
            },
          },
          {
            homeAway: "away",
            score: opts.awayScore,
            team: { id: opts.awayId, displayName: opts.awayName },
          },
        ],
      },
    ],
  };
}

test("buildTournament assembles a full snapshot with espnw- prefixed ids", () => {
  const events: EspnworldchampionshipEvent[] = [
    makeEvent({
      id: "1",
      date: "2026-06-11T19:00Z",
      slug: "group-stage",
      homeId: "203",
      homeName: "Mexico",
      awayId: "100",
      awayName: "Saudi Arabia",
      compId: "c1",
      homeScore: "2",
      awayScore: "1",
      statusName: "STATUS_FULL_TIME",
      state: "post",
      completed: true,
      clock: 5400,
      venue: "Estadio Azteca",
    }),
    makeEvent({
      id: "2",
      date: "2026-07-19T19:00Z",
      slug: "final",
      homeId: "5",
      homeName: "Brazil",
      awayId: "9",
      awayName: "France",
      compId: "c2",
    }),
  ];

  const t = buildTournament("world-championship-2026", events);

  assert.equal(t.slug, "world-championship-2026");
  assert.equal(t.matches.length, 2);
  assert.equal(t.teams.length, 4);

  // All external ids are namespaced so they can't collide with other providers.
  for (const m of t.matches) {
    assert.ok(m.externalId.startsWith("espnw-match-"));
    assert.ok(m.homeTeamExternalId?.startsWith("espnw-team-"));
    assert.ok(m.awayTeamExternalId?.startsWith("espnw-team-"));
  }
  for (const team of t.teams) {
    assert.ok(team.externalId.startsWith("espnw-team-"));
  }

  const finished = t.matches.find((m) => m.externalId === "espnw-match-c1");
  assert.ok(finished);
  assert.equal(finished.stageType, "group");
  assert.equal(finished.status, "finished");
  assert.equal(finished.homeScore, 2);
  assert.equal(finished.awayScore, 1);
  assert.equal(finished.minute, 90); // clock 5400s / 60
  assert.equal(finished.venue, "Estadio Azteca");

  const final = t.matches.find((m) => m.externalId === "espnw-match-c2");
  assert.ok(final);
  assert.equal(final.stageType, "final");
  assert.equal(final.status, "scheduled");
  assert.equal(final.homeScore, null);
  assert.equal(final.awayScore, null);
  assert.equal(final.minute, null);
});

test("buildTournament dedupes teams shared across matches", () => {
  // Brazil plays in both matches; it must appear exactly once in teams.
  const events: EspnworldchampionshipEvent[] = [
    makeEvent({
      id: "1",
      date: "2026-06-11T19:00Z",
      slug: "group-stage",
      homeId: "5",
      homeName: "Brazil",
      awayId: "9",
      awayName: "France",
      compId: "c1",
    }),
    makeEvent({
      id: "2",
      date: "2026-06-15T19:00Z",
      slug: "group-stage",
      homeId: "5",
      homeName: "Brazil",
      awayId: "203",
      awayName: "Mexico",
      compId: "c2",
    }),
  ];

  const t = buildTournament("world-championship-2026", events);
  assert.equal(t.matches.length, 2);
  const brazil = t.teams.filter((x) => x.externalId === "espnw-team-5");
  assert.equal(brazil.length, 1);
  assert.equal(t.teams.length, 3); // Brazil, France, Mexico
});

test("buildTournament enriches curated teams and falls back for unknown ones", () => {
  const events: EspnworldchampionshipEvent[] = [
    makeEvent({
      id: "1",
      date: "2026-06-11T19:00Z",
      slug: "group-stage",
      homeId: "100",
      homeName: "Saudi Arabia",
      homeAbbr: "KSA",
      awayId: "999",
      awayName: "Atlantis",
      compId: "c1",
    }),
  ];

  const t = buildTournament("world-championship-2026", events);
  const ksa = t.teams.find((x) => x.externalId === "espnw-team-100");
  assert.ok(ksa);
  assert.equal(ksa.nameEn, "Saudi Arabia");
  assert.equal(ksa.nameAr, "السعودية"); // curated Arabic name
  assert.equal(ksa.code, "KSA");
  assert.equal(ksa.countryCode, "sa");
  assert.equal(ksa.flagUrl, "https://flagcdn.com/w160/sa.png");

  // Unknown team: Arabic falls back to English, country code is null.
  const unknown = t.teams.find((x) => x.externalId === "espnw-team-999");
  assert.ok(unknown);
  assert.equal(unknown.nameEn, "Atlantis");
  assert.equal(unknown.nameAr, "Atlantis");
  assert.equal(unknown.countryCode, null);
});

test("buildTournament skips malformed events without throwing", () => {
  const events: EspnworldchampionshipEvent[] = [
    // No competitions.
    { id: "x1", date: "2026-06-11T19:00Z", season: { slug: "group-stage" }, competitions: [] },
    // Missing the away competitor.
    {
      id: "x2",
      date: "2026-06-11T19:00Z",
      season: { slug: "group-stage" },
      competitions: [
        {
          id: "cx2",
          competitors: [
            { homeAway: "home", team: { id: "5", displayName: "Brazil" } },
          ],
        },
      ],
    },
    // Valid.
    makeEvent({
      id: "ok",
      date: "2026-06-11T19:00Z",
      slug: "group-stage",
      homeId: "5",
      homeName: "Brazil",
      awayId: "9",
      awayName: "France",
      compId: "cok",
    }),
  ];

  const t = buildTournament("world-championship-2026", events);
  assert.equal(t.matches.length, 1);
  assert.equal(t.matches[0].externalId, "espnw-match-cok");
});

test("isPlaceholderTeam flags bracket slots but never real nations", () => {
  // ESPN bracket-placeholder slot names.
  assert.ok(isPlaceholderTeam("Group A Winner"));
  assert.ok(isPlaceholderTeam("Group A 2nd Place"));
  assert.ok(isPlaceholderTeam("Round of 16 1 Winner"));
  assert.ok(isPlaceholderTeam("Round of 32 14 Winner"));
  assert.ok(isPlaceholderTeam("Third Place Group A/B/C/D/F"));
  // Third-place-match slots ESPN names by the semifinal losers.
  assert.ok(isPlaceholderTeam("Semifinal 1 Loser"));
  assert.ok(isPlaceholderTeam("Semifinal 2 Loser"));
  // Real nations never contain "winner"/"place"/"loser".
  assert.ok(!isPlaceholderTeam("Mexico"));
  assert.ok(!isPlaceholderTeam("Cape Verde"));
  assert.ok(!isPlaceholderTeam("Bosnia-Herzegovina"));
  assert.ok(!isPlaceholderTeam(null));
});

test("buildTournament keeps placeholder matches but leaves their team slots null", () => {
  const events: EspnworldchampionshipEvent[] = [
    // A real group match.
    makeEvent({
      id: "1",
      date: "2026-06-11T19:00Z",
      slug: "group-stage",
      homeId: "5",
      homeName: "Brazil",
      awayId: "9",
      awayName: "France",
      compId: "c1",
    }),
    // A knockout match where ESPN supplies bracket-placeholder competitors.
    makeEvent({
      id: "2",
      date: "2026-07-05T19:00Z",
      slug: "round-of-16",
      homeId: "5923",
      homeName: "Group A Winner",
      awayId: "5924",
      awayName: "Group B 2nd Place",
      compId: "c2",
    }),
    // Half-placeholder: one real team already known, the other a placeholder.
    makeEvent({
      id: "3",
      date: "2026-07-06T19:00Z",
      slug: "round-of-16",
      homeId: "5",
      homeName: "Brazil",
      awayId: "5925",
      awayName: "Group B Winner",
      compId: "c3",
    }),
  ];

  const t = buildTournament("world-championship-2026", events);

  // Placeholder "teams" never enter the teams list — only Brazil + France.
  assert.equal(t.teams.length, 2);
  assert.ok(!t.teams.some((x) => x.nameEn.includes("Winner") || x.nameEn.includes("Place")));

  // All three matches are still present (bracket stays complete for prune).
  assert.equal(t.matches.length, 3);

  const knockout = t.matches.find((m) => m.externalId === "espnw-match-c2");
  assert.ok(knockout);
  assert.equal(knockout.homeTeamExternalId, null);
  assert.equal(knockout.awayTeamExternalId, null);

  const half = t.matches.find((m) => m.externalId === "espnw-match-c3");
  assert.ok(half);
  assert.equal(half.homeTeamExternalId, "espnw-team-5"); // Brazil kept
  assert.equal(half.awayTeamExternalId, null); // placeholder dropped
});
