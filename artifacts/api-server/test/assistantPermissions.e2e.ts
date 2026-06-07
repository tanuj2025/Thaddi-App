/**
 * Challenge-assistant permission regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * the assistant / member-management permission boundaries that govern who may
 * promote, demote, and remove members:
 *
 *   1. Promote / demote are OWNER-ONLY: a plain participant, an assistant, and a
 *      non-participant all get 403 when they attempt to promote or demote — only
 *      the owner can change assistant status.
 *   2. Promote requires an ACTIVE participant of THIS challenge: promoting a
 *      non-participant is 400, and promoting the owner themselves is 400.
 *   3. An assistant CAN remove a plain participant, but never the owner (400),
 *      never another assistant (400 — "demote first"), and never themselves
 *      (400). A plain participant cannot manage members at all (403).
 *   4. Demotion REVOKES management power: once demoted, a former assistant can no
 *      longer remove members (403).
 *   5. The composite FK cascade clears the assistant row when the underlying
 *      participant row is removed (here via the participant leaving the
 *      challenge), so no orphaned assistant row survives.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `playerFlows.e2e.ts`).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  challengesTable,
  challengeParticipantsTable,
  challengeAssistantsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-assistant-e2e/1.0";

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
  const email = `thaddi-assistant-e2e-${label}-${stamp}@example.com`;
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

// Whether an assistant row currently exists for (challenge, user).
async function assistantExists(
  challengeId: string,
  userId: string,
): Promise<boolean> {
  const row = await db.query.challengeAssistantsTable.findFirst({
    where: and(
      eq(challengeAssistantsTable.challengeId, challengeId),
      eq(challengeAssistantsTable.userId, userId),
    ),
  });
  return Boolean(row);
}

// Whether an active participant row currently exists for (challenge, user).
async function participantExists(
  challengeId: string,
  userId: string,
): Promise<boolean> {
  const row = await db.query.challengeParticipantsTable.findFirst({
    where: and(
      eq(challengeParticipantsTable.challengeId, challengeId),
      eq(challengeParticipantsTable.userId, userId),
    ),
  });
  return Boolean(row);
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  const created: { clerkIds: string[]; userIds: string[]; challengeIds: string[] } = {
    clerkIds: [],
    userIds: [],
    challengeIds: [],
  };

  try {
    // --- Seed users: owner + two future-assistants + two plain participants,
    //     plus one user who is NOT a participant of the challenge. ---
    const owner = await seedActivatedUser("owner", stamp);
    const a1 = await seedActivatedUser("a1", stamp);
    const a2 = await seedActivatedUser("a2", stamp);
    const p1 = await seedActivatedUser("p1", stamp);
    const p2 = await seedActivatedUser("p2", stamp);
    const outsider = await seedActivatedUser("outsider", stamp);
    for (const u of [owner, a1, a2, p1, p2, outsider]) {
      created.clerkIds.push(u.clerkId);
      created.userIds.push(u.userId);
    }

    // --- Challenge owned by `owner`; member-management fields are all that
    //     matter here, so no football scope/matches are needed. ---
    const [challenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `E2E Assistant Challenge ${stamp}`,
        type: "friends",
        visibility: "public",
        scope: "entire_tournament",
        status: "active",
      })
      .returning();
    created.challengeIds.push(challenge.id);

    // Active participants: owner, a1, a2, p1, p2 (outsider is intentionally
    // NOT a participant).
    await db.insert(challengeParticipantsTable).values(
      [owner, a1, a2, p1, p2].map((u) => ({
        challengeId: challenge.id,
        userId: u.userId,
        status: "active" as const,
      })),
    );

    // ===================================================================
    // Test 1: promote / demote are OWNER-ONLY
    // ===================================================================
    console.log("\nPromote/demote is owner-only:");

    // A plain participant cannot promote.
    const plainPromote = await api(
      "POST",
      `/challenges/${challenge.id}/assistants`,
      { token: p1.token, body: { userId: p2.userId } },
    );
    check(
      "plain participant cannot promote (403)",
      plainPromote.status === 403,
      `got ${plainPromote.status}: ${JSON.stringify(plainPromote.data).slice(0, 160)}`,
    );

    // A non-participant cannot promote.
    const outsiderPromote = await api(
      "POST",
      `/challenges/${challenge.id}/assistants`,
      { token: outsider.token, body: { userId: p2.userId } },
    );
    check(
      "non-participant cannot promote (403)",
      outsiderPromote.status === 403,
      `got ${outsiderPromote.status}: ${JSON.stringify(outsiderPromote.data).slice(0, 160)}`,
    );

    // The owner promotes a1 to assistant.
    const promoteA1 = await api(
      "POST",
      `/challenges/${challenge.id}/assistants`,
      { token: owner.token, body: { userId: a1.userId } },
    );
    check(
      "owner promotes a participant to assistant (200)",
      promoteA1.status === 200,
      `got ${promoteA1.status}: ${JSON.stringify(promoteA1.data).slice(0, 160)}`,
    );
    check(
      "promotion creates the assistant row",
      await assistantExists(challenge.id, a1.userId),
    );

    // An assistant still cannot promote — promotion stays owner-only.
    const assistantPromote = await api(
      "POST",
      `/challenges/${challenge.id}/assistants`,
      { token: a1.token, body: { userId: p2.userId } },
    );
    check(
      "an assistant cannot promote others (403)",
      assistantPromote.status === 403,
      `got ${assistantPromote.status}: ${JSON.stringify(assistantPromote.data).slice(0, 160)}`,
    );
    check(
      "the rejected assistant-promote created no assistant row",
      !(await assistantExists(challenge.id, p2.userId)),
    );

    // ===================================================================
    // Test 2: promote requires an ACTIVE participant of THIS challenge
    // ===================================================================
    console.log("\nPromote validation:");

    const promoteOutsider = await api(
      "POST",
      `/challenges/${challenge.id}/assistants`,
      { token: owner.token, body: { userId: outsider.userId } },
    );
    check(
      "promoting a non-participant is rejected (400)",
      promoteOutsider.status === 400,
      `got ${promoteOutsider.status}: ${JSON.stringify(promoteOutsider.data).slice(0, 160)}`,
    );
    check(
      "the rejected non-participant promote created no assistant row",
      !(await assistantExists(challenge.id, outsider.userId)),
    );

    const promoteOwner = await api(
      "POST",
      `/challenges/${challenge.id}/assistants`,
      { token: owner.token, body: { userId: owner.userId } },
    );
    check(
      "promoting the owner themselves is rejected (400)",
      promoteOwner.status === 400,
      `got ${promoteOwner.status}: ${JSON.stringify(promoteOwner.data).slice(0, 160)}`,
    );

    // Promote a2 as well, so we have two assistants for the removal tests.
    const promoteA2 = await api(
      "POST",
      `/challenges/${challenge.id}/assistants`,
      { token: owner.token, body: { userId: a2.userId } },
    );
    check(
      "owner promotes a second assistant (200)",
      promoteA2.status === 200,
      `got ${promoteA2.status}: ${JSON.stringify(promoteA2.data).slice(0, 160)}`,
    );

    // ===================================================================
    // Test 3: assistant member-removal boundaries
    // ===================================================================
    console.log("\nAssistant member-removal boundaries:");

    // An assistant CAN remove a plain participant.
    const removeP1 = await api(
      "POST",
      `/challenges/${challenge.id}/participants/remove`,
      { token: a1.token, body: { userId: p1.userId } },
    );
    check(
      "assistant removes a plain participant (200)",
      removeP1.status === 200,
      `got ${removeP1.status}: ${JSON.stringify(removeP1.data).slice(0, 160)}`,
    );
    check(
      "the removed participant row is gone",
      !(await participantExists(challenge.id, p1.userId)),
    );

    // An assistant cannot remove the owner.
    const removeOwner = await api(
      "POST",
      `/challenges/${challenge.id}/participants/remove`,
      { token: a1.token, body: { userId: owner.userId } },
    );
    check(
      "assistant cannot remove the owner (400)",
      removeOwner.status === 400,
      `got ${removeOwner.status}: ${JSON.stringify(removeOwner.data).slice(0, 160)}`,
    );
    check(
      "the owner remains a participant",
      await participantExists(challenge.id, owner.userId),
    );

    // An assistant cannot remove another assistant (must be demoted first).
    const removeA2 = await api(
      "POST",
      `/challenges/${challenge.id}/participants/remove`,
      { token: a1.token, body: { userId: a2.userId } },
    );
    check(
      "assistant cannot remove another assistant (400)",
      removeA2.status === 400,
      `got ${removeA2.status}: ${JSON.stringify(removeA2.data).slice(0, 160)}`,
    );
    check(
      "the other assistant remains a participant",
      await participantExists(challenge.id, a2.userId),
    );

    // An assistant cannot remove themselves through this flow.
    const removeSelf = await api(
      "POST",
      `/challenges/${challenge.id}/participants/remove`,
      { token: a1.token, body: { userId: a1.userId } },
    );
    check(
      "assistant cannot remove themselves (400)",
      removeSelf.status === 400,
      `got ${removeSelf.status}: ${JSON.stringify(removeSelf.data).slice(0, 160)}`,
    );
    check(
      "the assistant remains a participant",
      await participantExists(challenge.id, a1.userId),
    );

    // A plain participant cannot manage members at all.
    const plainRemove = await api(
      "POST",
      `/challenges/${challenge.id}/participants/remove`,
      { token: p2.token, body: { userId: a2.userId } },
    );
    check(
      "a plain participant cannot remove anyone (403)",
      plainRemove.status === 403,
      `got ${plainRemove.status}: ${JSON.stringify(plainRemove.data).slice(0, 160)}`,
    );

    // ===================================================================
    // Test 4: demotion revokes management power
    // ===================================================================
    console.log("\nDemotion revokes management power:");

    // A non-owner cannot demote.
    const plainDemote = await api(
      "POST",
      `/challenges/${challenge.id}/assistants/remove`,
      { token: p2.token, body: { userId: a1.userId } },
    );
    check(
      "a non-owner cannot demote (403)",
      plainDemote.status === 403,
      `got ${plainDemote.status}: ${JSON.stringify(plainDemote.data).slice(0, 160)}`,
    );
    check(
      "the rejected demote left the assistant row intact",
      await assistantExists(challenge.id, a1.userId),
    );

    // The owner demotes a1.
    const demoteA1 = await api(
      "POST",
      `/challenges/${challenge.id}/assistants/remove`,
      { token: owner.token, body: { userId: a1.userId } },
    );
    check(
      "owner demotes an assistant (200)",
      demoteA1.status === 200,
      `got ${demoteA1.status}: ${JSON.stringify(demoteA1.data).slice(0, 160)}`,
    );
    check(
      "demotion removes the assistant row",
      !(await assistantExists(challenge.id, a1.userId)),
    );
    check(
      "the demoted user remains a plain participant",
      await participantExists(challenge.id, a1.userId),
    );

    // The demoted user can no longer manage members.
    const demotedRemove = await api(
      "POST",
      `/challenges/${challenge.id}/participants/remove`,
      { token: a1.token, body: { userId: p2.userId } },
    );
    check(
      "a demoted user can no longer remove members (403)",
      demotedRemove.status === 403,
      `got ${demotedRemove.status}: ${JSON.stringify(demotedRemove.data).slice(0, 160)}`,
    );
    check(
      "the would-be removed participant is untouched",
      await participantExists(challenge.id, p2.userId),
    );

    // ===================================================================
    // Test 5: composite FK cascade clears the assistant row on removal
    // ===================================================================
    console.log("\nComposite FK cascade on participant removal:");

    // a2 is still an assistant. When a2 leaves the challenge, the underlying
    // participant row is deleted — the composite FK
    // (challenge_assistants -> challenge_participants, ON DELETE CASCADE) must
    // clear the assistant row too, leaving no orphan.
    check(
      "precondition: the leaver is still an assistant",
      await assistantExists(challenge.id, a2.userId),
    );
    const leave = await api(
      "POST",
      `/challenges/${challenge.id}/leave`,
      { token: a2.token, body: {} },
    );
    check(
      "the assistant leaves the challenge (200)",
      leave.status === 200,
      `got ${leave.status}: ${JSON.stringify(leave.data).slice(0, 160)}`,
    );
    check(
      "leaving deletes the participant row",
      !(await participantExists(challenge.id, a2.userId)),
    );
    check(
      "the composite FK cascade cleared the orphaned assistant row",
      !(await assistantExists(challenge.id, a2.userId)),
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

    // Challenges cascade to participants + assistants, but delete explicitly
    // first to keep teardown order obvious.
    if (created.challengeIds.length) {
      await safe("assistants", () =>
        db
          .delete(challengeAssistantsTable)
          .where(inArray(challengeAssistantsTable.challengeId, created.challengeIds)),
      );
      await safe("participants", () =>
        db
          .delete(challengeParticipantsTable)
          .where(inArray(challengeParticipantsTable.challengeId, created.challengeIds)),
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
    for (const id of created.clerkIds) await deleteClerkUser(id);

    await safe("server close", () => new Promise((r) => server.close(() => r(null))));
    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Assistant-permission regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Assistant-permission regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Assistant-permission regression crashed:", err);
    process.exit(1);
  });
