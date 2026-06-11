/**
 * Hall of Fame visibility regression test.
 *
 * `GET /hall-of-fame/top-players` is a viewer-optional (public) endpoint that
 * lists the global Top-N players together with the challenge(s) each player
 * belongs to. Those challenge names/IDs must respect challenge visibility:
 *   - public / unlisted challenges may be shown to anyone, but
 *   - a PRIVATE challenge may only be revealed to a viewer who owns it or is an
 *     active participant of that specific challenge.
 * Without that filter the public board would leak private challenge names/IDs
 * and the member associations behind them. This test closes that gap.
 *
 * It seeds, in-process and directly against the dev DB:
 *   - three users: the ranked PLAYER, an unrelated OUTSIDER, and a MEMBER,
 *   - one tournament + two teams + one finished match,
 *   - ONE pre-scored prediction for the player (so they top globalStandings),
 *   - two challenges owned by the player: one PUBLIC and one PRIVATE, with the
 *     member added as an active participant of the private one.
 *
 * It asserts `computeTopPlayers(viewer)` returns, for the player's entry:
 *   1. anonymous viewer  -> public challenge present, private ABSENT,
 *   2. outsider viewer   -> public challenge present, private ABSENT,
 *   3. the player (owner) -> private challenge PRESENT,
 *   4. the member         -> private challenge PRESENT.
 *
 * Every seeded row is reverted afterward, leaving the dev DB as found.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  tournamentsTable,
  teamsTable,
  matchesTable,
  challengesTable,
  challengeParticipantsTable,
  predictionsTable,
  rankingsTable,
} from "@workspace/db";
import { computeTopPlayers } from "../src/services/scoring/rankings";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// ---- Tiny assertion harness -------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } else {
    const msg = detail ? `${label} \u2014 ${detail}` : label;
    failures.push(msg);
    console.error(`  \u2717 ${msg}`);
  }
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const hourMs = 60 * 60 * 1000;

  const created: {
    userIds: string[];
    tournamentId?: string;
    teamIds: string[];
    matchId?: string;
    challengeIds: string[];
  } = { userIds: [], teamIds: [], challengeIds: [] };

  const preRankingIds = new Set(
    (await db.select({ id: rankingsTable.id }).from(rankingsTable)).map(
      (r) => r.id,
    ),
  );

  try {
    const mkUser = async (tag: string) => {
      const [u] = await db
        .insert(usersTable)
        .values({
          clerkUserId: `hof-vis-e2e-${tag}-${stamp}`,
          email: `thaddi-hof-vis-${tag}-${stamp}@example.com`,
          emailVerified: true,
          status: "active",
        })
        .returning();
      created.userIds.push(u.id);
      return u;
    };
    const player = await mkUser("player");
    const outsider = await mkUser("outsider");
    const member = await mkUser("member");

    const [tournament] = await db
      .insert(tournamentsTable)
      .values({
        slug: `hof-vis-${stamp}`,
        nameEn: "HoF Visibility Tournament",
        nameAr: "بطولة اختبار الرؤية",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentId = tournament.id;

    const [home] = await db
      .insert(teamsTable)
      .values({
        nameEn: "HoF Vis Home",
        nameAr: "فريق المضيف",
        externalId: `hof-vis-home-${stamp}`,
      })
      .returning();
    const [away] = await db
      .insert(teamsTable)
      .values({
        nameEn: "HoF Vis Away",
        nameAr: "فريق الضيف",
        externalId: `hof-vis-away-${stamp}`,
      })
      .returning();
    created.teamIds.push(home.id, away.id);

    const [match] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoffAt: new Date(Date.now() - 3 * hourMs),
        status: "finished",
        homeScore: 2,
        awayScore: 1,
        externalId: `hof-vis-match-${stamp}`,
        venue: "HoF Vis Stadium",
      })
      .returning();
    created.matchId = match.id;

    // One pre-scored prediction => the player tops globalStandings.
    await db.insert(predictionsTable).values({
      userId: player.id,
      matchId: match.id,
      homeScore: 2,
      awayScore: 1,
      pointsAwarded: 100,
      outcome: "exact",
      scoredAt: new Date(),
    });

    // Two challenges owned by the player: one public, one private.
    const [pub] = await db
      .insert(challengesTable)
      .values({
        ownerId: player.id,
        name: `HoF Vis PUBLIC ${stamp}`,
        type: "friends",
        visibility: "public",
        scope: "entire_tournament",
        status: "active",
        tournamentId: tournament.id,
      })
      .returning();
    const [priv] = await db
      .insert(challengesTable)
      .values({
        ownerId: player.id,
        name: `HoF Vis PRIVATE ${stamp}`,
        type: "friends",
        visibility: "private",
        scope: "entire_tournament",
        status: "active",
        tournamentId: tournament.id,
      })
      .returning();
    created.challengeIds.push(pub.id, priv.id);

    // The member is an active participant of the PRIVATE challenge.
    await db.insert(challengeParticipantsTable).values({
      challengeId: priv.id,
      userId: member.id,
      status: "active",
    });

    const challengeIdsFor = async (viewerId: string | null) => {
      const data = await computeTopPlayers(viewerId, 10);
      const entry = data.entries.find((e) => e.userId === player.id);
      return {
        found: Boolean(entry),
        ids: new Set((entry?.challenges ?? []).map((c) => c.id)),
      };
    };

    console.log("\nAnonymous viewer:");
    const anon = await challengeIdsFor(null);
    check("anonymous: player appears in top players", anon.found);
    check("anonymous: PUBLIC challenge is visible", anon.ids.has(pub.id));
    check(
      "anonymous: PRIVATE challenge is NOT leaked",
      !anon.ids.has(priv.id),
      `ids=${JSON.stringify([...anon.ids])}`,
    );

    console.log("\nUnrelated outsider viewer:");
    const out = await challengeIdsFor(outsider.id);
    check("outsider: PUBLIC challenge is visible", out.ids.has(pub.id));
    check(
      "outsider: PRIVATE challenge is NOT leaked",
      !out.ids.has(priv.id),
      `ids=${JSON.stringify([...out.ids])}`,
    );

    console.log("\nOwner (the player) viewing themselves:");
    const owner = await challengeIdsFor(player.id);
    check("owner: PUBLIC challenge is visible", owner.ids.has(pub.id));
    check("owner: PRIVATE challenge IS visible to owner", owner.ids.has(priv.id));

    console.log("\nActive member of the private challenge:");
    const mem = await challengeIdsFor(member.id);
    check("member: PUBLIC challenge is visible", mem.ids.has(pub.id));
    check(
      "member: PRIVATE challenge IS visible to active member",
      mem.ids.has(priv.id),
    );
  } finally {
    console.log("\nTeardown:");
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`  teardown ${label} failed:`, err);
      }
    };

    const newRankingIds = (
      await db.select({ id: rankingsTable.id }).from(rankingsTable)
    )
      .map((r) => r.id)
      .filter((id) => !preRankingIds.has(id));

    if (created.challengeIds.length) {
      await safe("challenges", () =>
        db
          .delete(challengesTable)
          .where(inArray(challengesTable.id, created.challengeIds)),
      );
    }
    if (created.matchId) {
      await safe("predictions", () =>
        db
          .delete(predictionsTable)
          .where(eq(predictionsTable.matchId, created.matchId!)),
      );
      await safe("match", () =>
        db.delete(matchesTable).where(eq(matchesTable.id, created.matchId!)),
      );
    }
    if (created.teamIds.length) {
      await safe("teams", () =>
        db.delete(teamsTable).where(inArray(teamsTable.id, created.teamIds)),
      );
    }
    if (created.tournamentId) {
      await safe("tournament", () =>
        db
          .delete(tournamentsTable)
          .where(eq(tournamentsTable.id, created.tournamentId!)),
      );
    }
    if (newRankingIds.length) {
      await safe("rankings", () =>
        db.delete(rankingsTable).where(inArray(rankingsTable.id, newRankingIds)),
      );
    }
    if (created.userIds.length) {
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, created.userIds)),
      );
    }

    await safe("pool end", () => pool.end());
  }

  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Hall-of-Fame visibility regression: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Hall-of-Fame visibility regression: ${failures.length} FAILED, ${passed} passed.`,
    );
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Hall-of-Fame visibility regression crashed:", err);
    process.exit(1);
  });
