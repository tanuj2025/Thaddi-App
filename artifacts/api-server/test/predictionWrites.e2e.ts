/**
 * Prediction-write security regression test.
 *
 * Boots the Express app in-process on an ephemeral port (so it does not depend
 * on the dev workflow being up, and never runs the startup football sync in
 * `index.ts`), mints real Clerk session tokens for seeded users, and exercises
 * the single most cheating-sensitive flow: the prediction write path
 * (`PUT /matches/:id/prediction`) and its tamper-evident audit trail
 * (`GET /matches/:id/prediction-history`).
 *
 *   1. Submit before lock: a first submission returns 200 and appends exactly
 *      one immutable `prediction_history` row.
 *   2. Edit before lock: a subsequent edit returns 200, persists the new
 *      scoreline, and appends a SECOND history row (history is append-only and
 *      never overwritten — the original row survives unchanged).
 *   3. Locked match: an edit on a match whose kickoff is in the past is rejected
 *      with 409, the stored prediction is left unchanged, and no new history row
 *      is appended (you cannot move a pick after kickoff, nor erase the trail).
 *   4. History privacy: `GET /matches/:id/prediction-history` returns ONLY the
 *      caller's own history — never another user's rows.
 *
 * Every fixture is seeded directly and reverted at the end, leaving the DB as
 * found (matching `adminPanel.e2e.ts` / `playerFlows.e2e.ts`).
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
  predictionsTable,
  predictionHistoryTable,
} from "@workspace/db";
import app from "../src/app";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-prediction-e2e/1.0";

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
  const email = `thaddi-prediction-e2e-${label}-${stamp}@example.com`;
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
    username: `e2e_pred_${label}_${stamp}`,
  });
  const token = await mintSessionToken(clerkId);
  return { clerkId, userId: row.id, token };
}

// Count this user's prediction-history rows for a match (the immutable trail).
async function historyCount(userId: string, matchId: string): Promise<number> {
  const rows = await db
    .select()
    .from(predictionHistoryTable)
    .where(
      and(
        eq(predictionHistoryTable.userId, userId),
        eq(predictionHistoryTable.matchId, matchId),
      ),
    );
  return rows.length;
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
  } = { clerkIds: [], userIds: [], matchIds: [] };

  try {
    // --- Seed users (the player under test + another user) ---
    const player = await seedActivatedUser("player", stamp);
    const other = await seedActivatedUser("other", stamp);
    for (const u of [player, other]) {
      created.clerkIds.push(u.clerkId);
      created.userIds.push(u.userId);
    }

    // --- Shared football fixtures ---
    const [tournament] = await db
      .insert(tournamentsTable)
      .values({
        slug: `pred-e2e-${stamp}`,
        nameEn: "Prediction E2E Tournament",
        nameAr: "بطولة اختبار التوقعات",
        type: "other",
        status: "active",
      })
      .returning();
    created.tournamentId = tournament.id;

    const [stage] = await db
      .insert(stagesTable)
      .values({
        tournamentId: tournament.id,
        nameEn: "Prediction E2E Stage",
        nameAr: "مرحلة اختبار",
        type: "group",
        orderIndex: 0,
      })
      .returning();
    created.stageId = stage.id;

    const [team] = await db
      .insert(teamsTable)
      .values({
        nameEn: "Prediction E2E Team",
        nameAr: "فريق اختبار",
        externalId: `pred-e2e-team-${stamp}`,
      })
      .returning();
    created.teamId = team.id;

    // An unlocked match (kickoff far in the future) where edits are allowed,
    // and a locked match (kickoff in the past) where edits must be refused.
    // predictionLockAt left null so kickoff is the lock boundary.
    const [unlockedMatch] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        kickoffAt: new Date(Date.now() + 7 * 24 * hourMs),
        status: "scheduled",
        externalId: `pred-e2e-unlocked-${stamp}`,
        venue: "E2E Stadium A",
      })
      .returning();
    created.matchIds.push(unlockedMatch.id);

    const [lockedMatch] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournament.id,
        stageId: stage.id,
        kickoffAt: new Date(Date.now() - 2 * hourMs),
        status: "live",
        externalId: `pred-e2e-locked-${stamp}`,
        venue: "E2E Stadium B",
      })
      .returning();
    created.matchIds.push(lockedMatch.id);

    // ===================================================================
    // Test 1: submit before lock appends exactly one history row
    // ===================================================================
    console.log("\nSubmit before lock:");

    const submit = await api(
      "PUT",
      `/matches/${unlockedMatch.id}/prediction`,
      { token: player.token, body: { homeScore: 1, awayScore: 0 } },
    );
    check(
      "first submission accepted (200)",
      submit.status === 200,
      `got ${submit.status}: ${JSON.stringify(submit.data).slice(0, 160)}`,
    );
    check(
      "submission persists the submitted scoreline",
      submit.status === 200 &&
        submit.data.homeScore === 1 &&
        submit.data.awayScore === 0,
      `home=${submit.data?.homeScore} away=${submit.data?.awayScore}`,
    );
    const afterSubmit = await historyCount(player.userId, unlockedMatch.id);
    check(
      "exactly one history row appended on first submission",
      afterSubmit === 1,
      `rows=${afterSubmit}`,
    );

    // ===================================================================
    // Test 2: edit before lock appends a SECOND row (append-only)
    // ===================================================================
    console.log("\nEdit before lock (append-only history):");

    const edit = await api(
      "PUT",
      `/matches/${unlockedMatch.id}/prediction`,
      { token: player.token, body: { homeScore: 2, awayScore: 1 } },
    );
    check(
      "edit accepted (200)",
      edit.status === 200,
      `got ${edit.status}: ${JSON.stringify(edit.data).slice(0, 160)}`,
    );

    const storedAfterEdit = await db.query.predictionsTable.findFirst({
      where: and(
        eq(predictionsTable.userId, player.userId),
        eq(predictionsTable.matchId, unlockedMatch.id),
      ),
    });
    check(
      "edit overwrites the live prediction with the new scoreline",
      storedAfterEdit?.homeScore === 2 && storedAfterEdit?.awayScore === 1,
      `home=${storedAfterEdit?.homeScore} away=${storedAfterEdit?.awayScore}`,
    );

    const historyRows = await db
      .select()
      .from(predictionHistoryTable)
      .where(
        and(
          eq(predictionHistoryTable.userId, player.userId),
          eq(predictionHistoryTable.matchId, unlockedMatch.id),
        ),
      )
      .orderBy(predictionHistoryTable.recordedAt);
    check(
      "a second history row is appended on edit",
      historyRows.length === 2,
      `rows=${historyRows.length}`,
    );
    check(
      "history is append-only: the original row survives unchanged",
      historyRows.length === 2 &&
        historyRows[0].homeScore === 1 &&
        historyRows[0].awayScore === 0 &&
        historyRows[1].homeScore === 2 &&
        historyRows[1].awayScore === 1,
      `rows=${JSON.stringify(historyRows.map((h) => [h.homeScore, h.awayScore]))}`,
    );

    // ===================================================================
    // Test 3: edit on a locked match is rejected (409), nothing mutated
    // ===================================================================
    console.log("\nEdit on locked match (rejected):");

    // Seed a stored prediction + matching history row on the locked match so we
    // can prove the rejected edit changes neither.
    const [lockedPred] = await db
      .insert(predictionsTable)
      .values({
        userId: player.userId,
        matchId: lockedMatch.id,
        homeScore: 3,
        awayScore: 3,
      })
      .returning();
    await db.insert(predictionHistoryTable).values({
      predictionId: lockedPred.id,
      userId: player.userId,
      matchId: lockedMatch.id,
      homeScore: 3,
      awayScore: 3,
    });

    const lockedEdit = await api(
      "PUT",
      `/matches/${lockedMatch.id}/prediction`,
      { token: player.token, body: { homeScore: 5, awayScore: 5 } },
    );
    check(
      "edit on a locked match is rejected (409)",
      lockedEdit.status === 409,
      `got ${lockedEdit.status}: ${JSON.stringify(lockedEdit.data).slice(0, 160)}`,
    );

    const lockedStored = await db.query.predictionsTable.findFirst({
      where: and(
        eq(predictionsTable.userId, player.userId),
        eq(predictionsTable.matchId, lockedMatch.id),
      ),
    });
    check(
      "the stored prediction on a locked match is left unchanged",
      lockedStored?.homeScore === 3 && lockedStored?.awayScore === 3,
      `home=${lockedStored?.homeScore} away=${lockedStored?.awayScore}`,
    );
    const lockedHistory = await historyCount(player.userId, lockedMatch.id);
    check(
      "no new history row is appended for a rejected locked edit",
      lockedHistory === 1,
      `rows=${lockedHistory}`,
    );

    // ===================================================================
    // Test 4: prediction-history returns only the caller's own rows
    // ===================================================================
    console.log("\nPrediction-history privacy:");

    // The other user submits a distinctive pick on the same (unlocked) match.
    const otherSubmit = await api(
      "PUT",
      `/matches/${unlockedMatch.id}/prediction`,
      { token: other.token, body: { homeScore: 4, awayScore: 4 } },
    );
    check(
      "other user's submission accepted (200)",
      otherSubmit.status === 200,
      `got ${otherSubmit.status}: ${JSON.stringify(otherSubmit.data).slice(0, 160)}`,
    );

    const playerHistory = await api(
      "GET",
      `/matches/${unlockedMatch.id}/prediction-history`,
      { token: player.token },
    );
    check(
      "player sees only their own two history entries",
      playerHistory.status === 200 &&
        Array.isArray(playerHistory.data) &&
        playerHistory.data.length === 2,
      `status=${playerHistory.status} len=${playerHistory.data?.length}`,
    );
    check(
      "player's history never leaks the other user's scoreline",
      Array.isArray(playerHistory.data) &&
        playerHistory.data.every(
          (h: any) => !(h.homeScore === 4 && h.awayScore === 4),
        ) &&
        JSON.stringify(playerHistory.data.map((h: any) => [h.homeScore, h.awayScore])) ===
          JSON.stringify([
            [1, 0],
            [2, 1],
          ]),
      `entries=${JSON.stringify(playerHistory.data?.map?.((h: any) => [h.homeScore, h.awayScore]))}`,
    );

    const otherHistory = await api(
      "GET",
      `/matches/${unlockedMatch.id}/prediction-history`,
      { token: other.token },
    );
    check(
      "other user sees only their own single entry",
      otherHistory.status === 200 &&
        Array.isArray(otherHistory.data) &&
        otherHistory.data.length === 1 &&
        otherHistory.data[0].homeScore === 4 &&
        otherHistory.data[0].awayScore === 4,
      `status=${otherHistory.status} entries=${JSON.stringify(otherHistory.data)}`,
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

    if (created.matchIds.length) {
      // prediction_history cascades from predictions, but delete explicitly
      // first to keep teardown order obvious.
      await safe("prediction_history", () =>
        db
          .delete(predictionHistoryTable)
          .where(inArray(predictionHistoryTable.matchId, created.matchIds)),
      );
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
    console.log(`Prediction-write regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Prediction-write regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Prediction-write regression crashed:", err);
    process.exit(1);
  });
