// Opportunistic, request-driven match refresh.
//
// WHY THIS EXISTS: production runs on Replit Autoscale (.replit
// deploymentTarget = "autoscale"). On autoscale the instance is suspended
// between requests, so the self-scheduling setTimeout loop in scheduler.ts never
// ticks — match data freezes at whatever the boot-time "Startup sync" wrote, and
// a finished match keeps showing as "live" until the next cold boot. Reads are
// the only thing that wakes an autoscale instance, so we piggy-back a throttled
// sync onto the match/ranking read endpoints: the act of someone viewing the
// app keeps the data fresh.
//
// Design:
//   - Necessity gate: only sync when a match is in progress (live/half_time) or
//     a scheduled match is overdue to start (kickoff passed within the last 4h).
//     Otherwise idle reads cost nothing meaningful.
//   - Staleness gate: MAX(matches.updated_at) is a free "last sync" marker
//     (every sync upserts all matches), so we skip when the freshest data is
//     younger than LIVE_REFRESH_MIN_INTERVAL_MS. This throttles across ALL
//     instances (it's read from the shared DB), giving a ~6s live cadence.
//   - Concurrency: an in-process `inFlight` flag prevents one instance from
//     launching overlapping syncs. Two different instances racing simply
//     serialize on the football advisory xact lock inside the sync cycle — the
//     redundant run is harmless (idempotent upserts), so no session-level
//     advisory lock (which is unsafe over a pooled connection) is needed.
//   - We AWAIT the cycle (bounded by LIVE_REFRESH_MAX_WAIT_MS) rather than
//     fire-and-forget: on autoscale the instance can be frozen the moment a
//     response is sent, which would kill a detached background sync. Awaiting
//     keeps the request in-flight (and the instance alive) until the sync
//     completes, and also makes the triggering read itself return fresh data.
//     The wait is capped so a slow provider can never hang the read path (the
//     provider fetch is independently bounded at 15s).

import { and, eq, gt, inArray, lte, max } from "drizzle-orm";
import { db, matchesTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { runMatchSyncCycle } from "./scheduler";

const LIVE_STATUSES = ["live", "half_time"] as const;

// How long a match may be "overdue to start" and still trigger a refresh, so we
// promptly flip a stale `scheduled` row to `live` after kickoff.
const OVERDUE_WINDOW_MS = 4 * 60 * 60 * 1000;

function intervalFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

// Minimum gap between opportunistic syncs (DB-coordinated via MAX(updated_at)).
// Read at call time (not module load) so tests can flip the throttle per case.
function minIntervalMs(): number {
  return intervalFromEnv("LIVE_REFRESH_MIN_INTERVAL_MS", 6_000);
}
// Hard cap on how long a triggering read will block on the inline sync before
// responding with whatever data it has.
function maxWaitMs(): number {
  return intervalFromEnv("LIVE_REFRESH_MAX_WAIT_MS", 9_000);
}

let inFlight = false;

// Decide whether a refresh is both NEEDED (something live/overdue) and DUE
// (freshest data older than the throttle window). Cheap, status-indexed queries.
async function shouldRefresh(): Promise<boolean> {
  const now = new Date();

  // Necessity (cheapest first): any match in progress?
  const live = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(inArray(matchesTable.status, [...LIVE_STATUSES]))
    .limit(1);

  let necessary = live.length > 0;
  if (!necessary) {
    // ...or a scheduled match overdue to kick off (so we flip it to live).
    const overdue = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(
        and(
          eq(matchesTable.status, "scheduled"),
          lte(matchesTable.kickoffAt, now),
          gt(matchesTable.kickoffAt, new Date(now.getTime() - OVERDUE_WINDOW_MS)),
        ),
      )
      .limit(1);
    necessary = overdue.length > 0;
  }
  if (!necessary) return false;

  // Staleness: skip if we synced within the throttle window (any instance).
  const [agg] = await db
    .select({ lastSync: max(matchesTable.updatedAt) })
    .from(matchesTable);
  const last = agg?.lastSync ? new Date(agg.lastSync as Date | string).getTime() : 0;
  return Date.now() - last >= minIntervalMs();
}

// Best-effort: trigger a throttled sync+score cycle from a read endpoint. Never
// throws — a refresh failure must never break the read it is attached to. The
// cycle and the gate are injectable so tests can drive the single-flight /
// bounded-wait wrapper deterministically without a real provider sync or a
// DB-state-dependent gate; production always uses runMatchSyncCycle/shouldRefresh.
export async function maybeRefreshLiveMatches(
  runCycle: () => Promise<void> = runMatchSyncCycle,
  shouldRun: () => Promise<boolean> = shouldRefresh,
): Promise<void> {
  // Test opt-out: unrelated e2e suites boot the real app and hit read routes, so
  // a real provider sync firing mid-test could prune their seeded fixtures.
  // Production never sets this; the targeted liveRefresh test unsets it.
  if (process.env.LIVE_REFRESH_DISABLED === "1") return;

  if (inFlight) return;

  let proceed = false;
  try {
    proceed = await shouldRun();
  } catch (err) {
    logger.error({ err }, "Live-refresh gate query failed");
    return;
  }
  // Re-check inFlight after the awaited gate: a concurrent caller may have
  // started a sync while we were querying. Setting the flag below is synchronous
  // (no await between the check and the assignment), so only one caller wins.
  if (!proceed || inFlight) return;
  inFlight = true;

  // Keep `inFlight` true until the ACTUAL cycle finishes (even if it outlives
  // our bounded wait), so a slow sync can't be double-launched on this instance.
  const cycle = runCycle()
    .catch((err) => logger.error({ err }, "Opportunistic live refresh failed"))
    .finally(() => {
      inFlight = false;
    });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxWaitMs());
  });
  try {
    await Promise.race([cycle, cap]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
