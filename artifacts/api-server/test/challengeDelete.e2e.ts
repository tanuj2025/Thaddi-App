/**
 * Challenge permanent-delete authorization + cleanup regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * the security-sensitive permanent-delete endpoint `DELETE /challenges/:id`:
 *
 *   1. Authorization: a non-owner can NEVER delete someone else's challenge
 *      (-> 403) and that rejected attempt leaves every dependent row intact;
 *      deleting a challenge that does not exist -> 404; the real owner -> 200.
 *   2. Cascade cleanup: after the owner deletes, NO rows remain for that
 *      challenge id in challenge_participants, challenge_matches,
 *      challenge_prizes, points_ledger, or rankings (no orphans), and the
 *      challenge row itself is gone.
 *   3. Achievement preservation: a player keeps the achievement they earned in
 *      the deleted challenge — the user_achievements row survives with its
 *      challengeId nulled (FK onDelete: "set null"), not deleted.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `playerFlows.e2e.ts`).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  tournamentsTable,
  stagesTable,
  teamsTable,
  matchesTable,
  challengesTable,
  challengeParticipantsTable,
  challengeMatchesTable,
  challengePrizesTable,
  pointsLedgerTable,
  rankingsTable,
  achievementsTable,
  userAchievementsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-challenge-delete-e2e/1.0";

const SECRET = process.env.CLERK_SECRET_KEY;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!SECRET) throw new Error("CLERK_SECRET_KEY is required");

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

// ---- Clerk admin REST helpers ----------------------------------------------

async function clerk<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(CLERK_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = text as unknown as T;
  }
  return { status: res.status, data };
}

async function createClerkUser(email: string): Promise<string> {
  const { status, data } = await clerk<{ id: string }>("POST", "/users", {
    email_address: [email],
    password: `Aa1!${email}${Date.now()}`,
    skip_password_checks: true,
    skip_legal_checks: true,
  });
  if (status >= 400) {
    throw new Error(`Clerk create user failed (${status}): ${JSON.stringify(data)}`);
  }
  return data.id;
}

async function mintSessionToken(clerkUserId: string): Promise<string> {
  const sess = await clerk<{ id: string }>("POST", "/sessions", {
    user_id: clerkUserId,
  });
  if (sess.status >= 400) {
    throw new Error(`Clerk create session failed (${sess.status}): ${JSON.stringify(sess.data)}`);
  }
  const tok = await clerk<{ jwt: string }>(
    "POST",
    `/sessions/${sess.data.id}/tokens`,
    {},
  );
  if (tok.status >= 400 || !tok.data.jwt) {
    throw new Error(`Clerk mint token failed (${tok.status}): ${JSON.stringify(tok.data)}`);
  }
  return tok.data.jwt;
}

async function deleteClerkUser(clerkUserId: string): Promise<void> {
  try {
    await clerk("DELETE", `/users/${clerkUserId}`);
  } catch (err) {
    console.warn(`Failed to delete Clerk user ${clerkUserId}:`, err);
  }
}

// ---- API request helper -----------------------------------------------------

let baseUrl = "";

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// Seed a fully-activated local user linked to a freshly created Clerk user.
async function seedActivatedUser(
  label: string,
  stamp: number,
): Promise<{ clerkId: string; userId: string; token: string }> {
  const email = `thaddi-cdel-e2e-${label}-${stamp}@example.com`;
  const clerkId = await createClerkUser(email);
  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: clerkId,
      email,
      emailVerified: true,
      mobileVerified: true,
      status: "active",
    })
    .returning();
  await db.insert(profilesTable).values({
    userId: row.id,
    displayName: `CDEL ${label} ${stamp}`,
    username: `cdel_${label}_${stamp}`,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, token };
}

// Count rows referencing a challenge id across every dependent table.
async function dependentRowCounts(challengeId: string) {
  const [participants, matches, prizes, ledger, ranks] = await Promise.all([
    db
      .select()
      .from(challengeParticipantsTable)
      .where(eq(challengeParticipantsTable.challengeId, challengeId)),
    db
      .select()
      .from(challengeMatchesTable)
      .where(eq(challengeMatchesTable.challengeId, challengeId)),
    db
      .select()
      .from(challengePrizesTable)
      .where(eq(challengePrizesTable.challengeId, challengeId)),
    db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.challengeId, challengeId)),
    db
      .select()
      .from(rankingsTable)
      .where(eq(rankingsTable.challengeId, challengeId)),
  ]);
  return {
    participants: participants.length,
    matches: matches.length,
    prizes: prizes.length,
    ledger: ledger.length,
    rankings: ranks.length,
  };
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();
  const hourMs = 60 * 60 * 1000;

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  const created: {
    clerkIds: string[];
    userIds: string[];
    tournamentId?: string;
    stageId?: string;
    teamId?: string;
    matchIds: string[];
    challengeIds: string[];
    achievementId?: string;
    userAchievementIds: string[];
  } = {
    clerkIds: [],
    userIds: [],
    matchIds: [],
    challengeIds: [],
    userAchievementIds: [],
  };

  try {
    // --- Seed users (owner + non-owner) ---
    const owner = await seedActivatedUser("owner", stamp);
    const stranger = await seedActivatedUser("stranger", stamp);
    for (const u of [owner, stranger]) {
      created.clerkIds.push(u.clerkId);
      created.userIds.push(u.userId);
    }

    // --- Shared football fixtures ---
    const [tournament] = await db
      .insert(tournamentsTable)
      .values({
        slug: `cdel-e2e-${stamp}`,
        nameEn: "Challenge Delete E2E Tournament",
        nameAr: "بطولة اختبار الحذف",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentId = tournament.id;

    const [stage] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournament.id,
        nameEn: "Challenge Delete E2E Stage",
        nameAr: "مرحلة اختبار الحذف",
        type: "group",
        orderIndex: 0,
      })
      .returning();
    created.stageId = stage.id;

    const [team] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Challenge Delete E2E Team",
        nameAr: "فريق اختبار الحذف",
        externalId: `cdel-e2e-team-${stamp}`,
      })
      .returning();
    created.teamId = team.id;

    const [match] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        kickoffAt: new Date(Date.now() - 2 * hourMs),
        status: "finished",
        externalId: `cdel-e2e-match-${stamp}`,
        venue: "E2E Delete Stadium",
      })
      .returning();
    created.matchIds.push(match.id);

    // A permanent achievement the owner will have "earned" inside the challenge.
    const [achievement] = await db
      .insert(achievementsTable)
      .values({
        code: `cdel-e2e-ach-${stamp}`,
        type: "hall_of_fame",
        nameEn: "Challenge Delete E2E Achievement",
        nameAr: "إنجاز اختبار الحذف",
      })
      .returning();
    created.achievementId = achievement.id;

    // ===================================================================
    // Build a fully-populated challenge with every dependent table filled.
    // ===================================================================
    console.log("\nSeeding a fully-populated challenge:");

    const [challenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Delete Challenge ${stamp}`,
        type: "friends",
        visibility: "public",
        scope: "custom",
        status: "active",
      })
      .returning();
    created.challengeIds.push(challenge.id);

    // Participants: owner + stranger both active members.
    await db.insert(challengeParticipantsTable).values([
      { challengeId: challenge.id, userId: owner.userId, status: "active" },
      { challengeId: challenge.id, userId: stranger.userId, status: "active" },
    ]);
    // Custom-scope match selection.
    await db.insert(challengeMatchesTable).values({
      challengeId: challenge.id,
      matchId: match.id,
    });
    // A custom prize tier.
    await db.insert(challengePrizesTable).values({
      challengeId: challenge.id,
      place: 1,
      titleEn: "Winner",
      titleAr: "الفائز",
    });
    // Points-ledger entries for both members.
    await db.insert(pointsLedgerTable).values([
      {
        challengeId: challenge.id,
        userId: owner.userId,
        matchId: match.id,
        points: 5,
        reason: "exact_score",
      },
      {
        challengeId: challenge.id,
        userId: stranger.userId,
        matchId: match.id,
        points: 2,
        reason: "correct_outcome",
      },
    ]);
    // Ranking snapshot rows scoped to the challenge.
    await db.insert(rankingsTable).values([
      {
        scope: "challenge",
        challengeId: challenge.id,
        userId: owner.userId,
        rank: 1,
        points: 5,
      },
      {
        scope: "challenge",
        challengeId: challenge.id,
        userId: stranger.userId,
        rank: 2,
        points: 2,
      },
    ]);
    // The owner earned the achievement *in this challenge*.
    const [userAchievement] = await db
      .insert(userAchievementsTable)
      .values({
        userId: owner.userId,
        achievementId: achievement.id,
        challengeId: challenge.id,
      })
      .returning();
    created.userAchievementIds.push(userAchievement.id);

    const seeded = await dependentRowCounts(challenge.id);
    check(
      "fixture: all dependent tables are populated before delete",
      seeded.participants === 2 &&
        seeded.matches === 1 &&
        seeded.prizes === 1 &&
        seeded.ledger === 2 &&
        seeded.rankings === 2,
      JSON.stringify(seeded),
    );

    // ===================================================================
    // Test 1: a non-owner can never delete someone else's challenge.
    // ===================================================================
    console.log("\nAuthorization (non-owner cannot delete):");

    const strangerDelete = await api("DELETE", `/challenges/${challenge.id}`, {
      token: stranger.token,
    });
    check(
      "non-owner delete is rejected (403)",
      strangerDelete.status === 403,
      `got ${strangerDelete.status}: ${JSON.stringify(strangerDelete.data).slice(0, 160)}`,
    );

    const stillThere = await db.query.challengesTable.findFirst({
      where: eq(challengesTable.id, challenge.id),
    });
    check(
      "rejected non-owner delete leaves the challenge intact",
      !!stillThere,
      `challenge ${stillThere ? "exists" : "missing"}`,
    );

    const afterRejected = await dependentRowCounts(challenge.id);
    check(
      "rejected non-owner delete leaves every dependent row intact",
      afterRejected.participants === 2 &&
        afterRejected.matches === 1 &&
        afterRejected.prizes === 1 &&
        afterRejected.ledger === 2 &&
        afterRejected.rankings === 2,
      JSON.stringify(afterRejected),
    );

    // ===================================================================
    // Test 2: deleting a non-existent challenge is a 404.
    // ===================================================================
    console.log("\nMissing challenge:");

    const missing = await api("DELETE", `/challenges/${randomUUID()}`, {
      token: owner.token,
    });
    check(
      "deleting a non-existent challenge returns 404",
      missing.status === 404,
      `got ${missing.status}: ${JSON.stringify(missing.data).slice(0, 160)}`,
    );

    // ===================================================================
    // Test 3: the owner deletes and everything dependent is cleaned up.
    // ===================================================================
    console.log("\nOwner delete + cascade cleanup:");

    const ownerDelete = await api("DELETE", `/challenges/${challenge.id}`, {
      token: owner.token,
    });
    check(
      "owner delete succeeds (200)",
      ownerDelete.status === 200 && ownerDelete.data?.success === true,
      `got ${ownerDelete.status}: ${JSON.stringify(ownerDelete.data).slice(0, 160)}`,
    );

    const gone = await db.query.challengesTable.findFirst({
      where: eq(challengesTable.id, challenge.id),
    });
    check("challenge row is gone after owner delete", !gone, `challenge ${gone ? "still exists" : "deleted"}`);

    const afterDelete = await dependentRowCounts(challenge.id);
    check(
      "no challenge_participants rows remain",
      afterDelete.participants === 0,
      `participants=${afterDelete.participants}`,
    );
    check(
      "no challenge_matches rows remain",
      afterDelete.matches === 0,
      `matches=${afterDelete.matches}`,
    );
    check(
      "no challenge_prizes rows remain",
      afterDelete.prizes === 0,
      `prizes=${afterDelete.prizes}`,
    );
    check(
      "no points_ledger rows remain",
      afterDelete.ledger === 0,
      `ledger=${afterDelete.ledger}`,
    );
    check(
      "no rankings rows remain",
      afterDelete.rankings === 0,
      `rankings=${afterDelete.rankings}`,
    );

    // ===================================================================
    // Test 4: the earned achievement is preserved, just unlinked.
    // ===================================================================
    console.log("\nAchievement preservation (challengeId nulled, not deleted):");

    const preservedAch = await db
      .select()
      .from(userAchievementsTable)
      .where(eq(userAchievementsTable.id, userAchievement.id));
    check(
      "user_achievements row survives the delete",
      preservedAch.length === 1,
      `rows=${preservedAch.length}`,
    );
    check(
      "user_achievements challengeId is nulled (not left dangling)",
      preservedAch.length === 1 && preservedAch[0].challengeId === null,
      `challengeId=${preservedAch[0]?.challengeId}`,
    );
    // Belt-and-braces: no user_achievements row anywhere still points at the
    // deleted challenge id.
    const danglingAch = await db
      .select()
      .from(userAchievementsTable)
      .where(eq(userAchievementsTable.challengeId, challenge.id));
    check(
      "no user_achievements row still references the deleted challenge",
      danglingAch.length === 0,
      `dangling=${danglingAch.length}`,
    );
  } finally {
    // --- Teardown: revert everything we created (child -> parent) ---
    console.log("\nTeardown:");
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`  teardown ${label} failed:`, err);
      }
    };

    // user_achievements survive the challenge delete (challengeId nulled), so
    // remove them explicitly by id.
    if (created.userAchievementIds.length) {
      await safe("user_achievements", () =>
        db
          .delete(userAchievementsTable)
          .where(inArray(userAchievementsTable.id, created.userAchievementIds)),
      );
    }
    // Any challenge that was NOT deleted by the test (defensive) cascades to its
    // participants / matches / prizes / ledger / rankings.
    if (created.challengeIds.length) {
      await safe("challenges", () =>
        db
          .delete(challengesTable)
          .where(inArray(challengesTable.id, created.challengeIds)),
      );
    }
    if (created.achievementId) {
      await safe("achievement", () =>
        db
          .delete(achievementsTable)
          .where(eq(achievementsTable.id, created.achievementId!)),
      );
    }
    if (created.matchIds.length) {
      await safe("matches", () =>
        db.delete(matchesTable).where(inArray(matchesTable.id, created.matchIds)),
      );
    }
    if (created.stageId) {
      await safe("stage", () =>
        db.delete(stagesTable).where(eq(stagesTable.id, created.stageId!)),
      );
    }
    if (created.teamId) {
      await safe("team", () =>
        db.delete(teamsTable).where(eq(teamsTable.id, created.teamId!)),
      );
    }
    if (created.tournamentId) {
      await safe("tournament", () =>
        db
          .delete(tournamentsTable)
          .where(eq(tournamentsTable.id, created.tournamentId!)),
      );
    }
    if (created.userIds.length) {
      await safe("profiles", () =>
        db
          .delete(profilesTable)
          .where(inArray(profilesTable.userId, created.userIds)),
      );
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, created.userIds)),
      );
    }
    for (const id of created.clerkIds) await deleteClerkUser(id);

    await safe("server close", () => new Promise((r) => server.close(() => r(null))));
    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Challenge-delete regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Challenge-delete regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Challenge-delete regression crashed:", err);
    process.exit(1);
  });
