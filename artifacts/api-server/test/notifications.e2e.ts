/**
 * Notification-center regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * the in-app notification center — the surface the bell icon reads:
 *
 *   1. Auth: every endpoint requires a session (401 when unauthenticated).
 *   2. Listing: `GET /me/notifications` returns the caller's notifications newest
 *      first with a live `unreadCount`; `?unreadOnly=true` filters to unread;
 *      `?limit=N` caps the page.
 *   3. Unread count: `GET /me/notifications/unread-count` matches the list.
 *   4. Mark read: `POST /me/notifications/:id/read` flips one to read and
 *      decrements the count; replaying it is idempotent (still 200, no further
 *      decrement); marking a non-existent id is 404.
 *   5. Read-all: `POST /me/notifications/read-all` zeroes the count.
 *   6. Ownership isolation: a user never sees another user's notifications and
 *      cannot mark one read (404), leaving the real owner's row untouched.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `playerFlows.e2e.ts` / `socialFlows.e2e.ts`).
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  notificationsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-notifications-e2e/1.0";

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

// Seed a minimal local user (the notification center only needs an
// authenticated account, not full activation) linked to a fresh Clerk user.
async function seedUser(
  label: string,
  stamp: number,
): Promise<{ clerkId: string; userId: string; token: string }> {
  const email = `thaddi-notif-e2e-${label}-${stamp}@example.com`;
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
    username: `e2e_notif_${label}_${stamp}`,
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
    notificationIds: string[];
  } = { clerkIds: [], userIds: [], notificationIds: [] };

  try {
    const userA = await seedUser("a", stamp);
    const userB = await seedUser("b", stamp);
    created.clerkIds.push(userA.clerkId, userB.clerkId);
    created.userIds.push(userA.userId, userB.userId);

    // Seed three notifications for A with explicit, spaced timestamps so the
    // newest-first ordering is deterministic, and one already-read row.
    const base = stamp;
    const [n1, n2, n3] = await db
      .insert(notificationsTable)
      .values([
        {
          userId: userA.userId,
          titleEn: "Oldest",
          titleAr: "الأقدم",
          createdAt: new Date(base - 3000),
        },
        {
          userId: userA.userId,
          titleEn: "Middle",
          titleAr: "الأوسط",
          bodyEn: "body",
          bodyAr: "نص",
          data: { challengeId: "x" },
          createdAt: new Date(base - 2000),
        },
        {
          userId: userA.userId,
          titleEn: "Newest already read",
          titleAr: "الأحدث مقروء",
          readAt: new Date(base - 1000),
          createdAt: new Date(base - 1000),
        },
      ])
      .returning();
    const [nB] = await db
      .insert(notificationsTable)
      .values({
        userId: userB.userId,
        titleEn: "B only",
        titleAr: "لـ ب فقط",
        createdAt: new Date(base),
      })
      .returning();
    created.notificationIds.push(n1.id, n2.id, n3.id, nB.id);

    // 1. Auth: every endpoint rejects an anonymous caller.
    console.log("\n[1] Authentication");
    const anonList = await api("GET", "/me/notifications");
    check("GET /me/notifications unauth -> 401", anonList.status === 401, `got ${anonList.status}`);
    const anonCount = await api("GET", "/me/notifications/unread-count");
    check("GET unread-count unauth -> 401", anonCount.status === 401, `got ${anonCount.status}`);
    const anonRead = await api("POST", `/me/notifications/${n1.id}/read`);
    check("POST :id/read unauth -> 401", anonRead.status === 401, `got ${anonRead.status}`);
    const anonReadAll = await api("POST", "/me/notifications/read-all");
    check("POST read-all unauth -> 401", anonReadAll.status === 401, `got ${anonReadAll.status}`);

    // 2. Listing: newest first, with a live unread count.
    console.log("\n[2] Listing + unread count");
    const list = await api("GET", "/me/notifications", { token: userA.token });
    check("GET /me/notifications -> 200", list.status === 200, `got ${list.status}`);
    check(
      "returns exactly A's 3 notifications",
      Array.isArray(list.data?.notifications) && list.data.notifications.length === 3,
      `got ${list.data?.notifications?.length}`,
    );
    check(
      "ordered newest-first",
      list.data?.notifications?.[0]?.id === n3.id &&
        list.data?.notifications?.[2]?.id === n1.id,
      `first=${list.data?.notifications?.[0]?.id}`,
    );
    check("unreadCount = 2", list.data?.unreadCount === 2, `got ${list.data?.unreadCount}`);
    const middle = list.data?.notifications?.find((n: any) => n.id === n2.id);
    check(
      "serializes body + data + read flag",
      middle?.bodyEn === "body" &&
        middle?.read === false &&
        middle?.data?.challengeId === "x",
      JSON.stringify(middle),
    );
    const readRow = list.data?.notifications?.find((n: any) => n.id === n3.id);
    check("already-read row has read:true", readRow?.read === true, JSON.stringify(readRow));

    const unreadOnly = await api(
      "GET",
      "/me/notifications?unreadOnly=true",
      { token: userA.token },
    );
    check(
      "?unreadOnly=true filters to the 2 unread",
      unreadOnly.data?.notifications?.length === 2 &&
        unreadOnly.data.notifications.every((n: any) => n.read === false),
      `got ${unreadOnly.data?.notifications?.length}`,
    );

    const limited = await api(
      "GET",
      "/me/notifications?limit=1",
      { token: userA.token },
    );
    check(
      "?limit=1 caps the page",
      limited.data?.notifications?.length === 1,
      `got ${limited.data?.notifications?.length}`,
    );

    const count = await api(
      "GET",
      "/me/notifications/unread-count",
      { token: userA.token },
    );
    check("unread-count = 2", count.data?.unreadCount === 2, `got ${count.data?.unreadCount}`);

    // 3. Mark one read -> count decrements; replay is idempotent.
    console.log("\n[3] Mark read + idempotency");
    const markN1 = await api(
      "POST",
      `/me/notifications/${n1.id}/read`,
      { token: userA.token },
    );
    check("mark n1 read -> 200", markN1.status === 200, `got ${markN1.status}`);
    check("response read:true", markN1.data?.read === true, JSON.stringify(markN1.data));
    const afterMark = await api(
      "GET",
      "/me/notifications/unread-count",
      { token: userA.token },
    );
    check("unread-count now 1", afterMark.data?.unreadCount === 1, `got ${afterMark.data?.unreadCount}`);

    const replay = await api(
      "POST",
      `/me/notifications/${n1.id}/read`,
      { token: userA.token },
    );
    check("replay mark read -> 200 (idempotent)", replay.status === 200, `got ${replay.status}`);
    const afterReplay = await api(
      "GET",
      "/me/notifications/unread-count",
      { token: userA.token },
    );
    check("count still 1 after replay", afterReplay.data?.unreadCount === 1, `got ${afterReplay.data?.unreadCount}`);

    const markMissing = await api(
      "POST",
      `/me/notifications/00000000-0000-0000-0000-000000000000/read`,
      { token: userA.token },
    );
    check("mark non-existent -> 404", markMissing.status === 404, `got ${markMissing.status}`);

    // 4. Ownership isolation between A and B.
    console.log("\n[4] Ownership isolation");
    const bList = await api("GET", "/me/notifications", { token: userB.token });
    check(
      "B sees only B's notification",
      bList.data?.notifications?.length === 1 &&
        bList.data.notifications[0].id === nB.id,
      `got ${bList.data?.notifications?.length}`,
    );
    const bMarksA = await api(
      "POST",
      `/me/notifications/${n2.id}/read`,
      { token: userB.token },
    );
    check("B cannot mark A's notification -> 404", bMarksA.status === 404, `got ${bMarksA.status}`);
    const stillUnread = await db.query.notificationsTable.findFirst({
      where: eq(notificationsTable.id, n2.id),
    });
    check(
      "A's notification untouched by B's attempt",
      stillUnread?.readAt === null,
      `readAt=${stillUnread?.readAt}`,
    );

    // 5. Read-all zeroes the count.
    console.log("\n[5] Read-all");
    const readAll = await api(
      "POST",
      "/me/notifications/read-all",
      { token: userA.token },
    );
    check("read-all -> 200 unreadCount 0", readAll.status === 200 && readAll.data?.unreadCount === 0, JSON.stringify(readAll.data));
    const finalCount = await api(
      "GET",
      "/me/notifications/unread-count",
      { token: userA.token },
    );
    check("unread-count now 0", finalCount.data?.unreadCount === 0, `got ${finalCount.data?.unreadCount}`);
    const finalList = await api("GET", "/me/notifications", { token: userA.token });
    check(
      "every A notification now read",
      finalList.data?.notifications?.every((n: any) => n.read === true),
      JSON.stringify(finalList.data?.notifications?.map((n: any) => n.read)),
    );
    const bCountUnaffected = await api(
      "GET",
      "/me/notifications/unread-count",
      { token: userB.token },
    );
    check("B's unread count unaffected by A's read-all", bCountUnaffected.data?.unreadCount === 1, `got ${bCountUnaffected.data?.unreadCount}`);
  } finally {
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`cleanup ${label} failed:`, err);
      }
    };

    if (created.notificationIds.length) {
      await safe("notifications", () =>
        db
          .delete(notificationsTable)
          .where(inArray(notificationsTable.id, created.notificationIds)),
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
    console.log(`Notification-center regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Notification-center regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Notification-center regression crashed:", err);
    process.exit(1);
  });
