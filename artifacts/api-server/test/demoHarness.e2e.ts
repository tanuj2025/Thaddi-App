// One-shot manual e2e for the live demo-data harness: mints a Clerk admin
// session, seeds demo data via the real endpoint, asserts status + audit, then
// tears it down and asserts a clean sweep. Run: tsx test/demoHarness.e2e.ts
import app from "../src/app";
import {
  db,
  usersTable,
  auditLogsTable,
  badgesTable,
  userBadgesTable,
  achievementsTable,
  userAchievementsTable,
  predictionsTable,
  matchesTable,
} from "@workspace/db";
import { and, desc, eq, like, isNull, inArray } from "drizzle-orm";

const CLERK_API = "https://api.clerk.com/v1";
const SECRET = process.env.CLERK_SECRET_KEY;

async function clerk<T = any>(method: string, path: string, body?: unknown) {
  const res = await fetch(CLERK_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as T };
}

async function createClerkUser(email: string): Promise<string> {
  const { status, data } = await clerk<{ id: string }>("POST", "/users", {
    email_address: [email],
    password: `Aa1!${email}${Date.now()}`,
    skip_password_checks: true,
    skip_legal_checks: true,
  });
  if (status >= 400) throw new Error(`Clerk create user failed: ${JSON.stringify(data)}`);
  return data.id;
}

async function mintSessionToken(clerkUserId: string): Promise<string> {
  const sess = await clerk<{ id: string }>("POST", "/sessions", { user_id: clerkUserId });
  if (sess.status >= 400) throw new Error(`Clerk create session failed`);
  const tok = await clerk<{ jwt: string }>("POST", `/sessions/${sess.data.id}/tokens`, {});
  if (tok.status >= 400 || !tok.data.jwt) throw new Error(`Clerk mint token failed`);
  return tok.data.jwt;
}

let passed = 0;
function check(label: string, cond: boolean) {
  if (!cond) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`  \u2713 ${label}`);
}

async function main() {
  if (!SECRET) throw new Error("CLERK_SECRET_KEY required");

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  const adminEmail = `thaddi-e2e-demo-${Date.now()}@example.com`;
  const clerkAdminId = await createClerkUser(adminEmail);
  const [adminRow] = await db
    .insert(usersTable)
    .values({ clerkUserId: clerkAdminId, email: adminEmail, role: "admin", status: "active" })
    .returning();
  const token = await mintSessionToken(clerkAdminId);

  // Catalog rows we may create for the reconciliation proof; removed in finally.
  const createdBadgeIds: string[] = [];
  const createdAchievementIds: string[] = [];

  async function api(method: string, path: string, body?: unknown) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "thaddi-demo-e2e/1.0",
        "X-Forwarded-For": "203.0.113.9",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  }

  try {
    console.log("\nDemo harness e2e:");

    // Clean baseline.
    const initial = await api("GET", "/admin/demo/status");
    check("status: 200", initial.status === 200);
    check("status: enabled (non-prod)", initial.data.enabled === true);
    if (initial.data.active) {
      await api("POST", "/admin/demo/teardown");
    }

    // Seed.
    const seed = await api("POST", "/admin/demo/seed");
    check("seed: 200", seed.status === 200);
    check("seed: active", seed.data.active === true);
    check("seed: engineRunning", seed.data.engineRunning === true);
    check("seed: ~50 matches", seed.data.totalMatches >= 40);
    check("seed: has challenges", seed.data.challenges === 2);
    check("seed: has demo users", seed.data.users >= 1);
    check("seed: has a finished match (already-scored)", seed.data.finished >= 1);

    // --- Clock controls: fast-forward + force-finish run the REAL scoring path. ---
    // Advancing the whole timeline can only push matches further along, so the
    // finished count must be monotonic non-decreasing.
    const adv = await api("POST", "/admin/demo/advance", { minutes: 30 });
    check("advance: 200", adv.status === 200);
    check("advance: still active", adv.data.active === true);
    check("advance: engine running", adv.data.engineRunning === true);
    check("advance: finished count grew", adv.data.finished >= seed.data.finished);

    // Force every currently-live match to full time — live must drop to zero.
    const fin = await api("POST", "/admin/demo/advance", { finishLive: true });
    check("finishLive: 200", fin.status === 200);
    check("finishLive: no live matches remain", fin.data.live === 0);
    check("finishLive: finished count grew", fin.data.finished >= adv.data.finished);

    // Bad body (negative minutes) is rejected by the zod schema.
    const bad = await api("POST", "/admin/demo/advance", { minutes: -5 });
    check("advance: invalid body 400", bad.status === 400);

    // Audit row for the advance action.
    const [advAudit] = await db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.actorUserId, adminRow.id), eq(auditLogsTable.action, "demo.advance")))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(1);
    check("advance: wrote audit row", !!advAudit);
    check("advance: audit ip non-null", !!advAudit?.ip);

    // --- Reconciliation proof: teardown must remove demo-DERIVED awards from a
    // real user while PRESERVING their legitimate (non-demo) awards. We make the
    // admin "affected" by giving them a prediction on a demo match, then plant
    // both a demo-derived earnable badge / global achievement (must be revoked)
    // and a non-earnable decorative badge (must survive). ---
    const [demoMatch] = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(like(matchesTable.externalId, "demo:m:%"))
      .limit(1);
    check("reconcile: found a demo match", !!demoMatch);
    await db
      .insert(predictionsTable)
      .values({ userId: adminRow.id, matchId: demoMatch!.id, homeScore: 1, awayScore: 0 });

    // Demo-derived earnable badge (admin has no real qualifying predictions).
    let earnable = await db.query.badgesTable.findFirst({
      where: eq(badgesTable.code, "prediction_king"),
    });
    if (!earnable) {
      [earnable] = await db
        .insert(badgesTable)
        .values({ code: "prediction_king", nameEn: "Prediction King", nameAr: "ملك التوقعات" })
        .returning();
      createdBadgeIds.push(earnable!.id);
    }
    await db
      .insert(userBadgesTable)
      .values({ userId: adminRow.id, badgeId: earnable!.id })
      .onConflictDoNothing();

    // Legitimate non-earnable (decorative) badge — must NOT be touched.
    const keepCode = `demo_keepsake_${Date.now()}`;
    const [keepBadge] = await db
      .insert(badgesTable)
      .values({ code: keepCode, nameEn: "Keepsake", nameAr: "تذكار" })
      .returning();
    createdBadgeIds.push(keepBadge!.id);
    await db.insert(userBadgesTable).values({ userId: adminRow.id, badgeId: keepBadge!.id });

    // Demo-derived global Top Predictor achievement — must be revoked.
    let topAch = await db.query.achievementsTable.findFirst({
      where: eq(achievementsTable.code, "top_predictor"),
    });
    if (!topAch) {
      [topAch] = await db
        .insert(achievementsTable)
        .values({ code: "top_predictor", nameEn: "Top Predictor", nameAr: "أفضل متوقع" })
        .returning();
      createdAchievementIds.push(topAch!.id);
    }
    await db
      .insert(userAchievementsTable)
      .values({ userId: adminRow.id, achievementId: topAch!.id, challengeId: null })
      .onConflictDoNothing();

    // Audit for seed.
    const [seedAudit] = await db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.actorUserId, adminRow.id), eq(auditLogsTable.action, "demo.seed")))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(1);
    check("seed: wrote audit row", !!seedAudit);
    check("seed: audit ip non-null", !!seedAudit?.ip);

    // Double-seed rejected.
    const dup = await api("POST", "/admin/demo/seed");
    check("double-seed: 409", dup.status === 409);

    // Teardown.
    const down = await api("POST", "/admin/demo/teardown");
    check("teardown: 200", down.status === 200);
    check("teardown: inactive", down.data.active === false);
    check("teardown: engine stopped", down.data.engineRunning === false);
    check("teardown: zero matches", down.data.totalMatches === 0);
    check("teardown: zero challenges", down.data.challenges === 0);
    check("teardown: zero demo users", down.data.users === 0);

    // Reconciliation outcome on the affected real (admin) user.
    const adminBadges = await db
      .select({ badgeId: userBadgesTable.badgeId })
      .from(userBadgesTable)
      .where(eq(userBadgesTable.userId, adminRow.id));
    const badgeIdSet = new Set(adminBadges.map((b) => b.badgeId));
    check("reconcile: demo-derived earnable badge revoked", !badgeIdSet.has(earnable!.id));
    check("reconcile: legitimate decorative badge preserved", badgeIdSet.has(keepBadge!.id));

    const adminTopAch = await db
      .select({ id: userAchievementsTable.id })
      .from(userAchievementsTable)
      .where(
        and(
          eq(userAchievementsTable.userId, adminRow.id),
          eq(userAchievementsTable.achievementId, topAch!.id),
          isNull(userAchievementsTable.challengeId),
        ),
      );
    check("reconcile: demo-derived Top Predictor revoked", adminTopAch.length === 0);

    const [downAudit] = await db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.actorUserId, adminRow.id), eq(auditLogsTable.action, "demo.teardown")))
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(1);
    check("teardown: wrote audit row", !!downAudit);

    console.log(`\n============================================================`);
    console.log(`Demo-harness e2e: ALL ${passed} checks passed.`);
    console.log(`============================================================`);
  } finally {
    // Cleanup: remove the test admin (cascades its badges/achievements/audit),
    // then any catalog rows the reconciliation proof had to create.
    await db.delete(auditLogsTable).where(eq(auditLogsTable.actorUserId, adminRow.id));
    await db.delete(usersTable).where(eq(usersTable.id, adminRow.id));
    if (createdAchievementIds.length > 0) {
      await db
        .delete(achievementsTable)
        .where(inArray(achievementsTable.id, createdAchievementIds))
        .catch(() => {});
    }
    if (createdBadgeIds.length > 0) {
      await db
        .delete(badgesTable)
        .where(inArray(badgesTable.id, createdBadgeIds))
        .catch(() => {});
    }
    await clerk("DELETE", `/users/${clerkAdminId}`).catch(() => {});
    server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
