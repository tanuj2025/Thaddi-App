/**
 * Player-flow security regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * the player-facing flows that carry real abuse / privacy risk:
 *
 *   1. Challenge-scoped match access: a viewer permitted to see a challenge
 *      cannot read predictions for a match OUTSIDE the challenge's scope
 *      (`GET /challenges/:id/matches/:matchId` must 404 for an out-of-scope
 *      match), while an in-scope match resolves and reveals participant picks.
 *   2. Prediction privacy: `/matches/:id/comparison` withholds all scorelines
 *      until the prediction lock (revealed=false, scorelines=[] before lock;
 *      populated after), and `/matches/:id/trends` only ever exposes aggregate
 *      outcome percentages — never individual scorelines.
 *   3. Atomic participant-limit enforcement on join: two concurrent joins for a
 *      single remaining slot result in exactly one success + one 409, the limit
 *      is never exceeded, and a subsequent join is rejected once full.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `adminPanel.e2e.ts`).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { and, eq, inArray } from "drizzle-orm";
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
  predictionsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-player-e2e/1.0";

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

// Seed a fully-activated local user (email + mobile verified + complete
// profile) linked to a freshly created Clerk user. Returns ids + token.
async function seedActivatedUser(
  label: string,
  stamp: number,
): Promise<{ clerkId: string; userId: string; token: string }> {
  const email = `thaddi-player-e2e-${label}-${stamp}@example.com`;
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
    displayName: `E2E ${label} ${stamp}`,
    username: `e2e_${label}_${stamp}`,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, token };
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
  } = { clerkIds: [], userIds: [], matchIds: [], challengeIds: [] };

  try {
    // --- Seed users (owner + viewer + two joiners) ---
    const owner = await seedActivatedUser("owner", stamp);
    const viewer = await seedActivatedUser("viewer", stamp);
    const joiner1 = await seedActivatedUser("joiner1", stamp);
    const joiner2 = await seedActivatedUser("joiner2", stamp);
    for (const u of [owner, viewer, joiner1, joiner2]) {
      created.clerkIds.push(u.clerkId);
      created.userIds.push(u.userId);
    }

    // --- Shared football fixtures ---
    const [tournament] = await db
      .insert(tournamentsTable)
      .values({
        slug: `player-e2e-${stamp}`,
        nameEn: "Player E2E Tournament",
        nameAr: "بطولة اختبار اللاعب",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentId = tournament.id;

    const [stage] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournament.id,
        nameEn: "Player E2E Stage",
        nameAr: "مرحلة اختبار",
        type: "group",
        orderIndex: 0,
      })
      .returning();
    created.stageId = stage.id;

    const [team] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Player E2E Team",
        nameAr: "فريق اختبار",
        externalId: `player-e2e-team-${stamp}`,
      })
      .returning();
    created.teamId = team.id;

    // A match that has already kicked off (locked) and one still in the future
    // (unlocked). predictionLockAt left null so the kickoff time is the lock
    // boundary.
    const [lockedMatch] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        kickoffAt: new Date(Date.now() - 2 * hourMs),
        status: "live",
        externalId: `player-e2e-locked-${stamp}`,
        venue: "E2E Stadium A",
      })
      .returning();
    created.matchIds.push(lockedMatch.id);

    const [unlockedMatch] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        kickoffAt: new Date(Date.now() + 7 * 24 * hourMs),
        status: "scheduled",
        externalId: `player-e2e-unlocked-${stamp}`,
        venue: "E2E Stadium B",
      })
      .returning();
    created.matchIds.push(unlockedMatch.id);

    // A match that belongs to NO challenge in scope (used for the scope-bypass
    // probe). Kicked off, with a participant's prediction on it.
    const [outOfScopeMatch] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        kickoffAt: new Date(Date.now() - 3 * hourMs),
        status: "live",
        externalId: `player-e2e-oos-${stamp}`,
        venue: "E2E Stadium C",
      })
      .returning();
    created.matchIds.push(outOfScopeMatch.id);

    // Seed predictions from all four users on the locked + out-of-scope matches
    // so there is something that *would* be revealed if access checks failed.
    const allUsers = [owner, viewer, joiner1, joiner2];
    const predRows: {
      userId: string;
      matchId: string;
      homeScore: number;
      awayScore: number;
    }[] = [];
    allUsers.forEach((u, i) => {
      predRows.push({ userId: u.userId, matchId: lockedMatch.id, homeScore: i % 3, awayScore: (i + 1) % 3 });
      predRows.push({ userId: u.userId, matchId: outOfScopeMatch.id, homeScore: 2, awayScore: 1 });
      predRows.push({ userId: u.userId, matchId: unlockedMatch.id, homeScore: i % 2, awayScore: i % 3 });
    });
    await db.insert(predictionsTable).values(predRows);

    // ===================================================================
    // Test 1: challenge-scoped match access (scope bypass / prediction leak)
    // ===================================================================
    console.log("\nChallenge-scoped match access:");

    // Public challenge (so the viewer passes the visibility check) whose CUSTOM
    // scope contains ONLY lockedMatch — not outOfScopeMatch.
    const [scopedChallenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Scoped Challenge ${stamp}`,
        type: "friends",
        visibility: "public",
        scope: "custom",
        status: "active",
        predictionVisibility: "reveal_after_kickoff",
      })
      .returning();
    created.challengeIds.push(scopedChallenge.id);
    await db.insert(challengeMatchesTable).values({
      challengeId: scopedChallenge.id,
      matchId: lockedMatch.id,
    });
    // Owner is a participant (their prediction is the one that would leak).
    await db.insert(challengeParticipantsTable).values({
      challengeId: scopedChallenge.id,
      userId: owner.userId,
      status: "active",
    });

    // The viewer can see the challenge (public) but is NOT a participant.
    const inScope = await api(
      "GET",
      `/challenges/${scopedChallenge.id}/matches/${lockedMatch.id}`,
      { token: viewer.token },
    );
    check(
      "in-scope match resolves (200)",
      inScope.status === 200,
      `got ${inScope.status}: ${JSON.stringify(inScope.data).slice(0, 160)}`,
    );
    check(
      "in-scope match reveals participant predictions after kickoff",
      inScope.status === 200 &&
        inScope.data.revealed === true &&
        Array.isArray(inScope.data.participantPredictions) &&
        inScope.data.participantPredictions.some(
          (p: any) => p.userId === owner.userId,
        ),
      `revealed=${inScope.data?.revealed} count=${inScope.data?.participantPredictions?.length}`,
    );

    const outScope = await api(
      "GET",
      `/challenges/${scopedChallenge.id}/matches/${outOfScopeMatch.id}`,
      { token: viewer.token },
    );
    check(
      "out-of-scope match is rejected (404)",
      outScope.status === 404,
      `got ${outScope.status}: ${JSON.stringify(outScope.data).slice(0, 160)}`,
    );
    check(
      "out-of-scope response leaks no participant predictions",
      !Array.isArray(outScope.data?.participantPredictions) ||
        outScope.data.participantPredictions.length === 0,
      `participantPredictions=${JSON.stringify(outScope.data?.participantPredictions)}`,
    );

    // ===================================================================
    // Test 2: prediction privacy (comparison gated by lock, trends aggregate)
    // ===================================================================
    console.log("\nPrediction privacy:");

    const lockedComparison = await api(
      "GET",
      `/matches/${lockedMatch.id}/comparison`,
      { token: viewer.token },
    );
    check(
      "comparison reveals scorelines after lock",
      lockedComparison.status === 200 &&
        lockedComparison.data.revealed === true &&
        Array.isArray(lockedComparison.data.scorelines) &&
        lockedComparison.data.scorelines.length > 0,
      `revealed=${lockedComparison.data?.revealed} scorelines=${lockedComparison.data?.scorelines?.length}`,
    );

    const unlockedComparison = await api(
      "GET",
      `/matches/${unlockedMatch.id}/comparison`,
      { token: viewer.token },
    );
    check(
      "comparison withholds scorelines before lock",
      unlockedComparison.status === 200 &&
        unlockedComparison.data.revealed === false &&
        Array.isArray(unlockedComparison.data.scorelines) &&
        unlockedComparison.data.scorelines.length === 0,
      `revealed=${unlockedComparison.data?.revealed} scorelines=${JSON.stringify(unlockedComparison.data?.scorelines)}`,
    );

    const unlockedTrends = await api(
      "GET",
      `/matches/${unlockedMatch.id}/trends`,
      { token: viewer.token },
    );
    check(
      "trends returns aggregate outcome percentages",
      unlockedTrends.status === 200 &&
        typeof unlockedTrends.data.homeWinPct === "number" &&
        typeof unlockedTrends.data.drawPct === "number" &&
        typeof unlockedTrends.data.awayWinPct === "number" &&
        typeof unlockedTrends.data.total === "number",
      JSON.stringify(unlockedTrends.data).slice(0, 200),
    );
    check(
      "trends never exposes individual scorelines (even before lock)",
      unlockedTrends.status === 200 &&
        !("scorelines" in (unlockedTrends.data ?? {})),
      `keys=${Object.keys(unlockedTrends.data ?? {}).join(",")}`,
    );

    // ===================================================================
    // Test 3: atomic participant-limit enforcement on join
    // ===================================================================
    console.log("\nParticipant-limit enforcement on join:");

    // Public challenge, limit 2, owner already occupies the single first slot,
    // leaving exactly ONE slot open.
    const [limitChallenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Limit Challenge ${stamp}`,
        type: "friends",
        visibility: "public",
        scope: "entire_tournament",
        status: "active",
        participantLimit: 2,
      })
      .returning();
    created.challengeIds.push(limitChallenge.id);
    await db.insert(challengeParticipantsTable).values({
      challengeId: limitChallenge.id,
      userId: owner.userId,
      status: "active",
    });

    // Two activated users race for the one open slot.
    const [r1, r2] = await Promise.all([
      api("POST", `/challenges/${limitChallenge.id}/join`, {
        token: joiner1.token,
        body: {},
      }),
      api("POST", `/challenges/${limitChallenge.id}/join`, {
        token: joiner2.token,
        body: {},
      }),
    ]);
    const successes = [r1, r2].filter((r) => r.status === 200).length;
    const conflicts = [r1, r2].filter((r) => r.status === 409).length;
    check(
      "concurrent joins: exactly one succeeds",
      successes === 1,
      `statuses=${r1.status},${r2.status}`,
    );
    check(
      "concurrent joins: the other is rejected with 409",
      conflicts === 1,
      `statuses=${r1.status},${r2.status}`,
    );

    const activeAfter = await db
      .select()
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, limitChallenge.id),
          eq(challengeParticipantsTable.status, "active"),
        ),
      );
    check(
      "participant limit is never exceeded",
      activeAfter.length === 2,
      `active=${activeAfter.length}`,
    );

    // The loser retrying is still rejected once the challenge is full.
    const loser = r1.status === 409 ? joiner1 : joiner2;
    const retry = await api(
      "POST",
      `/challenges/${limitChallenge.id}/join`,
      { token: loser.token, body: {} },
    );
    check(
      "join is rejected once the challenge is full (409)",
      retry.status === 409,
      `got ${retry.status}: ${JSON.stringify(retry.data).slice(0, 160)}`,
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

    // Challenges cascade to participants + challenge_matches.
    if (created.challengeIds.length) {
      await safe("challenges", () =>
        db
          .delete(challengesTable)
          .where(inArray(challengesTable.id, created.challengeIds)),
      );
    }
    // Predictions reference matches/users with cascade, but delete explicitly
    // first to keep teardown order obvious.
    if (created.matchIds.length) {
      await safe("predictions", () =>
        db
          .delete(predictionsTable)
          .where(inArray(predictionsTable.matchId, created.matchIds)),
      );
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
    console.log(`Player-flow regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Player-flow regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Player-flow regression crashed:", err);
    process.exit(1);
  });
