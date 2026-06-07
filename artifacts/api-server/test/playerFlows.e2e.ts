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
 *   4. Private-challenge invite-code gate on join: a non-owner is rejected (403)
 *      with no code and with a wrong code, accepted when the correct code is
 *      submitted in lowercase (proving the `.trim().toUpperCase()` normalization
 *      so invite-link codes still match), and the owner may join without a code.
 *   5. Public invite preview (`GET /invite/:code`): a valid code resolves
 *      case-insensitively, an unknown code 404s, and the public payload never
 *      leaks sensitive challenge internals.
 *   6. Full / non-active invite links: the preview of a challenge at its
 *      participant limit reports `isFull: true` (while still `active`) and
 *      joining it with a valid code is rejected (409); the preview of a
 *      non-active (e.g. completed) challenge reflects its `status` and joining
 *      it with a valid code is likewise rejected (409). Neither rejected join
 *      leaves a participant row behind.
 *   7. Discover invite-code privacy: `GET /challenges/discover` lists both
 *      active public AND active private challenges, but the private `inviteCode`
 *      is null for a viewer who is neither the owner nor an active member, and
 *      is revealed only to the owner and to active members — private codes must
 *      never leak through Discover.
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
  plansTable,
  subscriptionsTable,
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
    planIds: string[];
    subscriptionIds: string[];
  } = {
    clerkIds: [],
    userIds: [],
    matchIds: [],
    challengeIds: [],
    planIds: [],
    subscriptionIds: [],
  };

  // Give a user a dedicated custom plan with a fixed participant pool and an
  // active subscription, so the OWNER's shared participant pool (now the unit of
  // enforcement) is fully controlled for capacity tests.
  const assignCustomPlan = async (
    userId: string,
    code: string,
    participantLimit: number,
  ): Promise<void> => {
    const [plan] = await db
      .insert(plansTable)
      .values({
        code,
        nameEn: `E2E Plan ${code}`,
        nameAr: `باقة اختبار ${code}`,
        participantLimit,
      })
      .returning();
    created.planIds.push(plan.id);
    const [subRow] = await db
      .insert(subscriptionsTable)
      .values({ userId, planId: plan.id, status: "active" })
      .returning();
    created.subscriptionIds.push(subRow.id);
  };

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

    // A dedicated owner whose plan pool is exactly 2: the owner's own seat in
    // the challenge consumes one, leaving exactly ONE shared slot open. The
    // limit is now the OWNER's plan pool (shared across all their challenges),
    // not a per-challenge cap, so we control it via a custom plan + active sub.
    const limitOwner = await seedActivatedUser("limitowner", stamp);
    created.clerkIds.push(limitOwner.clerkId);
    created.userIds.push(limitOwner.userId);
    await assignCustomPlan(limitOwner.userId, `e2e-pool2-${stamp}`, 2);

    const [limitChallenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: limitOwner.userId,
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
      userId: limitOwner.userId,
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

    // ===================================================================
    // Test 4: private-challenge invite-code gate on join
    // ===================================================================
    console.log("\nPrivate-challenge invite-code gate:");

    // Invite codes are stored uppercase (see lib/invite.ts). The join handler
    // normalizes submitted codes with `.trim().toUpperCase()` so an invite-link
    // code typed/pasted in lowercase still matches.
    const inviteCode = `PRV${stamp}`.toUpperCase();
    const [privateChallenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Private Challenge ${stamp}`,
        type: "friends",
        visibility: "private",
        scope: "entire_tournament",
        status: "active",
        inviteCode,
        inviteLink: `/join/${inviteCode}`,
      })
      .returning();
    created.challengeIds.push(privateChallenge.id);
    // Owner is the first participant (matches the create flow).
    await db.insert(challengeParticipantsTable).values({
      challengeId: privateChallenge.id,
      userId: owner.userId,
      status: "active",
    });

    // A non-owner with no code is locked out.
    const noCode = await api(
      "POST",
      `/challenges/${privateChallenge.id}/join`,
      { token: viewer.token, body: {} },
    );
    check(
      "private join with no code is rejected (403)",
      noCode.status === 403,
      `got ${noCode.status}: ${JSON.stringify(noCode.data).slice(0, 160)}`,
    );

    // A non-owner with the wrong code is locked out.
    const wrongCode = await api(
      "POST",
      `/challenges/${privateChallenge.id}/join`,
      { token: viewer.token, body: { viaCode: "WRONGCODE" } },
    );
    check(
      "private join with wrong code is rejected (403)",
      wrongCode.status === 403,
      `got ${wrongCode.status}: ${JSON.stringify(wrongCode.data).slice(0, 160)}`,
    );

    // Confirm the failed attempts left no participant row behind.
    const beforeJoin = await db
      .select()
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, privateChallenge.id),
          eq(challengeParticipantsTable.userId, viewer.userId),
        ),
      );
    check(
      "rejected private joins create no participant row",
      beforeJoin.length === 0,
      `rows=${beforeJoin.length}`,
    );

    // The correct code, submitted in lowercase, is accepted (normalization).
    const lowerCode = await api(
      "POST",
      `/challenges/${privateChallenge.id}/join`,
      { token: viewer.token, body: { viaCode: inviteCode.toLowerCase() } },
    );
    check(
      "private join with correct lowercase code is accepted (200)",
      lowerCode.status === 200 && lowerCode.data?.success === true,
      `got ${lowerCode.status}: ${JSON.stringify(lowerCode.data).slice(0, 160)}`,
    );

    const afterJoin = await db
      .select()
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, privateChallenge.id),
          eq(challengeParticipantsTable.userId, viewer.userId),
          eq(challengeParticipantsTable.status, "active"),
        ),
      );
    check(
      "lowercase invite code creates an active participant",
      afterJoin.length === 1,
      `rows=${afterJoin.length}`,
    );

    // The owner may join/preview without a code (idempotent success).
    const ownerJoin = await api(
      "POST",
      `/challenges/${privateChallenge.id}/join`,
      { token: owner.token, body: {} },
    );
    check(
      "owner joins private challenge without a code (200)",
      ownerJoin.status === 200 && ownerJoin.data?.success === true,
      `got ${ownerJoin.status}: ${JSON.stringify(ownerJoin.data).slice(0, 160)}`,
    );

    // ===================================================================
    // Test 5: public invite preview (what a recipient hits opening a link)
    // ===================================================================
    console.log("\nPublic invite preview (GET /invite/:code):");

    // The recipient opens the shared link unauthenticated. The code is matched
    // case-insensitively (endpoint upper-cases the param), so a code pasted in
    // lowercase still resolves to the right challenge.
    const preview = await api(
      "GET",
      `/invite/${inviteCode.toLowerCase()}`,
    );
    check(
      "valid invite code returns the preview (200, case-insensitive)",
      preview.status === 200 &&
        preview.data?.id === privateChallenge.id &&
        preview.data?.name === privateChallenge.name,
      `got ${preview.status}: ${JSON.stringify(preview.data).slice(0, 200)}`,
    );

    // An unknown code must not resolve to anything.
    const unknown = await api(
      "GET",
      `/invite/NOSUCHCODE${stamp}`,
    );
    check(
      "unknown invite code is not found (404)",
      unknown.status === 404,
      `got ${unknown.status}: ${JSON.stringify(unknown.data).slice(0, 160)}`,
    );

    // The preview is public, so it must never leak private challenge internals
    // (the invite code/link itself, owner id, visibility/scope config, raw
    // prediction-visibility) to an unauthenticated caller.
    const leakedKeys = [
      "inviteCode",
      "inviteLink",
      "ownerId",
      "visibility",
      "scope",
      "predictionVisibility",
    ].filter((k) => k in (preview.data ?? {}));
    check(
      "preview exposes no sensitive challenge internals",
      preview.status === 200 && leakedKeys.length === 0,
      `leaked=${leakedKeys.join(",") || "none"}`,
    );

    // ===================================================================
    // Test 6: invite preview + join for FULL and NON-ACTIVE challenges
    // (what a recipient hits opening a link to a closed-off challenge)
    // ===================================================================
    console.log("\nFull / non-active invite preview + join:");

    // --- A private challenge whose single slot is already taken (FULL) ---
    // A dedicated owner with a plan pool of exactly 1: the owner's own seat
    // fills the entire shared pool, so the challenge is at capacity.
    const fullOwner = await seedActivatedUser("fullowner", stamp);
    created.clerkIds.push(fullOwner.clerkId);
    created.userIds.push(fullOwner.userId);
    await assignCustomPlan(fullOwner.userId, `e2e-pool1-${stamp}`, 1);

    const fullInviteCode = `FULL${stamp}`.toUpperCase();
    const [fullChallenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: fullOwner.userId,
        name: `E2E Full Private Challenge ${stamp}`,
        type: "friends",
        visibility: "private",
        scope: "entire_tournament",
        status: "active",
        participantLimit: 1,
        inviteCode: fullInviteCode,
        inviteLink: `/join/${fullInviteCode}`,
      })
      .returning();
    created.challengeIds.push(fullChallenge.id);
    // The owner occupies the only slot, so the pool is at capacity.
    await db.insert(challengeParticipantsTable).values({
      challengeId: fullChallenge.id,
      userId: fullOwner.userId,
      status: "active",
    });

    const fullPreview = await api(
      "GET",
      `/invite/${fullInviteCode.toLowerCase()}`,
    );
    check(
      "full challenge preview reports isFull: true",
      fullPreview.status === 200 && fullPreview.data?.isFull === true,
      `status=${fullPreview.status} isFull=${fullPreview.data?.isFull} count=${fullPreview.data?.participantCount}/${fullPreview.data?.participantLimit}`,
    );
    check(
      "full challenge preview still reports active status",
      fullPreview.status === 200 && fullPreview.data?.status === "active",
      `status=${fullPreview.data?.status}`,
    );

    // A non-participant with the correct code is still rejected: it is full.
    const fullJoin = await api(
      "POST",
      `/challenges/${fullChallenge.id}/join`,
      { token: joiner1.token, body: { viaCode: fullInviteCode } },
    );
    check(
      "join a full challenge with a valid code is rejected (409)",
      fullJoin.status === 409,
      `got ${fullJoin.status}: ${JSON.stringify(fullJoin.data).slice(0, 160)}`,
    );

    const fullRows = await db
      .select()
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, fullChallenge.id),
          eq(challengeParticipantsTable.userId, joiner1.userId),
        ),
      );
    check(
      "rejected full join creates no participant row",
      fullRows.length === 0,
      `rows=${fullRows.length}`,
    );

    // --- A private challenge that is no longer active (completed) ---
    const closedInviteCode = `CLSD${stamp}`.toUpperCase();
    const [closedChallenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Closed Private Challenge ${stamp}`,
        type: "friends",
        visibility: "private",
        scope: "entire_tournament",
        status: "completed",
        inviteCode: closedInviteCode,
        inviteLink: `/join/${closedInviteCode}`,
      })
      .returning();
    created.challengeIds.push(closedChallenge.id);
    await db.insert(challengeParticipantsTable).values({
      challengeId: closedChallenge.id,
      userId: owner.userId,
      status: "active",
    });

    const closedPreview = await api(
      "GET",
      `/invite/${closedInviteCode.toLowerCase()}`,
    );
    check(
      "non-active challenge preview reflects its status (completed)",
      closedPreview.status === 200 && closedPreview.data?.status === "completed",
      `status=${closedPreview.status} challengeStatus=${closedPreview.data?.status}`,
    );

    // Even with the correct code, joining a non-active challenge is rejected.
    const closedJoin = await api(
      "POST",
      `/challenges/${closedChallenge.id}/join`,
      { token: joiner2.token, body: { viaCode: closedInviteCode } },
    );
    check(
      "join a non-active challenge with a valid code is rejected (409)",
      closedJoin.status === 409,
      `got ${closedJoin.status}: ${JSON.stringify(closedJoin.data).slice(0, 160)}`,
    );

    const closedRows = await db
      .select()
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, closedChallenge.id),
          eq(challengeParticipantsTable.userId, joiner2.userId),
        ),
      );
    check(
      "rejected non-active join creates no participant row",
      closedRows.length === 0,
      `rows=${closedRows.length}`,
    );

    // ===================================================================
    // Test 7: Discover lists public + private challenges, but the private
    // invite code is only revealed to the owner / active members.
    // ===================================================================
    console.log("\nDiscover invite-code privacy:");

    // A unique marker so the `q` filter scopes Discover to just these two
    // challenges regardless of whatever else lives in the dev DB.
    const discMarker = `disc${stamp}`;
    const discCode = `DISC${stamp}`.toUpperCase();

    const [discPublic] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Discover Public ${discMarker}`,
        type: "friends",
        visibility: "public",
        scope: "entire_tournament",
        status: "active",
      })
      .returning();
    created.challengeIds.push(discPublic.id);
    await db.insert(challengeParticipantsTable).values({
      challengeId: discPublic.id,
      userId: owner.userId,
      status: "active",
    });

    const [discPrivate] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Discover Private ${discMarker}`,
        type: "friends",
        visibility: "private",
        scope: "entire_tournament",
        status: "active",
        inviteCode: discCode,
        inviteLink: `/join/${discCode}`,
      })
      .returning();
    created.challengeIds.push(discPrivate.id);
    await db.insert(challengeParticipantsTable).values({
      challengeId: discPrivate.id,
      userId: owner.userId,
      status: "active",
    });

    const discoverPath = `/challenges/discover?q=${encodeURIComponent(discMarker)}`;

    // The viewer is NOT a member or owner of either challenge.
    const viewerDiscover = await api("GET", discoverPath, {
      token: viewer.token,
    });
    const vList: any[] = Array.isArray(viewerDiscover.data)
      ? viewerDiscover.data
      : [];
    const vPublic = vList.find((c) => c.id === discPublic.id);
    const vPrivate = vList.find((c) => c.id === discPrivate.id);
    check(
      "discover lists active public challenges",
      viewerDiscover.status === 200 && Boolean(vPublic),
      `status=${viewerDiscover.status} ids=${vList.map((c) => c.id).join(",")}`,
    );
    check(
      "discover lists active private challenges",
      viewerDiscover.status === 200 && Boolean(vPrivate),
      `status=${viewerDiscover.status} ids=${vList.map((c) => c.id).join(",")}`,
    );
    check(
      "discover hides the invite code of a private challenge from non-members",
      Boolean(vPrivate) && vPrivate.inviteCode === null,
      `inviteCode=${JSON.stringify(vPrivate?.inviteCode)}`,
    );

    // The owner sees the invite code for their own private challenge.
    const ownerDiscover = await api("GET", discoverPath, {
      token: owner.token,
    });
    const oList: any[] = Array.isArray(ownerDiscover.data)
      ? ownerDiscover.data
      : [];
    const oPrivate = oList.find((c) => c.id === discPrivate.id);
    check(
      "discover reveals the invite code of a private challenge to its owner",
      Boolean(oPrivate) && oPrivate.inviteCode === discCode,
      `inviteCode=${JSON.stringify(oPrivate?.inviteCode)}`,
    );

    // Once the viewer is an active member, Discover reveals the code to them.
    await db.insert(challengeParticipantsTable).values({
      challengeId: discPrivate.id,
      userId: viewer.userId,
      status: "active",
    });
    const memberDiscover = await api("GET", discoverPath, {
      token: viewer.token,
    });
    const mList: any[] = Array.isArray(memberDiscover.data)
      ? memberDiscover.data
      : [];
    const mPrivate = mList.find((c) => c.id === discPrivate.id);
    check(
      "discover reveals the invite code of a private challenge to an active member",
      Boolean(mPrivate) && mPrivate.inviteCode === discCode,
      `inviteCode=${JSON.stringify(mPrivate?.inviteCode)}`,
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
    // Subscriptions reference plans (onDelete restrict), so drop subs first,
    // then the custom plans, before removing the users they belong to.
    if (created.subscriptionIds.length) {
      await safe("subscriptions", () =>
        db
          .delete(subscriptionsTable)
          .where(inArray(subscriptionsTable.id, created.subscriptionIds)),
      );
    }
    if (created.planIds.length) {
      await safe("plans", () =>
        db.delete(plansTable).where(inArray(plansTable.id, created.planIds)),
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
