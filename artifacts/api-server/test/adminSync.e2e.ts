/**
 * Admin football-sync regression test.
 *
 * Closes the gap deliberately left open by `adminPanel.e2e.ts`, which skips the
 * "Trigger sync" action (`POST /api/admin/sync`) because, with a live football
 * provider configured, it makes a real external API call and re-scores every
 * finished match while appending ranking snapshots — side effects that cannot
 * be cleanly reverted.
 *
 * To make the sync action testable and self-cleaning this test:
 *   - FORCES the deterministic mock provider by deleting the provider env keys
 *     *before* the app (and thus the football service) is imported, so the sync
 *     is fully offline and produces a known, fixed set of teams/matches;
 *   - asserts `POST /admin/sync` returns 2xx for an admin, reports the mock
 *     provider, and upserts teams + matches;
 *   - asserts it wrote a `sync.trigger` audit row with non-null ip + user_agent;
 *   - asserts it is rejected — 401 unauthenticated, 403 for a non-admin — and
 *     that a rejected call performs no sync (no rows created, no audit row);
 *   - cleans up afterward by diffing ids: every team/match the sync newly
 *     created is deleted (cascading to any predictions/ledger it touched), every
 *     ranking snapshot it appended is deleted, and the audit rows + seeded users
 *     are removed — leaving the dev DB exactly as found.
 *
 * Runs in its own process (separate `tsx` invocation from `adminPanel.e2e.ts`)
 * so deleting the provider env keys cannot affect any other test.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

// Force the offline, deterministic mock provider BEFORE importing the app: the
// provider is selected lazily on first use, so setting FOOTBALL_PROVIDER=mock
// here guarantees `getFootballProvider()` resolves to "mock" instead of hitting
// any live API. (We also clear the provider keys; on their own that would now
// fall through to the keyless ESPN provider, so the explicit force flag is what
// pins selection to the mock.)
process.env.FOOTBALL_PROVIDER = "mock";
delete process.env.FOOTBALL_DATA_API_KEY;
delete process.env.FOOTBALL_DATA_BASE_URL;
delete process.env.FOOTBALL_DATA_COMPETITION;
delete process.env.FOOTBALL_DATA_WC2026_SEASON;
delete process.env.SPORTMONKS_API_KEY;
delete process.env.SPORTMONKS_API_TOKEN;
delete process.env.SPORTMONKS_BASE_URL;
delete process.env.SPORTMONKS_WC2026_SEASON_ID;
delete process.env.SPORTMONKS_WC2026_SEASON_NAME;

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  profilesTable,
  teamsTable,
  matchesTable,
  rankingsTable,
  auditLogsTable,
  tournamentsTable,
  predictionsTable,
} from "@workspace/db";

const CLERK_API = "https://api.clerk.com/v1";
const USER_AGENT = "thaddi-admin-sync-e2e/1.0";
const FWD_IP = "203.0.113.9";

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

// ---- Snapshot helpers (id-diff isolation) -----------------------------------

async function teamIdSet(): Promise<Set<string>> {
  const rows = await db.select({ id: teamsTable.id }).from(teamsTable);
  return new Set(rows.map((r) => r.id));
}
async function matchIdSet(): Promise<Set<string>> {
  const rows = await db.select({ id: matchesTable.id }).from(matchesTable);
  return new Set(rows.map((r) => r.id));
}
async function rankingIdSet(): Promise<Set<string>> {
  const rows = await db.select({ id: rankingsTable.id }).from(rankingsTable);
  return new Set(rows.map((r) => r.id));
}
function added(before: Set<string>, after: Set<string>): string[] {
  return [...after].filter((id) => !before.has(id));
}

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const stamp = Date.now();

  // Import the app only after the provider env keys have been cleared above.
  const app = (await import("../src/app")).default;

  // Boot the app on an ephemeral port.
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;

  const created: {
    clerkAdminId?: string;
    clerkUserId?: string;
    adminId?: string;
    nonAdminId?: string;
  } = {};

  // Baselines captured before any sync so teardown can delete exactly the rows
  // the sync created.
  let preTeamIds = new Set<string>();
  let preMatchIds = new Set<string>();
  let preRankingIds = new Set<string>();
  let newMatchIds: string[] = [];
  let newTeamIds: string[] = [];
  let newRankingIds: string[] = [];
  // Full snapshots of every pre-existing team/match row. Self-heal pruning now
  // removes provider-managed rows that aren't in the forced-mock snapshot (i.e.
  // any live-provider rows present in this dev DB). Those pruned rows have no
  // dependents (the prune guard skips referenced rows), so teardown can restore
  // them verbatim — by original id — leaving the DB exactly as found.
  let preTeamRows: any[] = [];
  let preMatchRows: any[] = [];
  // Stale fixtures seeded to exercise the self-heal prune (and its skip guard).
  const seededTeamIds: string[] = [];
  const seededMatchIds: string[] = [];
  const seededPredictionIds: string[] = [];
  let staleOrphanTeamId = "";
  let stalePrunableMatchId = "";
  let staleKeptMatchId = "";

  try {
    // --- Seed an admin + a non-admin user (local rows linked to Clerk) ---
    const adminEmail = `thaddi-sync-e2e-admin-${stamp}@example.com`;
    const userEmail = `thaddi-sync-e2e-user-${stamp}@example.com`;

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
      displayName: `E2E Sync Admin ${stamp}`,
      username: `e2e_sync_admin_${stamp}`,
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
      displayName: `E2E Sync User ${stamp}`,
      username: `e2e_sync_user_${stamp}`,
    });

    const adminToken = await mintSessionToken(created.clerkAdminId);
    const userToken = await mintSessionToken(created.clerkUserId);

    // --- Gating: unauth => 401, non-admin => 403, and neither runs a sync ---
    console.log("\nSync access gating:");
    preTeamIds = await teamIdSet();

    const unauth = await api("POST", "/admin/sync");
    check("unauthenticated POST /admin/sync => 401", unauth.status === 401, `got ${unauth.status}`);

    const nonAdmin = await api("POST", "/admin/sync", { token: userToken });
    check("non-admin POST /admin/sync => 403", nonAdmin.status === 403, `got ${nonAdmin.status}`);

    // A rejected call must not have triggered the sync (no teams created)...
    const teamsAfterRejected = await teamIdSet();
    check(
      "rejected sync calls created no teams",
      added(preTeamIds, teamsAfterRejected).length === 0,
      `added=${added(preTeamIds, teamsAfterRejected).length}`,
    );
    // ...and must not have written any audit row for the non-admin.
    const nonAdminAudit = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.actorUserId, created.nonAdminId!));
    check("rejected sync wrote no audit row", nonAdminAudit.length === 0, `rows=${nonAdminAudit.length}`);

    // --- Admin sync: 2xx + mock provider + upserts + audit trail ---
    console.log("\nAdmin sync trigger + audit trail:");
    preMatchIds = await matchIdSet();
    preRankingIds = await rankingIdSet();
    // Full row snapshots so teardown can restore any live-provider rows the
    // forced-mock sync prunes (see preTeamRows/preMatchRows note above).
    preTeamRows = await db.select().from(teamsTable);
    preMatchRows = await db.select().from(matchesTable);

    // --- Seed stale provider rows (different external_id scheme) to prove the
    // self-heal prune. Seeded AFTER the baseline capture so the teardown restore
    // never re-creates them. The orphan team + dependent-free match must be
    // pruned; the match that has a user prediction must be SKIPPED (kept). ---
    const [wcTournament] = await db
      .select({ id: tournamentsTable.id })
      .from(tournamentsTable)
      .where(eq(tournamentsTable.slug, "fifa-world-cup-2026"));
    check("WC2026 tournament is seeded", Boolean(wcTournament), "missing tournament");

    if (wcTournament) {
      const [staleTeam] = await db
        .insert(teamsTable)
        .values({
          nameEn: `Stale Orphan ${stamp}`,
          nameAr: `يتيم ${stamp}`,
          externalId: `stale-team-${stamp}`,
        })
        .returning({ id: teamsTable.id });
      seededTeamIds.push(staleTeam.id);

      const [stalePrunable] = await db
        .insert(matchesTable)
        .values({
          tournamentId: wcTournament.id,
          kickoffAt: new Date(Date.now() + 96 * 3600 * 1000),
          status: "scheduled",
          externalId: `stale-match-prune-${stamp}`,
        })
        .returning({ id: matchesTable.id });
      seededMatchIds.push(stalePrunable.id);

      const [staleKept] = await db
        .insert(matchesTable)
        .values({
          tournamentId: wcTournament.id,
          kickoffAt: new Date(Date.now() + 120 * 3600 * 1000),
          status: "scheduled",
          externalId: `stale-match-keep-${stamp}`,
        })
        .returning({ id: matchesTable.id });
      seededMatchIds.push(staleKept.id);
      staleKeptMatchId = staleKept.id;
      staleOrphanTeamId = staleTeam.id;
      stalePrunableMatchId = stalePrunable.id;

      // A user prediction makes staleKept ineligible for pruning (guard).
      const [pred] = await db
        .insert(predictionsTable)
        .values({
          userId: created.nonAdminId!,
          matchId: staleKept.id,
          homeScore: 1,
          awayScore: 0,
        })
        .returning({ id: predictionsTable.id });
      seededPredictionIds.push(pred.id);
    }

    const res = await api("POST", "/admin/sync", { token: adminToken });
    check(
      "admin POST /admin/sync => 2xx",
      res.status >= 200 && res.status < 300,
      `got ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`,
    );
    check(
      "sync used the forced mock provider",
      res.data?.provider === "mock",
      `provider=${JSON.stringify(res.data?.provider)}`,
    );
    check(
      "sync upserted teams",
      typeof res.data?.teamsUpserted === "number" && res.data.teamsUpserted > 0,
      `teamsUpserted=${JSON.stringify(res.data?.teamsUpserted)}`,
    );
    check(
      "sync upserted matches",
      typeof res.data?.matchesUpserted === "number" && res.data.matchesUpserted > 0,
      `matchesUpserted=${JSON.stringify(res.data?.matchesUpserted)}`,
    );

    // Audit row for the sync action, with non-null ip + user-agent.
    const auditRows = await db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.actorUserId, created.adminId!),
          eq(auditLogsTable.action, "sync.trigger"),
        ),
      );
    const auditRow = auditRows[0];
    check("sync wrote a sync.trigger audit row", Boolean(auditRow));
    if (auditRow) {
      check(
        "audit row has non-null ip",
        auditRow.ip != null && auditRow.ip !== "",
        `ip=${JSON.stringify(auditRow.ip)}`,
      );
      check(
        "audit row has non-null user_agent",
        auditRow.userAgent != null && auditRow.userAgent !== "",
        `user_agent=${JSON.stringify(auditRow.userAgent)}`,
      );
    }

    // The mock fixtures (8 teams, 12 matches) were inserted.
    const postTeamIds = await teamIdSet();
    const postMatchIds = await matchIdSet();
    newTeamIds = added(preTeamIds, postTeamIds);
    newMatchIds = added(preMatchIds, postMatchIds);
    newRankingIds = added(preRankingIds, await rankingIdSet());
    check("sync inserted new team rows", newTeamIds.length > 0, `new teams=${newTeamIds.length}`);
    check("sync inserted new match rows", newMatchIds.length > 0, `new matches=${newMatchIds.length}`);

    // --- Self-heal prune: stale rows gone, referenced rows kept ---
    console.log("\nSelf-heal prune of stale provider rows:");
    check(
      "response reports matchesPruned >= 1",
      typeof res.data?.matchesPruned === "number" && res.data.matchesPruned >= 1,
      `matchesPruned=${JSON.stringify(res.data?.matchesPruned)}`,
    );
    check(
      "response reports teamsPruned >= 1",
      typeof res.data?.teamsPruned === "number" && res.data.teamsPruned >= 1,
      `teamsPruned=${JSON.stringify(res.data?.teamsPruned)}`,
    );

    const prunableGone = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(eq(matchesTable.id, stalePrunableMatchId));
    check("dependent-free stale match was pruned", prunableGone.length === 0);

    const orphanTeamGone = await db
      .select({ id: teamsTable.id })
      .from(teamsTable)
      .where(eq(teamsTable.id, staleOrphanTeamId));
    check("orphan stale team was pruned", orphanTeamGone.length === 0);

    const keptMatch = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(eq(matchesTable.id, staleKeptMatchId));
    check(
      "stale match with a user prediction was SKIPPED (kept)",
      keptMatch.length === 1,
    );
    const keptPred = await db
      .select({ id: predictionsTable.id })
      .from(predictionsTable)
      .where(eq(predictionsTable.matchId, staleKeptMatchId));
    check("the user prediction survived (not cascade-deleted)", keptPred.length === 1);
  } finally {
    // --- Teardown: delete exactly what the sync + this test created ---
    console.log("\nTeardown:");
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`  teardown ${label} failed:`, err);
      }
    };

    // Audit rows written by the seeded actors (sync.trigger + any others).
    const actorIds = [created.adminId, created.nonAdminId].filter(
      (x): x is string => Boolean(x),
    );
    if (actorIds.length) {
      await safe("audit_logs", () =>
        db.delete(auditLogsTable).where(inArray(auditLogsTable.actorUserId, actorIds)),
      );
    }
    // Matches first (FK cascade clears any predictions/ledger/challenge_matches
    // the sync may have touched), then the teams they referenced.
    if (newMatchIds.length) {
      await safe("matches", () =>
        db.delete(matchesTable).where(inArray(matchesTable.id, newMatchIds)),
      );
    }
    if (newTeamIds.length) {
      await safe("teams", () =>
        db.delete(teamsTable).where(inArray(teamsTable.id, newTeamIds)),
      );
    }
    // Defensively remove any seeded stale fixtures still present (the prunable
    // ones are gone via self-heal; the kept one is covered by newMatchIds, but
    // delete explicitly so a mid-test failure can't leak fixtures).
    if (seededPredictionIds.length) {
      await safe("seeded predictions", () =>
        db
          .delete(predictionsTable)
          .where(inArray(predictionsTable.id, seededPredictionIds)),
      );
    }
    if (seededMatchIds.length) {
      await safe("seeded matches", () =>
        db.delete(matchesTable).where(inArray(matchesTable.id, seededMatchIds)),
      );
    }
    if (seededTeamIds.length) {
      await safe("seeded teams", () =>
        db.delete(teamsTable).where(inArray(teamsTable.id, seededTeamIds)),
      );
    }
    // Restore any pre-existing live-provider rows the forced-mock sync pruned.
    // Pruned rows have no dependents, so re-inserting them verbatim (original
    // ids) is safe and fully restores the baseline. Teams before matches so
    // matches' home/away team FKs resolve.
    await safe("restore pruned rows", async () => {
      const teamsNow = await teamIdSet();
      const matchesNow = await matchIdSet();
      const teamsToRestore = preTeamRows.filter((t) => !teamsNow.has(t.id));
      const matchesToRestore = preMatchRows.filter((m) => !matchesNow.has(m.id));
      if (teamsToRestore.length) {
        await db.insert(teamsTable).values(teamsToRestore);
      }
      if (matchesToRestore.length) {
        await db.insert(matchesTable).values(matchesToRestore);
      }
      if (teamsToRestore.length || matchesToRestore.length) {
        console.log(
          `  restored ${teamsToRestore.length} pruned team(s) + ${matchesToRestore.length} pruned match(es)`,
        );
      }
    });
    // Ranking snapshots are append-only, so deleting the new ids restores the
    // prior baseline exactly.
    if (newRankingIds.length) {
      await safe("rankings", () =>
        db.delete(rankingsTable).where(inArray(rankingsTable.id, newRankingIds)),
      );
    }
    if (actorIds.length) {
      await safe("profiles", () =>
        db.delete(profilesTable).where(inArray(profilesTable.userId, actorIds)),
      );
      await safe("users", () =>
        db.delete(usersTable).where(inArray(usersTable.id, actorIds)),
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
    console.log(`Admin-sync regression: ALL ${passed} checks passed.`);
  } else {
    console.error(`Admin-sync regression: ${failures.length} FAILED, ${passed} passed.`);
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Admin-sync regression crashed:", err);
    process.exit(1);
  });
