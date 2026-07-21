// Unit tests for the generic, season-adaptive ESPN provider
// (src/services/football/espnProvider.ts). All pure (no network):
//   1. pickSeason — the crux of season selection. Off-season must NOT resurface
//      an ended campaign: it picks the season covering now, else the nearest
//      upcoming one, else null ("coming soon").
//   2. parseYearFromRef — pulls the season year out of a core-API $ref.
//   3. mapCompetitionStage — leagues collapse to "league"; cups/World Championship reuse
//      the knockout bracket mapper.
//   4. chunkWindows — splits a long season into prune-safe date sub-ranges.
//   5. teamExternalId / matchExternalId — `espn:{comp}:{kind}:{id}` namespacing.
//   6. buildCompetitionSnapshot — assembles clubs (kind="club") + matches, skips
//      knockout placeholders but never league teams.
//
// Run with: pnpm --filter @workspace/api-server exec tsx --test test/espnProvider.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickSeason,
  parseYearFromRef,
  mapCompetitionStage,
  chunkWindows,
  teamExternalId,
  matchExternalId,
  buildCompetitionSnapshot,
  fetchLeagueTeams,
  type SeasonWindow,
} from "../src/services/football/espnProvider.ts";
import type { EspnworldchampionshipEvent } from "../src/services/football/espnworldchampionshipProvider.ts";

const NOW = new Date("2026-06-19T00:00:00Z");

function season(
  year: number,
  start: string,
  end: string,
  displayName: string | null = null,
): SeasonWindow {
  return {
    year,
    startDate: new Date(start),
    endDate: new Date(end),
    displayName,
  };
}

test("pickSeason returns null when every candidate season has ended (coming soon)", () => {
  // June 2026: the only seasons ESPN knows about have both already finished.
  const windows = [
    season(2024, "2024-08-01T00:00:00Z", "2025-05-31T00:00:00Z"),
    season(2025, "2025-08-01T00:00:00Z", "2026-05-31T00:00:00Z"),
  ];
  assert.equal(pickSeason(windows, NOW), null);
});

test("pickSeason picks the nearest UPCOMING season when none covers now (off-season PL)", () => {
  // 2025/26 has ended; 2026/27 has not started yet → feature 2026/27 (upcoming).
  const windows = [
    season(2025, "2025-08-01T00:00:00Z", "2026-05-31T00:00:00Z"),
    season(2026, "2026-08-08T00:00:00Z", "2027-05-24T00:00:00Z", "2026-27"),
  ];
  const picked = pickSeason(windows, NOW);
  assert.ok(picked);
  assert.equal(picked.year, 2026);
});

test("pickSeason picks the season CURRENTLY in progress (King's Cup / World Championship live)", () => {
  // A season window straddling now must win over an upcoming one.
  const windows = [
    season(2026, "2026-06-11T00:00:00Z", "2026-07-19T23:59:59Z", "2026"), // covers now
    season(2027, "2026-09-01T00:00:00Z", "2027-05-31T00:00:00Z"),
  ];
  const picked = pickSeason(windows, NOW);
  assert.ok(picked);
  assert.equal(picked.year, 2026);
});

test("pickSeason prefers the most recently started season when several overlap now", () => {
  const windows = [
    season(2025, "2025-08-01T00:00:00Z", "2026-08-31T00:00:00Z"), // long, still open
    season(2026, "2026-06-01T00:00:00Z", "2026-12-31T00:00:00Z"), // started more recently
  ];
  const picked = pickSeason(windows, NOW);
  assert.ok(picked);
  assert.equal(picked.year, 2026);
});

test("parseYearFromRef extracts the season year from a core-API $ref", () => {
  assert.equal(
    parseYearFromRef(
      "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026?lang=en&region=us",
    ),
    2026,
  );
  assert.equal(parseYearFromRef("nonsense"), null);
  assert.equal(parseYearFromRef(""), null);
});

test("mapCompetitionStage: leagues collapse to 'league', knockouts use the bracket mapper", () => {
  assert.equal(mapCompetitionStage("league", "anything"), "league");
  assert.equal(mapCompetitionStage("league", undefined), "league");
  // Cups + World Championship reuse the WC slug→stage mapping.
  assert.equal(mapCompetitionStage("cup", "round-of-16"), "round_of_16");
  assert.equal(mapCompetitionStage("cup", "quarterfinals"), "quarter_final");
  assert.equal(mapCompetitionStage("WORLD_CHAMPIONSHIP", "final"), "final");
  assert.equal(mapCompetitionStage("WORLD_CHAMPIONSHIP", "semifinals"), "semi_final");
});

test("chunkWindows splits a long season into contiguous, gapless sub-ranges", () => {
  const ranges = chunkWindows(
    new Date("2026-08-01T00:00:00Z"),
    new Date("2027-05-31T00:00:00Z"),
  );
  assert.ok(ranges.length > 1);
  assert.equal(ranges[0].start, "20260801");
  assert.equal(ranges[ranges.length - 1].end, "20270531");
  // A short window collapses to exactly one range.
  const one = chunkWindows(
    new Date("2026-06-19T00:00:00Z"),
    new Date("2026-06-20T00:00:00Z"),
  );
  assert.equal(one.length, 1);
  assert.equal(one[0].start, "20260619");
  assert.equal(one[0].end, "20260620");
});

test("external IDs are namespaced per competition", () => {
  assert.equal(teamExternalId("eng.1", 359), "espn:eng.1:team:359");
  assert.equal(matchExternalId("ksa.kings.cup", "704321"), "espn:ksa.kings.cup:event:704321");
});

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
        status: {
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

test("buildCompetitionSnapshot: league produces namespaced club teams + a 'league' stage", () => {
  const events = [
    makeEvent({
      id: "1",
      date: "2026-08-15T16:00Z",
      slug: "regular-season",
      homeId: "359",
      homeName: "Liverpool",
      awayId: "360",
      awayName: "Arsenal",
      compId: "c1",
      homeScore: "2",
      awayScore: "1",
      statusName: "STATUS_FULL_TIME",
      state: "post",
      completed: true,
      homeAbbr: "LIV",
      homeLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/359.png",
    }),
  ];

  const snap = buildCompetitionSnapshot(
    { localSlug: "eng.1-2026", competitionSlug: "eng.1", type: "league", countryCode: "gb-eng" },
    events,
  );

  assert.equal(snap.slug, "eng.1-2026");
  assert.equal(snap.matches.length, 1);
  assert.equal(snap.teams.length, 2);

  const m = snap.matches[0];
  assert.equal(m.externalId, "espn:eng.1:event:c1");
  assert.equal(m.stageType, "league");
  assert.equal(m.homeTeamExternalId, "espn:eng.1:team:359");
  assert.equal(m.awayTeamExternalId, "espn:eng.1:team:360");
  assert.equal(m.status, "finished");
  assert.equal(m.homeScore, 2);
  assert.equal(m.awayScore, 1);

  const liv = snap.teams.find((t) => t.externalId === "espn:eng.1:team:359");
  assert.ok(liv);
  assert.equal(liv.kind, "club");
  assert.equal(liv.primaryCompetitionSlug, "eng.1");
  assert.equal(liv.code, "LIV");
  // Curated club Arabic name (Phase 4); crest stays ESPN's logo and the country
  // is the competition's, not a nation flag.
  assert.equal(liv.nameAr, "ليفربول");
  assert.equal(liv.flagUrl, "https://a.espncdn.com/i/teamlogos/soccer/500/359.png");
  assert.equal(liv.countryCode, "gb-eng");
});

test("buildCompetitionSnapshot: cups keep placeholder matches but drop the placeholder slot", () => {
  const events = [
    makeEvent({
      id: "1",
      date: "2026-09-20T18:00Z",
      slug: "round-of-16",
      homeId: "1100",
      homeName: "Al Hilal",
      awayId: "1101",
      awayName: "Al Nassr",
      compId: "k1",
    }),
    // A later round where one slot is still an undecided bracket placeholder.
    makeEvent({
      id: "2",
      date: "2026-10-05T18:00Z",
      slug: "quarterfinals",
      homeId: "1100",
      homeName: "Al Hilal",
      awayId: "9001",
      awayName: "Match 3 Winner",
      compId: "k2",
    }),
  ];

  const snap = buildCompetitionSnapshot(
    { localSlug: "ksa.kings.cup-2026", competitionSlug: "ksa.kings.cup", type: "cup", countryCode: "sa" },
    events,
  );

  // Placeholder is never added as a team.
  assert.equal(snap.teams.length, 2);
  assert.ok(!snap.teams.some((t) => t.nameEn.includes("Winner")));
  // Both matches survive (bracket stays complete for prune).
  assert.equal(snap.matches.length, 2);

  const qf = snap.matches.find((m) => m.externalId === "espn:ksa.kings.cup:event:k2");
  assert.ok(qf);
  assert.equal(qf.stageType, "quarter_final");
  assert.equal(qf.homeTeamExternalId, "espn:ksa.kings.cup:team:1100");
  assert.equal(qf.awayTeamExternalId, null); // placeholder dropped
});

test("buildCompetitionSnapshot dedupes clubs shared across matches", () => {
  const events = [
    makeEvent({
      id: "1", date: "2026-08-15T16:00Z", slug: "rs",
      homeId: "359", homeName: "Liverpool", awayId: "360", awayName: "Arsenal", compId: "c1",
    }),
    makeEvent({
      id: "2", date: "2026-08-22T16:00Z", slug: "rs",
      homeId: "359", homeName: "Liverpool", awayId: "361", awayName: "Chelsea", compId: "c2",
    }),
  ];
  const snap = buildCompetitionSnapshot(
    { localSlug: "eng.1-2026", competitionSlug: "eng.1", type: "league", countryCode: "gb-eng" },
    events,
  );
  assert.equal(snap.matches.length, 2);
  assert.equal(snap.teams.length, 3); // Liverpool, Arsenal, Chelsea
  assert.equal(snap.teams.filter((t) => t.externalId === "espn:eng.1:team:359").length, 1);
});

test("buildCompetitionSnapshot: WORLD_CHAMPIONSHIP teams are NATIONAL (flag + Arabic nation, no competition)", () => {
  const events = [
    makeEvent({
      id: "1", date: "2026-06-20T16:00Z", slug: "group-a",
      homeId: "202", homeName: "Brazil", awayId: "205", awayName: "France", compId: "w1",
    }),
  ];
  const snap = buildCompetitionSnapshot(
    { localSlug: "world.champ-2026", competitionSlug: "world.champ", type: "WORLD_CHAMPIONSHIP", countryCode: null },
    events,
  );
  const br = snap.teams.find((t) => t.externalId === "espn:world.champ:team:202");
  assert.ok(br);
  assert.equal(br.kind, "national");
  assert.equal(br.primaryCompetitionSlug, null);
  assert.equal(br.nameAr, "البرازيل");
  assert.equal(br.flagUrl, "https://flagcdn.com/w160/br.png");
  assert.equal(br.countryCode, "br");
});

test("fetchLeagueTeams maps the full ESPN roster to namespaced club teams", async () => {
  const body = {
    sports: [
      {
        leagues: [
          {
            teams: [
              {
                team: {
                  id: "1100",
                  displayName: "Al Hilal",
                  abbreviation: "HIL",
                  logos: [{ href: "https://logo/hilal.png" }],
                },
              },
              {
                team: {
                  id: "9999",
                  displayName: "Some New Club",
                  abbreviation: "SNC",
                  logos: [{ href: "https://logo/snc.png" }],
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    const teams = await fetchLeagueTeams("ksa.1", {
      localSlug: "ksa.1-2026",
      competitionSlug: "ksa.1",
      type: "league",
      countryCode: "sa",
    });
    assert.equal(teams.length, 2);

    const hilal = teams.find((t) => t.externalId === "espn:ksa.1:team:1100");
    assert.ok(hilal);
    assert.equal(hilal.kind, "club");
    assert.equal(hilal.primaryCompetitionSlug, "ksa.1");
    assert.equal(hilal.code, "HIL");
    assert.equal(hilal.nameAr, "الهلال"); // curated Arabic
    assert.equal(hilal.flagUrl, "https://logo/hilal.png"); // ESPN crest, not a flag
    assert.equal(hilal.countryCode, "sa"); // league country, not a nation cc

    // A club absent from the curated map keeps its English name.
    const snc = teams.find((t) => t.externalId === "espn:ksa.1:team:9999");
    assert.ok(snc);
    assert.equal(snc.nameAr, "Some New Club");
  } finally {
    globalThis.fetch = orig;
  }
});
