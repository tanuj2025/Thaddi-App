/**
 * Admin-panel regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints a real Clerk session token for a seeded admin user, and
 * then:
 *   - exercises one mutation per admin section against `/api/admin/*`,
 *     asserting a 2xx response;
 *   - asserts each mutation wrote an `audit_logs` row with non-null `ip` and
 *     `user_agent`;
 *   - asserts an unauthenticated request gets 401 and a non-admin token gets
 *     403 from `/api/admin/*` (both a read and a write endpoint);
 *   - reverts every row it created at the end (admin + non-admin users, all
 *     fixtures, and the audit rows it generated), leaving the DB as found.
 *
 * The live football-data sync (`POST /admin/sync`) is intentionally NOT
 * triggered: with a live provider configured it makes an external API call and
 * runs `applyScoringForFinalMatches()` over every finished match (appending
 * ranking snapshots), which cannot be cleanly reverted. Its admin-panel logic
 * (`requireAdminUser` gating + `recordAudit`) is identical to the seven covered
 * sections, so the regression coverage it would add is negligible.
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
  subscriptionsTable,
  plansTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-admin-e2e/1.0";
const FWD_IP = "203.0.113.7";

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
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "X-Forwarded-For": FWD_IP,
  };
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

// Assert a mutation succeeded (2xx) AND wrote an audit row with ip + user-agent.
async function expectMutationAndAudit(
  section: string,
  action: string,
  entityId: string,
  res: { status: number; data: any },
  actorUserId: string,
): Promise<void> {
  check(
    `${section}: mutation returns 2xx`,
    res.status >= 200 && res.status < 300,
    `got ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`,
  );
  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.actorUserId, actorUserId),
        eq(auditLogsTable.action, action),
        eq(auditLogsTable.entityId, entityId),
      ),
    );
  const row = rows[0];
  check(`${section}: wrote audit_logs row (${action})`, Boolean(row));
  if (row) {
    check(
      `${section}: audit row has non-null ip`,
      row.ip != null && row.ip !== "",
      `ip=${JSON.stringify(row.ip)}`,
    );
    check(
      `${section}: audit row has non-null user_agent`,
      row.userAgent != null && row.userAgent !== "",
      `user_agent=${JSON.stringify(row.userAgent)}`,
    );
  }
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();

  // Boot the app on an ephemeral port.
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  // Track everything we create for guaranteed teardown.
  const created: {
    clerkAdminId?: string;
    clerkUserId?: string;
    adminId?: string;
    nonAdminId?: string;
    tournamentId?: string;
    stageId?: string;
    teamId?: string;
    matchId?: string;
    challengeId?: string;
    subscriptionId?: string;
  } = {};

  try {
    // --- Seed an admin + a non-admin user (local rows linked to Clerk) ---
    const adminEmail = `thaddi-e2e-admin-${stamp}@example.com`;
    const userEmail = `thaddi-e2e-user-${stamp}@example.com`;

    created.clerkAdminId = await createClerkUser(adminEmail);
    created.clerkUserId = await createClerkUser(userEmail);

    const [adminRow] = await db
      .insert(usersTable)
      .values({
        clerkUserId: created.clerkAdminId,
        email: adminEmail,
        emailVerified: true,
        role: "admin",
        status: "active",
      })
      .returning();
    created.adminId = adminRow.id;
    await db.insert(profilesTable).values({
      userId: adminRow.id,
      displayName: `E2E Admin ${stamp}`,
      username: `e2e_admin_${stamp}`,
    });

    const [nonAdminRow] = await db
      .insert(usersTable)
      .values({
        clerkUserId: created.clerkUserId,
        email: userEmail,
        emailVerified: true,
        role: "user",
        status: "active",
      })
      .returning();
    created.nonAdminId = nonAdminRow.id;
    await db.insert(profilesTable).values({
      userId: nonAdminRow.id,
      displayName: `E2E User ${stamp}`,
      username: `e2e_user_${stamp}`,
    });

    // --- Create per-section fixtures directly (no admin create endpoints for
    //     teams/matches/challenges/subscriptions, and seed data may be empty) ---
    const [tournament] = await db
      .insert(tournamentsTable)
      .values({
        slug: `e2e-tournament-${stamp}`,
        nameEn: "E2E Tournament",
        nameAr: "بطولة اختبار",
        type: "other",
        status: "upcoming",
      })
      .returning();
    created.tournamentId = tournament.id;

    const [stage] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournament.id,
        nameEn: "E2E Stage",
        nameAr: "مرحلة اختبار",
        type: "group",
        orderIndex: 0,
      })
      .returning();
    created.stageId = stage.id;

    const [team] = await db
      .insert(teamsTable)
      .values({
        nameEn: "E2E Team",
        nameAr: "فريق اختبار",
        externalId: `e2e-team-${stamp}`,
      })
      .returning();
    created.teamId = team.id;

    const [match] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        kickoffAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: "scheduled",
        externalId: `e2e-match-${stamp}`,
        venue: "E2E Stadium",
      })
      .returning();
    created.matchId = match.id;

    const [challenge] = await db
      .insert(challengesTable)
      .values({
        ownerId: nonAdminRow.id,
        name: `E2E Challenge ${stamp}`,
        type: "friends",
        visibility: "private",
        scope: "entire_tournament",
        status: "active",
      })
      .returning();
    created.challengeId = challenge.id;

    const plan = await db.query.plansTable.findFirst();
    if (!plan) throw new Error("No plans seeded; cannot build a subscription fixture");
    const [subscription] = await db
      .insert(subscriptionsTable)
      .values({
        userId: nonAdminRow.id,
        planId: plan.id,
        status: "active",
      })
      .returning();
    created.subscriptionId = subscription.id;

    // --- Mint Clerk session tokens (short-lived; mint right before use) ---
    const adminToken = await mintSessionToken(created.clerkAdminId);
    const userToken = await mintSessionToken(created.clerkUserId);

    // --- Gating: unauthenticated => 401, non-admin => 403 (read + write) ---
    console.log("\nAccess gating:");
    const unauthRead = await api("GET", "/admin/overview");
    check("unauthenticated GET /admin/overview => 401", unauthRead.status === 401, `got ${unauthRead.status}`);

    const unauthWrite = await api("PATCH", `/admin/teams/${team.id}`, {
      body: { nameEn: "hacker" },
    });
    check("unauthenticated PATCH /admin/teams => 401", unauthWrite.status === 401, `got ${unauthWrite.status}`);

    const nonAdminRead = await api("GET", "/admin/overview", { token: userToken });
    check("non-admin GET /admin/overview => 403", nonAdminRead.status === 403, `got ${nonAdminRead.status}`);

    const nonAdminWrite = await api("PATCH", `/admin/teams/${team.id}`, {
      token: userToken,
      body: { nameEn: "hacker" },
    });
    check("non-admin PATCH /admin/teams => 403", nonAdminWrite.status === 403, `got ${nonAdminWrite.status}`);

    // Confirm the rejected writes did not mutate the team.
    const teamAfterGating = await db.query.teamsTable.findFirst({
      where: eq(teamsTable.id, team.id),
    });
    check(
      "rejected writes did not modify the team",
      teamAfterGating?.nameEn === "E2E Team",
      `nameEn=${teamAfterGating?.nameEn}`,
    );

    // Admin can reach the panel.
    const adminRead = await api("GET", "/admin/overview", { token: adminToken });
    check("admin GET /admin/overview => 200", adminRead.status === 200, `got ${adminRead.status}`);

    // --- One mutation per admin section, each asserting 2xx + audit row ---
    console.log("\nSection mutations + audit trail:");
    const A = created.adminId;

    await expectMutationAndAudit(
      "tournaments",
      "tournament.update",
      tournament.id,
      await api("PATCH", `/admin/tournaments/${tournament.id}`, {
        token: adminToken,
        body: { status: "active" },
      }),
      A,
    );

    await expectMutationAndAudit(
      "stages",
      "stage.update",
      stage.id,
      await api("PATCH", `/admin/stages/${stage.id}`, {
        token: adminToken,
        body: { nameEn: "E2E Stage Updated" },
      }),
      A,
    );

    await expectMutationAndAudit(
      "matches",
      "match.update",
      match.id,
      await api("PATCH", `/admin/matches/${match.id}`, {
        token: adminToken,
        body: { venue: "E2E Stadium Updated" },
      }),
      A,
    );

    await expectMutationAndAudit(
      "teams",
      "team.update",
      team.id,
      await api("PATCH", `/admin/teams/${team.id}`, {
        token: adminToken,
        body: { nameEn: "E2E Team Updated" },
      }),
      A,
    );

    await expectMutationAndAudit(
      "users",
      "user.update",
      nonAdminRow.id,
      await api("PATCH", `/admin/users/${nonAdminRow.id}`, {
        token: adminToken,
        body: { role: "user", status: "active" },
      }),
      A,
    );

    await expectMutationAndAudit(
      "challenges",
      "challenge.update",
      challenge.id,
      await api("PATCH", `/admin/challenges/${challenge.id}`, {
        token: adminToken,
        body: { visibility: "unlisted" },
      }),
      A,
    );

    await expectMutationAndAudit(
      "subscriptions",
      "subscription.update",
      subscription.id,
      await api("PATCH", `/admin/subscriptions/${subscription.id}`, {
        token: adminToken,
        body: { status: "expired" },
      }),
      A,
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

    if (created.adminId) {
      await safe("audit_logs", () =>
        db.delete(auditLogsTable).where(eq(auditLogsTable.actorUserId, created.adminId!)),
      );
    }
    if (created.subscriptionId) {
      await safe("subscription", () =>
        db.delete(subscriptionsTable).where(eq(subscriptionsTable.id, created.subscriptionId!)),
      );
    }
    if (created.challengeId) {
      await safe("challenge", () =>
        db.delete(challengesTable).where(eq(challengesTable.id, created.challengeId!)),
      );
    }
    if (created.matchId) {
      await safe("match", () =>
        db.delete(matchesTable).where(eq(matchesTable.id, created.matchId!)),
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
        db.delete(tournamentsTable).where(eq(tournamentsTable.id, created.tournamentId!)),
      );
    }
    const userIds = [created.adminId, created.nonAdminId].filter(
      (x): x is string => Boolean(x),
    );
    if (userIds.length) {
      await safe("profiles", () =>
        db.delete(profilesTable).where(inArray(profilesTable.userId, userIds)),
      );
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, userIds)),
      );
    }
    if (created.clerkAdminId) await deleteClerkUser(created.clerkAdminId);
    if (created.clerkUserId) await deleteClerkUser(created.clerkUserId);

    await safe("server close", () => new Promise((r) => server.close(() => r(null))));
    await safe("pool end", () => pool.end());
  }

  // --- Report ---
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Admin-panel regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Admin-panel regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Admin-panel regression crashed:", err);
    process.exit(1);
  });
