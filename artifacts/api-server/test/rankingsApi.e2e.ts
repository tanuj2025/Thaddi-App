/**
 * Rankings / leaderboard HTTP-endpoint regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * the public ranking surface end-to-end. The scoring COMPUTATION is covered by
 * scoringEngine/scoringScopes; this test pins the HTTP contract that wraps it —
 * authentication, visibility gating, scoping, and response shape:
 *
 *   1. `GET /rankings/global` is public and returns a global RankingData shape.
 *   2. `GET /challenges/:id/ranking` returns one entry per active participant,
 *      ranked (more points first), with the standings fields the UI reads.
 *   3. Visibility: a PRIVATE challenge's ranking is 403 for a non-member, 200 for
 *      the owner and for an active participant; an unknown id is 404.
 *   4. `GET /challenges/:id/winning-probability` is 401 unauthenticated, 403 for a
 *      non-participant, and 200 for an active participant.
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
  challengesTable,
  challengeParticipantsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-rankings-e2e/1.0";

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

async function seedUser(
  label: string,
  stamp: number,
): Promise<{ clerkId: string; userId: string; token: string }> {
  const email = `thaddi-rankings-e2e-${label}-${stamp}@example.com`;
  const clerkId = await createClerkUser(email);
  const [row] = await db
    .insert(usersTable)
    .values({
      clerkUserId: clerkId,
      email,
      emailVerified: true,
      status: "active",
    })
    .returning();
  await db.insert(profilesTable).values({
    userId: row.id,
    displayName: `E2E ${label} ${stamp}`,
    username: `e2e_rank_${label}_${stamp}`,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, token };
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

  const created: {
    clerkIds: string[];
    userIds: string[];
    challengeIds: string[];
  } = { clerkIds: [], userIds: [], challengeIds: [] };

  try {
    const owner = await seedUser("owner", stamp);
    const member = await seedUser("member", stamp);
    const outsider = await seedUser("outsider", stamp);
    created.clerkIds.push(owner.clerkId, member.clerkId, outsider.clerkId);
    created.userIds.push(owner.userId, member.userId, outsider.userId);

    // Public challenge: owner (10 pts) ahead of member (5 pts).
    const [pub] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `Rankings E2E Public ${stamp}`,
        type: "friends",
        visibility: "public",
        status: "active",
      })
      .returning();
    // Private challenge: only the owner participates.
    const [priv] = await db
      .insert(challengesTable)
      .values({
        ownerId: owner.userId,
        name: `Rankings E2E Private ${stamp}`,
        type: "friends",
        visibility: "private",
        status: "active",
      })
      .returning();
    created.challengeIds.push(pub.id, priv.id);

    await db.insert(challengeParticipantsTable).values([
      { challengeId: pub.id, userId: owner.userId, status: "active", points: 10, totalPredictions: 4, exactPredictions: 2 },
      { challengeId: pub.id, userId: member.userId, status: "active", points: 5, totalPredictions: 4, exactPredictions: 1 },
      { challengeId: priv.id, userId: owner.userId, status: "active", points: 0 },
    ]);

    // 1. Global ranking is public + correctly shaped.
    console.log("\n[1] Global ranking");
    const global = await api("GET", "/rankings/global");
    check("GET /rankings/global (anon) -> 200", global.status === 200, `got ${global.status}`);
    check(
      "global shape: scope=global + entries array + me=null for anon",
      global.data?.scope === "global" &&
        Array.isArray(global.data?.entries) &&
        global.data?.me === null,
      JSON.stringify({ scope: global.data?.scope, me: global.data?.me, entries: Array.isArray(global.data?.entries) }),
    );
    const globalLimited = await api("GET", "/rankings/global?limit=1");
    check(
      "global respects ?limit=1",
      Array.isArray(globalLimited.data?.entries) && globalLimited.data.entries.length <= 1,
      `got ${globalLimited.data?.entries?.length}`,
    );

    // 2. Public challenge ranking: one ranked entry per active participant.
    console.log("\n[2] Challenge ranking (public)");
    const pubRank = await api("GET", `/challenges/${pub.id}/ranking`);
    check("public ranking (anon) -> 200", pubRank.status === 200, `got ${pubRank.status}`);
    check("scope=challenge + challengeId echoed", pubRank.data?.scope === "challenge" && pubRank.data?.challengeId === pub.id, JSON.stringify({ scope: pubRank.data?.scope }));
    check(
      "one entry per active participant (2)",
      Array.isArray(pubRank.data?.entries) && pubRank.data.entries.length === 2,
      `got ${pubRank.data?.entries?.length}`,
    );
    const top = pubRank.data?.entries?.[0];
    const second = pubRank.data?.entries?.[1];
    check(
      "ordered: owner (10) rank 1, member (5) rank 2",
      top?.userId === owner.userId && top?.rank === 1 && second?.userId === member.userId && second?.rank === 2,
      JSON.stringify(pubRank.data?.entries?.map((e: any) => ({ u: e.userId, r: e.rank, p: e.points }))),
    );
    check(
      "entry carries the standings fields the UI reads",
      typeof top?.points === "number" &&
        "accuracy" in (top ?? {}) &&
        typeof top?.displayName === "string" &&
        typeof top?.exactPredictions === "number",
      JSON.stringify(top),
    );
    const ownerView = await api("GET", `/challenges/${pub.id}/ranking`, { token: owner.token });
    check(
      "authed owner sees me=self (isCurrentUser)",
      ownerView.data?.me?.userId === owner.userId && ownerView.data?.me?.isCurrentUser === true,
      JSON.stringify(ownerView.data?.me),
    );

    // 3. Private challenge visibility gating + unknown id.
    console.log("\n[3] Private ranking visibility");
    const privOutsider = await api("GET", `/challenges/${priv.id}/ranking`, { token: outsider.token });
    check("private ranking, non-member -> 403", privOutsider.status === 403, `got ${privOutsider.status}`);
    const privAnon = await api("GET", `/challenges/${priv.id}/ranking`);
    check("private ranking, anon -> 403", privAnon.status === 403, `got ${privAnon.status}`);
    const privOwner = await api("GET", `/challenges/${priv.id}/ranking`, { token: owner.token });
    check("private ranking, owner -> 200", privOwner.status === 200, `got ${privOwner.status}`);

    // Make member an active participant of the private challenge -> can view.
    await db.insert(challengeParticipantsTable).values({
      challengeId: priv.id,
      userId: member.userId,
      status: "active",
      points: 0,
    });
    const privMember = await api("GET", `/challenges/${priv.id}/ranking`, { token: member.token });
    check("private ranking, active participant -> 200", privMember.status === 200, `got ${privMember.status}`);

    const unknown = await api("GET", `/challenges/00000000-0000-0000-0000-000000000000/ranking`);
    check("unknown challenge ranking -> 404", unknown.status === 404, `got ${unknown.status}`);

    // 4. Winning probability: auth + participant gating.
    console.log("\n[4] Winning probability gating");
    const wpAnon = await api("GET", `/challenges/${pub.id}/winning-probability`);
    check("winning-probability anon -> 401", wpAnon.status === 401, `got ${wpAnon.status}`);
    const wpOutsider = await api("GET", `/challenges/${pub.id}/winning-probability`, { token: outsider.token });
    check("winning-probability non-participant -> 403", wpOutsider.status === 403, `got ${wpOutsider.status}`);
    const wpOwner = await api("GET", `/challenges/${pub.id}/winning-probability`, { token: owner.token });
    check("winning-probability participant -> 200", wpOwner.status === 200, `got ${wpOwner.status}`);
  } finally {
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`cleanup ${label} failed:`, err);
      }
    };

    if (created.challengeIds.length) {
      await safe("challenge_participants", () =>
        db
          .delete(challengeParticipantsTable)
          .where(inArray(challengeParticipantsTable.challengeId, created.challengeIds)),
      );
      await safe("challenges", () =>
        db.delete(challengesTable).where(inArray(challengesTable.id, created.challengeIds)),
      );
    }
    if (created.userIds.length) {
      await safe("profiles", () =>
        db.delete(profilesTable).where(inArray(profilesTable.userId, created.userIds)),
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
    console.log(`Rankings-API regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Rankings-API regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Rankings-API regression crashed:", err);
    process.exit(1);
  });
