/**
 * Opportunistic live-refresh wrapper test (autoscale freshness fix).
 *
 * Production runs on Replit Autoscale, where the self-scheduling setTimeout sync
 * loop never ticks (the instance is suspended between requests), so match data
 * froze at boot and finished matches kept showing as "live". The fix piggy-backs
 * a THROTTLED, SINGLE-FLIGHT sync onto read endpoints via
 * `maybeRefreshLiveMatches`. Both the cycle and the gate are injectable; the real
 * provider sync is covered by multiCompetitionSync.e2e.ts, so this test is fully
 * offline and asserts the gate + concurrency contract:
 *
 *   - real gate, fresh data: a just-synced dataset is skipped (no refresh). This
 *     case uses the REAL `shouldRefresh`; it is deterministic because the seeded
 *     row pins MAX(updated_at) to ~now, so the staleness window can't have passed;
 *   - gated run: when the gate says "due", the cycle runs exactly once;
 *   - single-flight: concurrent callers launch exactly one cycle, never overlap;
 *   - bounded wait: the caller returns within LIVE_REFRESH_MAX_WAIT_MS even if
 *     the cycle runs longer (so a slow provider can't hang the read path);
 *   - best-effort: a rejecting cycle never throws into the caller and the
 *     in-flight latch resets so the next read can refresh again.
 *
 * A full route-level "GET /matches flips a finished row" test is intentionally
 * NOT attempted here: the staleness gate keys off the GLOBAL MAX(updated_at),
 * which the shared dev DB keeps fresh, so the real gate can't be forced "due"
 * deterministically from a seeded row. The real sync that performs the flip is
 * covered by multiCompetitionSync.e2e.ts; here we cover the wrapper/gate contract.
 *
 * Fully self-cleaning: seeds one throwaway tournament + live match and deletes
 * exactly those in teardown.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { eq } from "drizzle-orm";
import { db, pool, tournamentsTable, matchesTable } from "@workspace/db";
import { maybeRefreshLiveMatches } from "../src/services/football/liveRefresh";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ALWAYS: () => Promise<boolean> = async () => true;

// A fake sync cycle that records call count and peak concurrency, then settles
// after `delayMs` (optionally rejecting) — lets us exercise the wrapper alone.
function makeFake(delayMs: number, opts?: { reject?: boolean }) {
  const state = { calls: 0, running: 0, maxConcurrent: 0 };
  const fn = (): Promise<void> => {
    state.calls += 1;
    state.running += 1;
    state.maxConcurrent = Math.max(state.maxConcurrent, state.running);
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        state.running -= 1;
        if (opts?.reject) reject(new Error("boom"));
        else resolve();
      }, delayMs);
    });
  };
  return { fn, state };
}

async function main(): Promise<void> {
  // The suite runs with LIVE_REFRESH_DISABLED=1 to keep opportunistic refresh out
  // of other e2e runs; this targeted test must actually exercise the wrapper.
  delete process.env.LIVE_REFRESH_DISABLED;

  const stamp = Date.now();
  const tournSlug = `test.live-refresh-${stamp}`;
  let tournId = "";
  let matchId = "";

  try {
    const [t] = await db
      .insert(tournamentsTable)
      .values({
        slug: tournSlug,
        nameEn: `Live Refresh Test ${stamp}`,
        nameAr: `اختبار التحديث ${stamp}`,
        type: "league",
        status: "active",
        season: "2026",
        competitionSlug: tournSlug,
        providerLeagueSlug: tournSlug,
        hasPublishedFixtures: true,
        countryCode: "TS",
      })
      .returning({ id: tournamentsTable.id });
    tournId = t.id;

    // A match that is "live" (so the necessity gate passes) and kicked off 2h ago.
    // Its updated_at defaults to now, which pins MAX(updated_at) for the gate test.
    const [m] = await db
      .insert(matchesTable)
      .values({
        tournamentId: tournId,
        kickoffAt: new Date(stamp - 2 * 60 * 60 * 1000),
        status: "live",
        minute: 76,
        externalId: `test:live-refresh:${stamp}`,
      })
      .returning({ id: matchesTable.id });
    matchId = m.id;

    // --- Case 1: REAL gate skips a just-synced (fresh) dataset ---
    console.log("\nReal staleness gate (fresh data → skip):");
    delete process.env.LIVE_REFRESH_MIN_INTERVAL_MS;
    delete process.env.LIVE_REFRESH_MAX_WAIT_MS;
    const f1 = makeFake(10); // real gate (no injection)
    await maybeRefreshLiveMatches(f1.fn);
    check("fresh data → cycle NOT run", f1.state.calls === 0, `calls=${f1.state.calls}`);

    // --- Case 2: gate says due → refresh runs once ---
    console.log("\nGate due → refresh runs:");
    const f2 = makeFake(10);
    await maybeRefreshLiveMatches(f2.fn, ALWAYS);
    check("due → cycle ran once", f2.state.calls === 1, `calls=${f2.state.calls}`);

    // --- Case 3: single-flight under concurrency ---
    console.log("\nSingle-flight (concurrent reads):");
    const f3 = makeFake(80);
    await Promise.all([
      maybeRefreshLiveMatches(f3.fn, ALWAYS),
      maybeRefreshLiveMatches(f3.fn, ALWAYS),
      maybeRefreshLiveMatches(f3.fn, ALWAYS),
    ]);
    check(
      "3 concurrent calls → exactly one cycle",
      f3.state.calls === 1,
      `calls=${f3.state.calls}`,
    );
    check(
      "cycles never overlapped",
      f3.state.maxConcurrent <= 1,
      `maxConcurrent=${f3.state.maxConcurrent}`,
    );
    // First cycle has resolved → latch released → a later read refreshes again.
    await maybeRefreshLiveMatches(f3.fn, ALWAYS);
    check(
      "latch released after completion",
      f3.state.calls === 2,
      `calls=${f3.state.calls}`,
    );

    // --- Case 4: bounded wait caps how long the read blocks ---
    console.log("\nBounded wait (slow cycle):");
    process.env.LIVE_REFRESH_MAX_WAIT_MS = "40";
    const f4 = makeFake(300);
    const t0 = Date.now();
    await maybeRefreshLiveMatches(f4.fn, ALWAYS);
    const elapsed = Date.now() - t0;
    check(
      "caller returns before the slow cycle finishes",
      elapsed < 200,
      `elapsed=${elapsed}ms`,
    );
    check("cycle was still started", f4.state.calls === 1, `calls=${f4.state.calls}`);
    await sleep(350); // let the 300ms cycle finish so the latch resets
    delete process.env.LIVE_REFRESH_MAX_WAIT_MS;

    // --- Case 5: rejecting cycle is best-effort, never throws, resets latch ---
    console.log("\nBest-effort on failure:");
    const f5 = makeFake(10, { reject: true });
    let threw = false;
    try {
      await maybeRefreshLiveMatches(f5.fn, ALWAYS);
    } catch {
      threw = true;
    }
    check("rejecting cycle does not throw into the read path", !threw);
    await sleep(30); // let the rejected cycle settle + release the latch
    const f5b = makeFake(10);
    await maybeRefreshLiveMatches(f5b.fn, ALWAYS);
    check(
      "latch resets after a failed cycle",
      f5b.state.calls === 1,
      `calls=${f5b.state.calls}`,
    );
  } finally {
    console.log("\nTeardown:");
    const safe = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.warn(`  teardown ${label} failed:`, err);
      }
    };
    if (matchId) {
      await safe("match", () =>
        db.delete(matchesTable).where(eq(matchesTable.id, matchId)),
      );
    }
    if (tournId) {
      await safe("tournament", () =>
        db.delete(tournamentsTable).where(eq(tournamentsTable.id, tournId)),
      );
    }
    delete process.env.LIVE_REFRESH_MAX_WAIT_MS;
    await safe("pool end", () => pool.end());
  }

  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`Live-refresh wrapper: ALL ${passed} checks passed.`);
  } else {
    console.error(
      `Live-refresh wrapper: ${failures.length} FAILED, ${passed} passed.`,
    );
    for (const f of failures) console.error(`  - ${f}`);
  }
  console.log("=".repeat(60));
}

main()
  .then(() => {
    process.exit(failures.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("Live-refresh wrapper crashed:", err);
    process.exit(1);
  });
