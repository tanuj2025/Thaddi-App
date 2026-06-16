/**
 * Moderation + account-deletion + reviewer-bypass regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync), mints
 * real Clerk session tokens for seeded users, and exercises the App-Store
 * compliance surfaces that carry real abuse / safety / privacy risk:
 *
 *   1. Reviewer SMS-bypass (Guideline 2.1): a user whose email is in
 *      REVIEWER_EMAILS reports mobileVerified/activated=true WITHOUT a real SMS
 *      verification, while an identical non-reviewer stays unactivated. The
 *      underlying row is never mutated.
 *   2. Message reporting (Guideline 1.2): a viewer can report another member's
 *      message; reporting is idempotent per (message, reporter); you cannot
 *      report your own message (400), a message that isn't in the named
 *      challenge (404, scope-bypass guard), a missing message/challenge (404),
 *      and a non-viewer of a PRIVATE challenge is refused (403). Admins can list
 *      open reports; non-admins are refused (403).
 *   3. Blocking (Guideline 1.2): self-block (400) + missing target (404) are
 *      rejected; a block atomically drops follows (both directions), the
 *      friendship, and any pending friend request; a block bars follow +
 *      friend-request (403 both ways) and hides chat messages in EITHER
 *      direction; unblock is idempotent and restores the ability to follow.
 *   4. Account deletion (Guideline 5.1.1(v)): DELETE /me removes the account and
 *      a subsequent request with the still-valid session token is refused (401),
 *      i.e. the tombstone prevents JIT re-provisioning. The local row is gone and
 *      a tombstone exists.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `socialFlows.e2e.ts`).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { and, eq, inArray, or } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  teamsTable,
  challengesTable,
  challengeParticipantsTable,
  challengeMessagesTable,
  messageReportsTable,
  userBlocksTable,
  followsTable,
  friendRequestsTable,
  friendshipsTable,
  accountDeletionsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-moderation-e2e/1.0";

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
  opts: { token?: string; body?: unknown; client?: string } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  // The native client sends X-Thaddi-Client: mobile; the web never does. Used
  // to exercise the mobile-only reviewer SMS bypass.
  if (opts.client) headers["X-Thaddi-Client"] = opts.client;
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

type Seeded = {
  clerkId: string;
  userId: string;
  token: string;
  email: string;
};

// Seed a local user linked to a freshly created Clerk user. `mobileVerified`
// and `role` are overridable so we can exercise the reviewer bypass + admin.
async function seedUser(
  label: string,
  stamp: number,
  favoriteTeamId: string | null,
  opts: { mobileVerified?: boolean; role?: "user" | "admin" } = {},
): Promise<Seeded> {
  const email = `thaddi-mod-e2e-${label}-${stamp}@example.com`;
  const clerkId = await createClerkUser(email);
  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: clerkId,
      email,
      emailVerified: true,
      mobileVerified: opts.mobileVerified ?? true,
      favoriteTeamId,
      status: "active",
      role: opts.role ?? "user",
    })
    .returning();
  await db.insert(profilesTable).values({
    userId: row.id,
    displayName: `E2E ${label} ${stamp}`,
    username: `e2e_mod_${label}_${stamp}`,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, token, email };
}

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();
  const prevReviewerEmails = process.env.REVIEWER_EMAILS;

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  const created: {
    clerkIds: string[];
    userIds: string[];
    teamId?: string;
    challengeIds: string[];
    deletedClerkIds: string[];
  } = {
    clerkIds: [],
    userIds: [],
    challengeIds: [],
    deletedClerkIds: [],
  };

  try {
    const [team] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Mod E2E Team",
        nameAr: "فريق اختبار",
        // `demo:` prefix exempts this fixture team from the scheduled football
        // sync's pruneStaleTeams (notLike externalId "demo:%"). Without it the
        // every-60s sync deletes this team mid-run (it's referenced only by
        // users.favoriteTeamId, not by matches) and breaks the FK.
        externalId: `demo:mod-e2e-team-${stamp}`,
      })
      .returning();
    created.teamId = team.id;

    // --- Users ---
    const owner = await seedUser("owner", stamp, team.id);
    const author = await seedUser("author", stamp, team.id);
    const reporter = await seedUser("reporter", stamp, team.id);
    const blockerA = await seedUser("blockerA", stamp, team.id);
    const blockedB = await seedUser("blockedB", stamp, team.id);
    const admin = await seedUser("admin", stamp, team.id, { role: "admin" });
    const deleter = await seedUser("deleter", stamp, team.id);
    const reviewer = await seedUser("reviewer", stamp, team.id, {
      mobileVerified: false,
    });
    const control = await seedUser("control", stamp, team.id, {
      mobileVerified: false,
    });
    // Used to reproduce the deletion partial-failure window: its Clerk identity
    // is deleted mid-test while its local row is left intact (no tombstone).
    const orphan = await seedUser("orphan", stamp, team.id);
    const everyone = [
      owner,
      author,
      reporter,
      blockerA,
      blockedB,
      admin,
      deleter,
      reviewer,
      control,
      orphan,
    ];
    for (const u of everyone) {
      created.clerkIds.push(u.clerkId);
      created.userIds.push(u.userId);
    }

    // --- Challenges (public C1 for chat; private C3 for the 403 report case) ---
    async function makeChallenge(
      name: string,
      visibility: "public" | "private",
    ): Promise<string> {
      const [c] = await db
        .insert(challengesTable)
        .values({
          ownerId: owner.userId,
          name,
          type: "friends",
          visibility,
          scope: "custom",
          status: "active",
          predictionVisibility: "always_visible",
        })
        .returning();
      created.challengeIds.push(c.id);
      return c.id;
    }
    async function addParticipant(challengeId: string, userId: string) {
      await db.insert(challengeParticipantsTable).values({
        challengeId,
        userId,
        status: "active",
      });
    }
    async function seedMessage(
      challengeId: string,
      authorId: string,
      body: string,
    ): Promise<string> {
      const [m] = await db
        .insert(challengeMessagesTable)
        .values({ challengeId, authorId, body })
        .returning();
      return m.id;
    }

    const c1 = await makeChallenge(`Mod E2E Public ${stamp}`, "public");
    const c2 = await makeChallenge(`Mod E2E Public 2 ${stamp}`, "public");
    const c3 = await makeChallenge(`Mod E2E Private ${stamp}`, "private");
    // Owner is always a participant of their own challenge.
    for (const cid of [c1, c2, c3]) await addParticipant(cid, owner.userId);
    for (const u of [author, reporter, blockerA, blockedB]) {
      await addParticipant(c1, u.userId);
    }

    const authoredMsg = await seedMessage(c1, author.userId, "hello from author");
    const c2Msg = await seedMessage(c2, owner.userId, "a message in c2");
    const c3Msg = await seedMessage(c3, owner.userId, "private message");

    // ===================================================================
    // Test 1: Reviewer SMS-bypass
    // ===================================================================
    console.log("\nReviewer SMS-bypass:");

    // Only the reviewer's email is whitelisted; the control's is not.
    process.env.REVIEWER_EMAILS = reviewer.email;

    // The bypass is mobile-only: it applies only to requests carrying the native
    // client's `X-Thaddi-Client: mobile` header. Reviewer on mobile → activated.
    const reviewerMobile = await api("GET", "/me", {
      token: reviewer.token,
      client: "mobile",
    });
    check(
      "reviewer (no SMS) on mobile is reported mobileVerified + activated",
      reviewerMobile.status === 200 &&
        reviewerMobile.data.mobileVerified === true &&
        reviewerMobile.data.activated === true,
      `status=${reviewerMobile.status} mobileVerified=${reviewerMobile.data?.mobileVerified} activated=${reviewerMobile.data?.activated}`,
    );

    // The SAME reviewer email on the web (no mobile header) must NOT bypass SMS.
    const reviewerWeb = await api("GET", "/me", { token: reviewer.token });
    check(
      "reviewer on web (no mobile header) is NOT bypassed — stays unverified + unactivated",
      reviewerWeb.status === 200 &&
        reviewerWeb.data.mobileVerified === false &&
        reviewerWeb.data.activated === false,
      `status=${reviewerWeb.status} mobileVerified=${reviewerWeb.data?.mobileVerified} activated=${reviewerWeb.data?.activated}`,
    );

    const reviewerRow = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, reviewer.userId),
    });
    check(
      "reviewer's underlying row is NOT mutated (mobileVerified stays false)",
      reviewerRow?.mobileVerified === false,
      `row.mobileVerified=${reviewerRow?.mobileVerified}`,
    );

    // The mobile header alone is not enough: a non-whitelisted user on mobile
    // still needs a real SMS verification.
    const controlMobile = await api("GET", "/me", {
      token: control.token,
      client: "mobile",
    });
    check(
      "non-reviewer on mobile (header but not whitelisted) stays unverified + unactivated",
      controlMobile.status === 200 &&
        controlMobile.data.mobileVerified === false &&
        controlMobile.data.activated === false,
      `status=${controlMobile.status} mobileVerified=${controlMobile.data?.mobileVerified} activated=${controlMobile.data?.activated}`,
    );

    process.env.REVIEWER_EMAILS = prevReviewerEmails;

    // ===================================================================
    // Test 2: Message reporting
    // ===================================================================
    console.log("\nMessage reporting:");

    const report1 = await api(
      "POST",
      `/challenges/${c1}/messages/${authoredMsg}/report`,
      { token: reporter.token, body: { reason: "spam" } },
    );
    check(
      "viewer can report another member's message (200)",
      report1.status === 200 && report1.data.success === true,
      `status=${report1.status} ${JSON.stringify(report1.data)}`,
    );

    const report2 = await api(
      "POST",
      `/challenges/${c1}/messages/${authoredMsg}/report`,
      { token: reporter.token, body: { reason: "spam again" } },
    );
    const reportRows = await db
      .select()
      .from(messageReportsTable)
      .where(
        and(
          eq(messageReportsTable.messageId, authoredMsg),
          eq(messageReportsTable.reporterId, reporter.userId),
        ),
      );
    check(
      "re-reporting is idempotent (still 200, exactly one row)",
      report2.status === 200 && reportRows.length === 1,
      `status=${report2.status} rows=${reportRows.length}`,
    );

    const ownReport = await seedMessage(c1, reporter.userId, "my own message");
    const selfReport = await api(
      "POST",
      `/challenges/${c1}/messages/${ownReport}/report`,
      { token: reporter.token },
    );
    check(
      "cannot report your own message (400)",
      selfReport.status === 400,
      `got ${selfReport.status}`,
    );

    const scopeBypass = await api(
      "POST",
      `/challenges/${c1}/messages/${c2Msg}/report`,
      { token: reporter.token },
    );
    check(
      "reporting a message that isn't in the named challenge is refused (404)",
      scopeBypass.status === 404,
      `got ${scopeBypass.status}`,
    );

    const missingMsg = await api(
      "POST",
      `/challenges/${c1}/messages/00000000-0000-0000-0000-000000000000/report`,
      { token: reporter.token },
    );
    check(
      "reporting a missing message is 404",
      missingMsg.status === 404,
      `got ${missingMsg.status}`,
    );

    const missingChallenge = await api(
      "POST",
      `/challenges/00000000-0000-0000-0000-000000000000/messages/${authoredMsg}/report`,
      { token: reporter.token },
    );
    check(
      "reporting in a missing challenge is 404",
      missingChallenge.status === 404,
      `got ${missingChallenge.status}`,
    );

    // control is NOT a participant of the private challenge c3 -> can't view.
    const privateReport = await api(
      "POST",
      `/challenges/${c3}/messages/${c3Msg}/report`,
      { token: control.token },
    );
    check(
      "non-viewer of a private challenge cannot report (403)",
      privateReport.status === 403,
      `got ${privateReport.status}`,
    );

    const reportUnauth = await api(
      "POST",
      `/challenges/${c1}/messages/${authoredMsg}/report`,
      {},
    );
    check(
      "unauthenticated report is rejected (401)",
      reportUnauth.status === 401,
      `got ${reportUnauth.status}`,
    );

    // --- Admin reports list ---
    const adminList = await api("GET", "/admin/message-reports", {
      token: admin.token,
    });
    const listed = Array.isArray(adminList.data?.reports)
      ? adminList.data.reports.find((r: any) => r.messageId === authoredMsg)
      : null;
    check(
      "admin can list the open report with reporter + author identity",
      adminList.status === 200 &&
        !!listed &&
        listed.status === "open" &&
        listed.challengeId === c1 &&
        listed.reporter?.id === reporter.userId &&
        listed.author?.id === author.userId,
      `status=${adminList.status} listed=${JSON.stringify(listed)?.slice(0, 200)}`,
    );

    const nonAdminList = await api("GET", "/admin/message-reports", {
      token: reporter.token,
    });
    check(
      "non-admin cannot list reports (403)",
      nonAdminList.status === 403,
      `got ${nonAdminList.status}`,
    );

    // ===================================================================
    // Test 3: Blocking
    // ===================================================================
    console.log("\nBlocking:");

    const selfBlock = await api("POST", `/users/${blockerA.userId}/block`, {
      token: blockerA.token,
    });
    check(
      "self-block is rejected (400)",
      selfBlock.status === 400,
      `got ${selfBlock.status}`,
    );

    const blockMissing = await api(
      "POST",
      `/users/00000000-0000-0000-0000-000000000000/block`,
      { token: blockerA.token },
    );
    check(
      "blocking a missing user is 404",
      blockMissing.status === 404,
      `got ${blockMissing.status}`,
    );

    // Pre-seed a full relationship (follows both ways + friendship + a pending
    // request) so we can prove the block tears all of it down atomically.
    const [pa, pb] = canonicalPair(blockerA.userId, blockedB.userId);
    await db.insert(followsTable).values([
      { followerId: blockerA.userId, followeeId: blockedB.userId },
      { followerId: blockedB.userId, followeeId: blockerA.userId },
    ]);
    await db.insert(friendshipsTable).values({ userIdA: pa, userIdB: pb });
    const [pendingReq] = await db
      .insert(friendRequestsTable)
      .values({
        requesterId: blockedB.userId,
        recipientId: blockerA.userId,
        status: "pending",
      })
      .returning();

    const block = await api("POST", `/users/${blockedB.userId}/block`, {
      token: blockerA.token,
    });
    check(
      "block returns the relationship with isBlocked=true",
      block.status === 200 && block.data.viewer?.isBlocked === true,
      `status=${block.status} ${JSON.stringify(block.data?.viewer)}`,
    );

    const followsLeft = await db
      .select()
      .from(followsTable)
      .where(
        or(
          and(
            eq(followsTable.followerId, blockerA.userId),
            eq(followsTable.followeeId, blockedB.userId),
          ),
          and(
            eq(followsTable.followerId, blockedB.userId),
            eq(followsTable.followeeId, blockerA.userId),
          ),
        ),
      );
    check(
      "block drops follows in both directions",
      followsLeft.length === 0,
      `remaining follows=${followsLeft.length}`,
    );

    const friendshipLeft = await db
      .select()
      .from(friendshipsTable)
      .where(
        and(eq(friendshipsTable.userIdA, pa), eq(friendshipsTable.userIdB, pb)),
      );
    check(
      "block drops the friendship",
      friendshipLeft.length === 0,
      `remaining friendships=${friendshipLeft.length}`,
    );

    const pendingAfter = await db.query.friendRequestsTable.findFirst({
      where: eq(friendRequestsTable.id, pendingReq.id),
    });
    check(
      "block cancels the pending friend request",
      pendingAfter?.status === "cancelled",
      `status=${pendingAfter?.status}`,
    );

    // --- Block bars follow + friend-request (both ways) ---
    const followBlocked = await api(
      "POST",
      `/users/${blockedB.userId}/follow`,
      { token: blockerA.token },
    );
    check(
      "blocker cannot follow the blocked user (403)",
      followBlocked.status === 403,
      `got ${followBlocked.status}`,
    );

    const followByBlocked = await api(
      "POST",
      `/users/${blockerA.userId}/follow`,
      { token: blockedB.token },
    );
    check(
      "the blocked user cannot follow the blocker either (403)",
      followByBlocked.status === 403,
      `got ${followByBlocked.status}`,
    );

    const friendReqBlocked = await api(
      "POST",
      `/users/${blockedB.userId}/friend-request`,
      { token: blockerA.token },
    );
    check(
      "blocker cannot send a friend request to the blocked user (403)",
      friendReqBlocked.status === 403,
      `got ${friendReqBlocked.status}`,
    );

    // --- Block hides chat messages in BOTH directions ---
    const blockerMsg = await seedMessage(c1, blockerA.userId, "from blockerA");
    const blockedMsg = await seedMessage(c1, blockedB.userId, "from blockedB");

    const asBlocker = await api("GET", `/challenges/${c1}/messages`, {
      token: blockerA.token,
    });
    const blockerSeesAuthors: string[] = Array.isArray(asBlocker.data?.messages)
      ? asBlocker.data.messages.map((m: any) => m.author?.id ?? m.authorId)
      : [];
    check(
      "blocker no longer sees the blocked user's messages",
      asBlocker.status === 200 &&
        !blockerSeesAuthors.includes(blockedB.userId) &&
        blockerSeesAuthors.includes(blockerA.userId),
      `authors=${JSON.stringify(blockerSeesAuthors)}`,
    );

    const asBlocked = await api("GET", `/challenges/${c1}/messages`, {
      token: blockedB.token,
    });
    const blockedSeesAuthors: string[] = Array.isArray(asBlocked.data?.messages)
      ? asBlocked.data.messages.map((m: any) => m.author?.id ?? m.authorId)
      : [];
    check(
      "the blocked user no longer sees the blocker's messages (either direction)",
      asBlocked.status === 200 && !blockedSeesAuthors.includes(blockerA.userId),
      `authors=${JSON.stringify(blockedSeesAuthors)}`,
    );

    const asNeutral = await api("GET", `/challenges/${c1}/messages`, {
      token: reporter.token,
    });
    const neutralAuthors: string[] = Array.isArray(asNeutral.data?.messages)
      ? asNeutral.data.messages.map((m: any) => m.author?.id ?? m.authorId)
      : [];
    check(
      "a neutral viewer still sees both users' messages",
      asNeutral.status === 200 &&
        neutralAuthors.includes(blockerA.userId) &&
        neutralAuthors.includes(blockedB.userId),
      `authors=${JSON.stringify(neutralAuthors)}`,
    );

    // --- Unblock restores follow ---
    const unblock = await api("DELETE", `/users/${blockedB.userId}/block`, {
      token: blockerA.token,
    });
    check(
      "unblock clears the block (isBlocked=false)",
      unblock.status === 200 && unblock.data.viewer?.isBlocked === false,
      `status=${unblock.status} ${JSON.stringify(unblock.data?.viewer)}`,
    );

    const unblockAgain = await api(
      "DELETE",
      `/users/${blockedB.userId}/block`,
      { token: blockerA.token },
    );
    check(
      "unblock is idempotent (200 when not blocked)",
      unblockAgain.status === 200,
      `got ${unblockAgain.status}`,
    );

    const followAfterUnblock = await api(
      "POST",
      `/users/${blockedB.userId}/follow`,
      { token: blockerA.token },
    );
    check(
      "follow is allowed again after unblock (200)",
      followAfterUnblock.status === 200 &&
        followAfterUnblock.data.viewer?.isFollowing === true,
      `status=${followAfterUnblock.status} ${JSON.stringify(followAfterUnblock.data?.viewer)}`,
    );

    // ===================================================================
    // Test 4: Account deletion (5.1.1(v))
    // ===================================================================
    console.log("\nAccount deletion:");

    const beforeDelete = await api("GET", "/me", { token: deleter.token });
    check(
      "deleter can read their account before deletion (200)",
      beforeDelete.status === 200,
      `got ${beforeDelete.status}`,
    );

    const del = await api("DELETE", "/me", { token: deleter.token });
    check(
      "DELETE /me succeeds (200)",
      del.status === 200 && del.data.success === true,
      `status=${del.status} ${JSON.stringify(del.data)}`,
    );
    // Clerk user is now deleted by the endpoint; don't double-delete in teardown.
    created.deletedClerkIds.push(deleter.clerkId);

    const afterDelete = await api("GET", "/me", { token: deleter.token });
    check(
      "the still-valid session token can't re-provision a deleted account (401)",
      afterDelete.status === 401,
      `got ${afterDelete.status}`,
    );

    const localRow = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, deleter.userId),
    });
    check(
      "the local user row is gone after deletion",
      !localRow,
      `row=${JSON.stringify(localRow)?.slice(0, 80)}`,
    );

    const tombstone = await db.query.accountDeletionsTable.findFirst({
      where: eq(accountDeletionsTable.clerkUserId, deleter.clerkId),
    });
    check(
      "a deletion tombstone exists for the clerk user",
      !!tombstone,
      `tombstone=${JSON.stringify(tombstone)?.slice(0, 80)}`,
    );

    // Every OTHER endpoint refuses the deleted identity (the tombstone gate),
    // but DELETE /me itself is idempotent: a retry with the still-valid token
    // finds nothing to clean and returns success, never an error.
    const delAgain = await api("DELETE", "/me", { token: deleter.token });
    check(
      "a second DELETE /me on an already-deleted account is idempotent (200)",
      delAgain.status === 200 && delAgain.data.success === true,
      `status=${delAgain.status} ${JSON.stringify(delAgain.data)}`,
    );

    // ---- Hardening: deleted Clerk identity with a lingering local row --------
    // Reproduce the partial-failure window (Clerk delete succeeded but local
    // cleanup rolled back: row intact, NO tombstone) by deleting orphan's Clerk
    // identity directly while leaving its local row in place. Its session token
    // was minted before deletion, so it is still signature-valid.
    await deleteClerkUser(orphan.clerkId);
    created.deletedClerkIds.push(orphan.clerkId);

    const orphanRead = await api("GET", "/me", { token: orphan.token });
    check(
      "a deleted Clerk identity with a lingering local row is refused on /me (401)",
      orphanRead.status === 401,
      `got ${orphanRead.status}`,
    );

    const orphanHeal = await api("DELETE", "/me", { token: orphan.token });
    check(
      "retried DELETE /me self-heals the lingering row after Clerk is already gone (200)",
      orphanHeal.status === 200 && orphanHeal.data.success === true,
      `status=${orphanHeal.status} ${JSON.stringify(orphanHeal.data)}`,
    );

    const orphanRow = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, orphan.userId),
    });
    check(
      "the lingering local row is cleaned up by the retried deletion",
      !orphanRow,
      `row=${JSON.stringify(orphanRow)?.slice(0, 80)}`,
    );
  } finally {
    process.env.REVIEWER_EMAILS = prevReviewerEmails;

    // --- Teardown (reverse dependency order) ---
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`teardown ${label} failed:`, err);
      }
    };

    if (created.userIds.length) {
      await safe("message_reports", () =>
        db
          .delete(messageReportsTable)
          .where(inArray(messageReportsTable.reporterId, created.userIds)),
      );
      await safe("user_blocks", () =>
        db
          .delete(userBlocksTable)
          .where(inArray(userBlocksTable.blockerId, created.userIds)),
      );
      await safe("friend_requests", () =>
        db
          .delete(friendRequestsTable)
          .where(inArray(friendRequestsTable.requesterId, created.userIds)),
      );
      await safe("friendships_a", () =>
        db
          .delete(friendshipsTable)
          .where(inArray(friendshipsTable.userIdA, created.userIds)),
      );
      await safe("friendships_b", () =>
        db
          .delete(friendshipsTable)
          .where(inArray(friendshipsTable.userIdB, created.userIds)),
      );
      await safe("follows", () =>
        db
          .delete(followsTable)
          .where(inArray(followsTable.followerId, created.userIds)),
      );
    }
    if (created.challengeIds.length) {
      await safe("challenge_messages", () =>
        db
          .delete(challengeMessagesTable)
          .where(inArray(challengeMessagesTable.challengeId, created.challengeIds)),
      );
      await safe("challenge_participants", () =>
        db
          .delete(challengeParticipantsTable)
          .where(
            inArray(challengeParticipantsTable.challengeId, created.challengeIds),
          ),
      );
      await safe("challenges", () =>
        db
          .delete(challengesTable)
          .where(inArray(challengesTable.id, created.challengeIds)),
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
    for (const id of created.deletedClerkIds) {
      await safe("account_deletion tombstone", () =>
        db
          .delete(accountDeletionsTable)
          .where(eq(accountDeletionsTable.clerkUserId, id)),
      );
    }
    if (created.teamId) {
      await safe("team", () =>
        db.delete(teamsTable).where(eq(teamsTable.id, created.teamId!)),
      );
    }
    const deletedSet = new Set(created.deletedClerkIds);
    for (const id of created.clerkIds) {
      if (!deletedSet.has(id)) await deleteClerkUser(id);
    }

    await safe("server close", () => new Promise((r) => server.close(() => r(null))));
    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Moderation regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Moderation regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Moderation regression crashed:", err);
    process.exit(1);
  });
