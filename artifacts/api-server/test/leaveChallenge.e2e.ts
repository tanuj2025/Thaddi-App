/**
 * Challenge self-removal (leave) authorization + cleanup regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * every branch of the participant self-removal endpoint
 * `POST /challenges/:id/leave`:
 *
 *   1. Unauthenticated: a request with no bearer token -> 401, and the leaver's
 *      participation + dependent rows stay intact.
 *   2. Non-member: a user who never joined (or already left) -> 404.
 *   3. Owner: the challenge owner can never leave their own challenge -> 403,
 *      and their participation stays intact.
 *   4. Happy path: a non-owner active participant leaves -> 200, and their
 *      challenge_participants, points_ledger, rankings, and user_achievements
 *      rows for THAT challenge are all gone — while the owner's equivalent rows
 *      (and another member's) are left untouched.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `challengeDelete.e2e.ts` / `playerFlows.e2e.ts`). It does not
 * depend on live football sync.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { and, eq, inArray } from "drizzle-orm";
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
  pointsLedgerTable,
  rankingsTable,
  achievementsTable,
  userAchievementsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-leave-challenge-e2e/1.0";

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
  const email = `thaddi-leave-e2e-${label}-${stamp}@example.com`;
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
    displayName: `LEAVE ${label} ${stamp}`,
    username: `leave_${label}_${stamp}`,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, token };
}

// Count the challenge-scoped rows that the leave endpoint should remove for a
// given user.
async function userChallengeRowCounts(challengeId: string, userId: string) {
  const [participant, ledger, ranks, achievements] = await Promise.all([
    db
      .select()
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, challengeId),
          eq(challengeParticipantsTable.userId, userId),
        ),
      ),
    db
      .select()
      .from(pointsLedgerTable)
      .where(
        and(
          eq(pointsLedgerTable.challengeId, challengeId),
          eq(pointsLedgerTable.userId, userId),
        ),
      ),
    db
      .select()
      .from(rankingsTable)
      .where(
        and(
          eq(rankingsTable.challengeId, challengeId),
          eq(rankingsTable.userId, userId),
        ),
      ),
    db
      .select()
      .from(userAchievementsTable)
      .where(
        and(
          eq(userAchievementsTable.challengeId, challengeId),
          eq(userAchievementsTable.userId, userId),
        ),
      ),
  ]);
  return {
    participant: participant.length,
    ledger: ledger.length,
    rankings: ranks.length,
    achievements: achievements.length,
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
    // --- Seed users (owner + leaver + bystander + outsider) ---
    const owner = await seedActivatedUser("owner", stamp);
    const leaver = await seedActivatedUser("leaver", stamp);
    const bystander = await seedActivatedUser("bystander", stamp);
    const outsider = await seedActivatedUser("outsider", stamp);
    for (const u of [owner, leaver, bystander, outsider]) {
      created.clerkIds.push(u.clerkId);
      created.userIds.push(u.userId);
    }

    // --- Shared football fixtures ---
    const [tournament] = await db
      .insert(tournamentsTable)
      .values({
        slug: `leave-e2e-${stamp}`,
        nameEn: "Leave Challenge E2E Tournament",
        nameAr: "بطولة اختبار المغادرة",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentId = tournament.id;

    const [stage] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournament.id,
        nameEn: "Leave Challenge E2E Stage",
        nameAr: "مرحلة اختبار المغادرة",
        type: "group",
        orderIndex: 0,
      })
      .returning();
    created.stageId = stage.id;

    const [team] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Leave Challenge E2E Team",
        nameAr: "فريق اختبار المغادرة",
        externalId: `leave-e2e-team-${stamp}`,
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
        externalId: `leave-e2e-match-${stamp}`,
        venue: "E2E Leave Stadium",
      })
      .returning();
    created.matchIds.push(match.id);

    // A permanent achievement both the owner and leaver "earned" in the
    // challenge — used to prove the leaver's is removed while the owner's stays.
    const [achievement] = await db
      .insert(achievementsTable)
      .values({
        code: `leave-e2e-ach-${stamp}`,
        type: "hall_of_fame",
        nameEn: "Leave Challenge E2E Achievement",
        nameAr: "إنجاز اختبار المغادرة",
      })
      .returning();
    created.achievementId = achievement.id;

    // ===================================================================
    // Build a challenge with owner + leaver + bystander all active, each with
    // ledger / rankings / achievement rows.
    // ===================================================================
    console.log("\nSeeding a populated challenge (owner + leaver + bystander):");

    const [challenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Leave Challenge ${stamp}`,
        type: "friends",
        visibility: "public",
        scope: "custom",
        status: "active",
      })
      .returning();
    created.challengeIds.push(challenge.id);

    await db.insert(challengeParticipantsTable).values([
      { challengeId: challenge.id, userId: owner.userId, status: "active" },
      { challengeId: challenge.id, userId: leaver.userId, status: "active" },
      { challengeId: challenge.id, userId: bystander.userId, status: "active" },
    ]);
    await db.insert(challengeMatchesTable).values({
      challengeId: challenge.id,
      matchId: match.id,
    });
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
        userId: leaver.userId,
        matchId: match.id,
        points: 3,
        reason: "correct_outcome",
      },
      {
        challengeId: challenge.id,
        userId: bystander.userId,
        matchId: match.id,
        points: 2,
        reason: "correct_outcome",
      },
    ]);
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
        userId: leaver.userId,
        rank: 2,
        points: 3,
      },
      {
        scope: "challenge",
        challengeId: challenge.id,
        userId: bystander.userId,
        rank: 3,
        points: 2,
      },
    ]);
    const ownerAch = await db
      .insert(userAchievementsTable)
      .values({
        userId: owner.userId,
        achievementId: achievement.id,
        challengeId: challenge.id,
      })
      .returning();
    const leaverAch = await db
      .insert(userAchievementsTable)
      .values({
        userId: leaver.userId,
        achievementId: achievement.id,
        challengeId: challenge.id,
      })
      .returning();
    created.userAchievementIds.push(ownerAch[0].id, leaverAch[0].id);

    const seededLeaver = await userChallengeRowCounts(challenge.id, leaver.userId);
    check(
      "fixture: leaver has participant + ledger + ranking + achievement rows",
      seededLeaver.participant === 1 &&
        seededLeaver.ledger === 1 &&
        seededLeaver.rankings === 1 &&
        seededLeaver.achievements === 1,
      JSON.stringify(seededLeaver),
    );

    // ===================================================================
    // Test 1: unauthenticated request is rejected (401), nothing removed.
    // ===================================================================
    console.log("\nUnauthenticated leave:");

    const anon = await api("POST", `/challenges/${challenge.id}/leave`);
    check(
      "unauthenticated leave is rejected (401)",
      anon.status === 401,
      `got ${anon.status}: ${JSON.stringify(anon.data).slice(0, 160)}`,
    );
    const afterAnon = await userChallengeRowCounts(challenge.id, leaver.userId);
    check(
      "unauthenticated leave leaves the participant's rows intact",
      afterAnon.participant === 1 &&
        afterAnon.ledger === 1 &&
        afterAnon.rankings === 1 &&
        afterAnon.achievements === 1,
      JSON.stringify(afterAnon),
    );

    // ===================================================================
    // Test 2: a user who never joined gets 404.
    // ===================================================================
    console.log("\nNon-member leave:");

    const outsiderLeave = await api(
      "POST",
      `/challenges/${challenge.id}/leave`,
      { token: outsider.token },
    );
    check(
      "non-member leave returns 404",
      outsiderLeave.status === 404,
      `got ${outsiderLeave.status}: ${JSON.stringify(outsiderLeave.data).slice(0, 160)}`,
    );

    // Leaving a challenge that does not exist is also a 404.
    const missingLeave = await api(
      "POST",
      `/challenges/${randomUUID()}/leave`,
      { token: leaver.token },
    );
    check(
      "leaving a non-existent challenge returns 404",
      missingLeave.status === 404,
      `got ${missingLeave.status}: ${JSON.stringify(missingLeave.data).slice(0, 160)}`,
    );

    // ===================================================================
    // Test 3: the owner can never leave their own challenge (403), intact.
    // ===================================================================
    console.log("\nOwner cannot leave:");

    const ownerLeave = await api(
      "POST",
      `/challenges/${challenge.id}/leave`,
      { token: owner.token },
    );
    check(
      "owner leave is rejected (403)",
      ownerLeave.status === 403,
      `got ${ownerLeave.status}: ${JSON.stringify(ownerLeave.data).slice(0, 160)}`,
    );
    const afterOwnerLeave = await userChallengeRowCounts(
      challenge.id,
      owner.userId,
    );
    check(
      "rejected owner leave leaves the owner's rows intact",
      afterOwnerLeave.participant === 1 &&
        afterOwnerLeave.ledger === 1 &&
        afterOwnerLeave.rankings === 1 &&
        afterOwnerLeave.achievements === 1,
      JSON.stringify(afterOwnerLeave),
    );

    // ===================================================================
    // Test 4: a non-owner active participant leaves -> 200 + full cleanup.
    // ===================================================================
    console.log("\nHappy path (non-owner participant leaves):");

    const leave = await api("POST", `/challenges/${challenge.id}/leave`, {
      token: leaver.token,
    });
    check(
      "non-owner participant leave succeeds (200)",
      leave.status === 200 && leave.data?.success === true,
      `got ${leave.status}: ${JSON.stringify(leave.data).slice(0, 160)}`,
    );

    const afterLeave = await userChallengeRowCounts(challenge.id, leaver.userId);
    check(
      "leaver's challenge_participants row is gone",
      afterLeave.participant === 0,
      `participant=${afterLeave.participant}`,
    );
    check(
      "leaver's points_ledger rows are gone",
      afterLeave.ledger === 0,
      `ledger=${afterLeave.ledger}`,
    );
    check(
      "leaver's rankings rows are gone",
      afterLeave.rankings === 0,
      `rankings=${afterLeave.rankings}`,
    );
    check(
      "leaver's user_achievements rows for this challenge are gone",
      afterLeave.achievements === 0,
      `achievements=${afterLeave.achievements}`,
    );

    // The owner and the bystander must be completely untouched.
    const ownerAfter = await userChallengeRowCounts(challenge.id, owner.userId);
    check(
      "owner's rows are untouched after another member leaves",
      ownerAfter.participant === 1 &&
        ownerAfter.ledger === 1 &&
        ownerAfter.rankings === 1 &&
        ownerAfter.achievements === 1,
      JSON.stringify(ownerAfter),
    );
    const bystanderAfter = await userChallengeRowCounts(
      challenge.id,
      bystander.userId,
    );
    check(
      "bystander's rows are untouched after another member leaves",
      bystanderAfter.participant === 1 &&
        bystanderAfter.ledger === 1 &&
        bystanderAfter.rankings === 1 &&
        bystanderAfter.achievements === 0,
      JSON.stringify(bystanderAfter),
    );

    // ===================================================================
    // Test 5: leaving again (now a non-member) is a 404.
    // ===================================================================
    console.log("\nLeaving twice:");

    const leaveAgain = await api(
      "POST",
      `/challenges/${challenge.id}/leave`,
      { token: leaver.token },
    );
    check(
      "leaving again after already leaving returns 404",
      leaveAgain.status === 404,
      `got ${leaveAgain.status}: ${JSON.stringify(leaveAgain.data).slice(0, 160)}`,
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

    // Remove any surviving user_achievements by id (the leaver's is deleted by
    // the test, the owner's survives).
    if (created.userAchievementIds.length) {
      await safe("user_achievements", () =>
        db
          .delete(userAchievementsTable)
          .where(inArray(userAchievementsTable.id, created.userAchievementIds)),
      );
    }
    // Deleting the challenge cascades to participants / matches / ledger /
    // rankings.
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
    console.log(`Leave-challenge regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Leave-challenge regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Leave-challenge regression crashed:", err);
    process.exit(1);
  });
