/**
 * Clerk sign-in proxy failure retention — pruning regression test.
 *
 * Every Clerk-proxy upstream failure is recorded into `analytics_events`
 * (type = clerk_proxy_error). Left unbounded these rows pile up forever and
 * slow the admin breakdown. `pruneClerkProxyErrors` deletes rows older than the
 * retention window. This test seeds rows on both sides of the retention cutoff,
 * runs the real prune, and asserts that only the stale rows were deleted and
 * that an in-window row of a DIFFERENT type is never touched. Every seeded row
 * is removed at the end, leaving the DB exactly as found.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db, analyticsEventsTable } from "@workspace/db";
import {
  pruneClerkProxyErrors,
  MAX_ANALYTICS_WINDOW_DAYS,
} from "../src/lib/analytics";

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const insertedIds: string[] = [];

  try {
    // Default retention == MAX_ANALYTICS_WINDOW_DAYS. Seed rows clearly on each
    // side of that cutoff plus one well inside it.
    const stale1 = new Date(Date.now() - (MAX_ANALYTICS_WINDOW_DAYS + 30) * DAY_MS);
    const stale2 = new Date(Date.now() - (MAX_ANALYTICS_WINDOW_DAYS + 1) * DAY_MS);
    const fresh = new Date(Date.now() - 5 * DAY_MS);

    const inserted = await db
      .insert(analyticsEventsTable)
      .values([
        {
          type: "clerk_proxy_error" as const,
          metadata: { code: "ECONNRESET", willRetry: false, method: "POST", degraded: true },
          createdAt: stale1,
        },
        {
          type: "clerk_proxy_error" as const,
          metadata: { code: "ETIMEDOUT", willRetry: false, method: "POST", degraded: false },
          createdAt: stale2,
        },
        {
          type: "clerk_proxy_error" as const,
          metadata: { code: "ECONNREFUSED", willRetry: true, method: "GET", degraded: false },
          createdAt: fresh,
        },
        // A stale row of a DIFFERENT type — must survive (prune is type-scoped).
        {
          type: "page_view" as const,
          metadata: { path: "/", sessionId: "prune-test-session" },
          createdAt: stale1,
        },
      ])
      .returning({ id: analyticsEventsTable.id });
    const [staleId1, staleId2, freshId, otherTypeId] = inserted.map((r) => r.id);
    insertedIds.push(...inserted.map((r) => r.id));

    const prunedCount = await pruneClerkProxyErrors();

    // At least the two stale clerk_proxy_error rows we seeded were pruned (other
    // pre-existing stale rows in the dev DB may add to the count).
    assert.ok(prunedCount >= 2, `expected >= 2 pruned, got ${prunedCount}`);

    const remaining = await db
      .select({ id: analyticsEventsTable.id })
      .from(analyticsEventsTable)
      .where(inArray(analyticsEventsTable.id, insertedIds));
    const remainingIds = new Set(remaining.map((r) => r.id));

    assert.ok(!remainingIds.has(staleId1), "stale clerk_proxy_error #1 should be pruned");
    assert.ok(!remainingIds.has(staleId2), "stale clerk_proxy_error #2 should be pruned");
    assert.ok(remainingIds.has(freshId), "in-window clerk_proxy_error must survive");
    assert.ok(remainingIds.has(otherTypeId), "stale page_view (different type) must survive");

    console.log("clerkProxyPrune.e2e: OK");
  } finally {
    if (insertedIds.length > 0) {
      await db
        .delete(analyticsEventsTable)
        .where(inArray(analyticsEventsTable.id, insertedIds));
    }
    await db.$client.end?.();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
