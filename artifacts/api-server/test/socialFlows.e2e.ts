/**
 * Social-graph security + state-machine regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * the public-profile / follow / friend-request surfaces that carry real abuse,
 * privacy, and consistency risk:
 *
 *   1. Hide-predictions privacy: `PATCH /me/preferences` flips the user-level
 *      hide-predictions flag (echoed back on CurrentUser). A profile viewer sees
 *      `predictionsHidden:true` + empty recentPredictions once the owner hides,
 *      while the OWNER always sees their own kicked-off predictions regardless.
 *   2. Follow graph: self-follow is rejected (400), follow is idempotent (no
 *      double-count), follower/following counts + list membership are correct,
 *      and unfollow clears the edge.
 *   3. Friend-request state machine: send -> request_sent/request_received with
 *      ids surfaced on both sides + in `/me/social`; duplicate + reverse sends
 *      are 409; only the recipient may respond (requester -> 403); accept forms
 *      a symmetric friendship (friendStatus=friends, friendCount=1 both ways);
 *      a handled request can't be re-answered (409); remove-friend clears it;
 *      decline and cancel both clear the edge AND leave the pair free to send a
 *      fresh request (the pending-pair uniqueness is partial on status=pending).
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `playerFlows.e2e.ts`).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  tournamentsTable,
  stagesTable,
  teamsTable,
  matchesTable,
  predictionsTable,
  challengesTable,
  challengeMatchesTable,
  challengeParticipantsTable,
  followsTable,
  friendRequestsTable,
  friendshipsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-social-e2e/1.0";

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
  favoriteTeamId: string | null,
): Promise<{ clerkId: string; userId: string; token: string }> {
  const email = `thaddi-social-e2e-${label}-${stamp}@example.com`;
  const clerkId = await createClerkUser(email);
  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: clerkId,
      email,
      emailVerified: true,
      mobileVerified: true,
      favoriteTeamId,
      status: "active",
    })
    .returning();
  await db.insert(profilesTable).values({
    userId: row.id,
    displayName: `E2E ${label} ${stamp}`,
    username: `e2e_social_${label}_${stamp}`,
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
  } = {
    clerkIds: [],
    userIds: [],
    matchIds: [],
    challengeIds: [],
  };

  try {
    // --- Shared football fixtures (a single kicked-off match) ---
    const [tournament] = await db
      .insert(tournamentsTable)
      .values({
        slug: `social-e2e-${stamp}`,
        nameEn: "Social E2E Tournament",
        nameAr: "بطولة اختبار اجتماعي",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentId = tournament.id;

    const [stage] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournament.id,
        nameEn: "Social E2E Stage",
        nameAr: "مرحلة اختبار",
        type: "group",
        orderIndex: 0,
      })
      .returning();
    created.stageId = stage.id;

    const [team] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Social E2E Team",
        nameAr: "فريق اختبار",
        externalId: `social-e2e-team-${stamp}`,
      })
      .returning();
    created.teamId = team.id;

    // Already kicked off so predictions on it are eligible to be revealed.
    const [kickedOffMatch] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        homeTeamId: team.id,
        awayTeamId: team.id,
        kickoffAt: new Date(Date.now() - 2 * hourMs),
        status: "live",
        externalId: `social-e2e-locked-${stamp}`,
        venue: "E2E Stadium",
      })
      .returning();
    created.matchIds.push(kickedOffMatch.id);

    // --- Seed users (target + two actors) ---
    const target = await seedActivatedUser("target", stamp, team.id);
    const a = await seedActivatedUser("alpha", stamp, team.id);
    const b = await seedActivatedUser("bravo", stamp, team.id);
    for (const u of [target, a, b]) {
      created.clerkIds.push(u.clerkId);
      created.userIds.push(u.userId);
    }

    // The target has a prediction on the kicked-off match (not part of any
    // challenge, so the per-challenge "hidden" rule does not apply and it is
    // eligible to be revealed to other viewers).
    await db.insert(predictionsTable).values({
      userId: target.userId,
      matchId: kickedOffMatch.id,
      homeScore: 2,
      awayScore: 1,
    });

    // A SECOND kicked-off match that lives ONLY inside a 'hidden'-visibility
    // custom challenge owned by the target. Their prediction on it must never
    // be revealed to other viewers (covered exclusively by a hidden challenge),
    // even while hide-predictions is OFF — but the owner still sees it.
    const [hiddenMatch] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        homeTeamId: team.id,
        awayTeamId: team.id,
        kickoffAt: new Date(Date.now() - 3 * hourMs),
        status: "live",
        externalId: `social-e2e-hidden-${stamp}`,
        venue: "E2E Stadium H",
      })
      .returning();
    created.matchIds.push(hiddenMatch.id);

    const [hiddenChallenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: target.userId,
        name: `E2E Hidden Challenge ${stamp}`,
        type: "friends",
        visibility: "public",
        scope: "custom",
        status: "active",
        predictionVisibility: "hidden",
      })
      .returning();
    created.challengeIds.push(hiddenChallenge.id);
    await db.insert(challengeMatchesTable).values({
      challengeId: hiddenChallenge.id,
      matchId: hiddenMatch.id,
    });
    await db.insert(challengeParticipantsTable).values({
      challengeId: hiddenChallenge.id,
      userId: target.userId,
      status: "active",
    });
    await db.insert(predictionsTable).values({
      userId: target.userId,
      matchId: hiddenMatch.id,
      homeScore: 3,
      awayScore: 0,
    });

    // ===================================================================
    // Test 1: hide-predictions privacy
    // ===================================================================
    console.log("\nHide-predictions privacy:");

    const unauth = await api("GET", `/users/${target.userId}/profile`);
    check(
      "unauthenticated profile read is rejected (401)",
      unauth.status === 401,
      `got ${unauth.status}`,
    );

    const beforeHide = await api("GET", `/users/${target.userId}/profile`, {
      token: a.token,
    });
    const beforeHideMatchIds: string[] = Array.isArray(
      beforeHide.data?.recentPredictions,
    )
      ? beforeHide.data.recentPredictions.map((p: any) => p.matchId)
      : [];
    check(
      "viewer sees target predictions before hide",
      beforeHide.status === 200 &&
        beforeHide.data.predictionsHidden === false &&
        beforeHideMatchIds.includes(kickedOffMatch.id),
      `status=${beforeHide.status} hidden=${beforeHide.data?.predictionsHidden} count=${beforeHideMatchIds.length}`,
    );
    check(
      "viewer never sees a prediction covered only by a hidden-visibility challenge",
      beforeHide.status === 200 && !beforeHideMatchIds.includes(hiddenMatch.id),
      `matchIds=${JSON.stringify(beforeHideMatchIds)}`,
    );

    const patch = await api("PATCH", `/me/preferences`, {
      token: target.token,
      body: { hidePredictions: true },
    });
    check(
      "PATCH /me/preferences flips hidePredictions to true",
      patch.status === 200 && patch.data.hidePredictions === true,
      `status=${patch.status} hidePredictions=${patch.data?.hidePredictions}`,
    );

    const afterHide = await api("GET", `/users/${target.userId}/profile`, {
      token: a.token,
    });
    check(
      "viewer no longer sees target predictions after hide",
      afterHide.status === 200 &&
        afterHide.data.predictionsHidden === true &&
        Array.isArray(afterHide.data.recentPredictions) &&
        afterHide.data.recentPredictions.length === 0,
      `status=${afterHide.status} hidden=${afterHide.data?.predictionsHidden} count=${afterHide.data?.recentPredictions?.length}`,
    );

    const selfView = await api("GET", `/users/${target.userId}/profile`, {
      token: target.token,
    });
    const selfMatchIds: string[] = Array.isArray(
      selfView.data?.recentPredictions,
    )
      ? selfView.data.recentPredictions.map((p: any) => p.matchId)
      : [];
    check(
      "owner still sees their own predictions despite hide",
      selfView.status === 200 &&
        selfView.data.predictionsHidden === false &&
        selfMatchIds.includes(kickedOffMatch.id),
      `status=${selfView.status} hidden=${selfView.data?.predictionsHidden} count=${selfMatchIds.length}`,
    );
    check(
      "owner sees even their hidden-challenge prediction (self bypasses visibility)",
      selfView.status === 200 && selfMatchIds.includes(hiddenMatch.id),
      `matchIds=${JSON.stringify(selfMatchIds)}`,
    );

    // Restore so it doesn't bleed into later assertions (not strictly needed).
    await api("PATCH", `/me/preferences`, {
      token: target.token,
      body: { hidePredictions: false },
    });

    // ===================================================================
    // Test 2: follow graph
    // ===================================================================
    console.log("\nFollow graph:");

    const selfFollow = await api("POST", `/users/${a.userId}/follow`, {
      token: a.token,
    });
    check(
      "self-follow is rejected (400)",
      selfFollow.status === 400,
      `got ${selfFollow.status}: ${JSON.stringify(selfFollow.data).slice(0, 160)}`,
    );

    const follow1 = await api("POST", `/users/${target.userId}/follow`, {
      token: a.token,
    });
    check(
      "follow returns isFollowing=true + followerCount=1",
      follow1.status === 200 &&
        follow1.data.viewer?.isFollowing === true &&
        follow1.data.social?.followerCount === 1,
      `status=${follow1.status} ${JSON.stringify(follow1.data?.viewer)} count=${follow1.data?.social?.followerCount}`,
    );

    const follow2 = await api("POST", `/users/${target.userId}/follow`, {
      token: a.token,
    });
    check(
      "follow is idempotent (followerCount stays 1)",
      follow2.status === 200 && follow2.data.social?.followerCount === 1,
      `count=${follow2.data?.social?.followerCount}`,
    );

    const followers = await api("GET", `/users/${target.userId}/followers`, {
      token: a.token,
    });
    check(
      "followers list contains the follower (total=1)",
      followers.status === 200 &&
        followers.data.total === 1 &&
        Array.isArray(followers.data.entries) &&
        followers.data.entries.some((e: any) => e.userId === a.userId),
      `total=${followers.data?.total} entries=${followers.data?.entries?.length}`,
    );

    const following = await api("GET", `/users/${a.userId}/following`, {
      token: a.token,
    });
    check(
      "following list contains the followee (total=1)",
      following.status === 200 &&
        following.data.total === 1 &&
        following.data.entries.some((e: any) => e.userId === target.userId),
      `total=${following.data?.total} entries=${following.data?.entries?.length}`,
    );

    const unfollow = await api("DELETE", `/users/${target.userId}/follow`, {
      token: a.token,
    });
    check(
      "unfollow clears the edge (isFollowing=false, followerCount=0)",
      unfollow.status === 200 &&
        unfollow.data.viewer?.isFollowing === false &&
        unfollow.data.social?.followerCount === 0,
      `${JSON.stringify(unfollow.data?.viewer)} count=${unfollow.data?.social?.followerCount}`,
    );

    const unfollowMissing = await api(
      "DELETE",
      `/users/00000000-0000-0000-0000-000000000000/follow`,
      { token: a.token },
    );
    check(
      "unfollow of a nonexistent user is rejected (404, matches spec)",
      unfollowMissing.status === 404,
      `got ${unfollowMissing.status}`,
    );

    // ===================================================================
    // Test 3: friend-request state machine (A <-> B)
    // ===================================================================
    console.log("\nFriend-request state machine:");

    // -- send --
    const send = await api("POST", `/users/${b.userId}/friend-request`, {
      token: a.token,
    });
    check(
      "send: requester sees request_sent + outgoingRequestId",
      send.status === 200 &&
        send.data.viewer?.friendStatus === "request_sent" &&
        typeof send.data.viewer?.outgoingRequestId === "string",
      `${JSON.stringify(send.data?.viewer)}`,
    );

    const recipientView = await api("GET", `/users/${a.userId}/profile`, {
      token: b.token,
    });
    check(
      "send: recipient sees request_received + incomingRequestId",
      recipientView.status === 200 &&
        recipientView.data.viewer?.friendStatus === "request_received" &&
        typeof recipientView.data.viewer?.incomingRequestId === "string",
      `${JSON.stringify(recipientView.data?.viewer)}`,
    );

    const bSocial = await api("GET", `/me/social`, { token: b.token });
    const incoming = (bSocial.data?.incomingRequests ?? []).find(
      (r: any) => r.user?.userId === a.userId,
    );
    check(
      "send: /me/social lists the incoming request",
      bSocial.status === 200 && !!incoming && incoming.direction === "incoming",
      `incoming=${JSON.stringify(bSocial.data?.incomingRequests)?.slice(0, 200)}`,
    );

    // -- duplicate + reverse send are blocked --
    const dup = await api("POST", `/users/${b.userId}/friend-request`, {
      token: a.token,
    });
    check(
      "duplicate send is rejected (409)",
      dup.status === 409,
      `got ${dup.status}`,
    );

    const reverse = await api("POST", `/users/${a.userId}/friend-request`, {
      token: b.token,
    });
    check(
      "reverse send while pending is rejected (409)",
      reverse.status === 409,
      `got ${reverse.status}`,
    );

    // -- only the recipient may respond --
    const requestId = send.data.viewer.outgoingRequestId as string;
    const wrongResponder = await api(
      "POST",
      `/friend-requests/${requestId}/respond`,
      { token: a.token, body: { accept: true } },
    );
    check(
      "requester cannot respond to own request (403)",
      wrongResponder.status === 403,
      `got ${wrongResponder.status}: ${JSON.stringify(wrongResponder.data).slice(0, 160)}`,
    );

    // -- accept forms a symmetric friendship --
    const accept = await api(
      "POST",
      `/friend-requests/${requestId}/respond`,
      { token: b.token, body: { accept: true } },
    );
    check(
      "accept: recipient sees friendStatus=friends + friendCount=1",
      accept.status === 200 &&
        accept.data.viewer?.friendStatus === "friends" &&
        accept.data.social?.friendCount === 1,
      `${JSON.stringify(accept.data?.viewer)} count=${accept.data?.social?.friendCount}`,
    );

    const aAfterAccept = await api("GET", `/users/${b.userId}/profile`, {
      token: a.token,
    });
    check(
      "accept: requester also sees friendStatus=friends (symmetric)",
      aAfterAccept.status === 200 &&
        aAfterAccept.data.viewer?.friendStatus === "friends" &&
        aAfterAccept.data.social?.friendCount === 1,
      `${JSON.stringify(aAfterAccept.data?.viewer)} count=${aAfterAccept.data?.social?.friendCount}`,
    );

    const aSocial = await api("GET", `/me/social`, { token: a.token });
    check(
      "accept: /me/social lists the new friend",
      aSocial.status === 200 &&
        (aSocial.data?.friends ?? []).some((f: any) => f.userId === b.userId),
      `friends=${JSON.stringify(aSocial.data?.friends)?.slice(0, 200)}`,
    );

    // -- a handled request can't be re-answered --
    const reAnswer = await api(
      "POST",
      `/friend-requests/${requestId}/respond`,
      { token: b.token, body: { accept: false } },
    );
    check(
      "already-handled request can't be re-answered (409)",
      reAnswer.status === 409,
      `got ${reAnswer.status}`,
    );

    // -- remove friend --
    const removeFriendRes = await api("DELETE", `/users/${b.userId}/friend`, {
      token: a.token,
    });
    check(
      "remove-friend clears the friendship (friendStatus=none, friendCount=0)",
      removeFriendRes.status === 200 &&
        removeFriendRes.data.viewer?.friendStatus === "none" &&
        removeFriendRes.data.social?.friendCount === 0,
      `${JSON.stringify(removeFriendRes.data?.viewer)} count=${removeFriendRes.data?.social?.friendCount}`,
    );

    // -- decline leaves the pair free to send again --
    const send2 = await api("POST", `/users/${b.userId}/friend-request`, {
      token: a.token,
    });
    const requestId2 = send2.data?.viewer?.outgoingRequestId as string;
    check(
      "post-removal: a fresh request can be sent",
      send2.status === 200 && typeof requestId2 === "string",
      `status=${send2.status} ${JSON.stringify(send2.data?.viewer)}`,
    );

    const decline = await api(
      "POST",
      `/friend-requests/${requestId2}/respond`,
      { token: b.token, body: { accept: false } },
    );
    check(
      "decline clears the edge (friendStatus=none)",
      decline.status === 200 && decline.data.viewer?.friendStatus === "none",
      `${JSON.stringify(decline.data?.viewer)}`,
    );

    const send3 = await api("POST", `/users/${b.userId}/friend-request`, {
      token: a.token,
    });
    check(
      "post-decline: a fresh request can be sent (pending-pair uniqueness is partial)",
      send3.status === 200 &&
        send3.data.viewer?.friendStatus === "request_sent",
      `status=${send3.status} ${JSON.stringify(send3.data?.viewer)}`,
    );

    // -- cancel leaves the pair free to send again --
    const cancel = await api("DELETE", `/users/${b.userId}/friend-request`, {
      token: a.token,
    });
    check(
      "cancel clears the outgoing request (friendStatus=none)",
      cancel.status === 200 && cancel.data.viewer?.friendStatus === "none",
      `${JSON.stringify(cancel.data?.viewer)}`,
    );

    const bSocialAfterCancel = await api("GET", `/me/social`, {
      token: b.token,
    });
    check(
      "cancel: recipient's incoming requests no longer include it",
      bSocialAfterCancel.status === 200 &&
        !(bSocialAfterCancel.data?.incomingRequests ?? []).some(
          (r: any) => r.user?.userId === a.userId,
        ),
      `incoming=${JSON.stringify(bSocialAfterCancel.data?.incomingRequests)?.slice(0, 200)}`,
    );

    const cancelAgain = await api("DELETE", `/users/${b.userId}/friend-request`, {
      token: a.token,
    });
    check(
      "cancel with no pending request is rejected (404)",
      cancelAgain.status === 404,
      `got ${cancelAgain.status}`,
    );
  } finally {
    // --- Teardown (reverse dependency order) ---
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`teardown ${label} failed:`, err);
      }
    };

    if (created.userIds.length) {
      await safe("friend_requests", () =>
        db
          .delete(friendRequestsTable)
          .where(inArray(friendRequestsTable.requesterId, created.userIds)),
      );
      await safe("friendships", () =>
        db
          .delete(friendshipsTable)
          .where(inArray(friendshipsTable.userIdA, created.userIds)),
      );
      await safe("follows", () =>
        db
          .delete(followsTable)
          .where(inArray(followsTable.followerId, created.userIds)),
      );
    }
    if (created.challengeIds.length) {
      await safe("challenge_participants", () =>
        db
          .delete(challengeParticipantsTable)
          .where(
            inArray(challengeParticipantsTable.challengeId, created.challengeIds),
          ),
      );
      await safe("challenge_matches", () =>
        db
          .delete(challengeMatchesTable)
          .where(inArray(challengeMatchesTable.challengeId, created.challengeIds)),
      );
      await safe("challenges", () =>
        db
          .delete(challengesTable)
          .where(inArray(challengesTable.id, created.challengeIds)),
      );
    }
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
    console.log(`Social-flow regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Social-flow regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Social-flow regression crashed:", err);
    process.exit(1);
  });
