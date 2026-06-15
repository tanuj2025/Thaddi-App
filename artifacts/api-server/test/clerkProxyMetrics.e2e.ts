/**
 * Clerk sign-in proxy failure metrics — aggregation regression test.
 *
 * The proxy records each real upstream failure into `analytics_events`
 * (type = clerk_proxy_error) so the admin breakdown survives across autoscale
 * instances and beyond log retention. This test seeds a known set of those rows
 * directly, runs the real `computeClerkProxyMetrics` aggregation, and asserts the
 * breakdown by error code / retry disposition / method plus the degraded-callback
 * count — all measured as DELTAS against a baseline so any pre-existing rows in
 * the dev DB don't skew the assertions. Every seeded row is deleted at the end,
 * leaving the DB exactly as found.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db, pool, analyticsEventsTable } from "@workspace/db";
import { computeClerkProxyMetrics } from "../src/lib/analytics";

function pct(items: { label: string; count: number }[], label: string): number {
  return items.find((i) => i.label === label)?.count ?? 0;
}

async function main() {
  const insertedIds: string[] = [];

  try {
    // Baseline: whatever clerk_proxy_error rows already exist in the window.
    const before = await computeClerkProxyMetrics(30);

    // Seed a deterministic set of failures:
    //   3x ECONNRESET POST callbacks, NOT retried, degraded (the Apple risk)
    //   2x ECONNREFUSED GET, retried (idempotent pre-connect)
    //   1x ETIMEDOUT POST, NOT retried, but NOT a browser navigation (not degraded)
    const rows = [
      { code: "ECONNRESET", willRetry: false, method: "POST", degraded: true },
      { code: "ECONNRESET", willRetry: false, method: "POST", degraded: true },
      { code: "ECONNRESET", willRetry: false, method: "POST", degraded: true },
      { code: "ECONNREFUSED", willRetry: true, method: "GET", degraded: false },
      { code: "ECONNREFUSED", willRetry: true, method: "GET", degraded: false },
      { code: "ETIMEDOUT", willRetry: false, method: "POST", degraded: false },
    ];

    const inserted = await db
      .insert(analyticsEventsTable)
      .values(
        rows.map((r) => ({
          type: "clerk_proxy_error" as const,
          metadata: r,
        })),
      )
      .returning({ id: analyticsEventsTable.id });
    insertedIds.push(...inserted.map((r) => r.id));

    const after = await computeClerkProxyMetrics(30);

    // Totals (delta).
    assert.equal(after.totalErrors - before.totalErrors, 6, "totalErrors delta");
    assert.equal(
      after.retriedErrors - before.retriedErrors,
      2,
      "retriedErrors delta",
    );
    assert.equal(
      after.degradedCallbacks - before.degradedCallbacks,
      3,
      "degradedCallbacks delta",
    );

    // Breakdown by error code (delta).
    assert.equal(
      pct(after.byCode, "ECONNRESET") - pct(before.byCode, "ECONNRESET"),
      3,
      "byCode ECONNRESET delta",
    );
    assert.equal(
      pct(after.byCode, "ECONNREFUSED") - pct(before.byCode, "ECONNREFUSED"),
      2,
      "byCode ECONNREFUSED delta",
    );
    assert.equal(
      pct(after.byCode, "ETIMEDOUT") - pct(before.byCode, "ETIMEDOUT"),
      1,
      "byCode ETIMEDOUT delta",
    );

    // Breakdown by retry disposition (delta).
    assert.equal(
      pct(after.byWillRetry, "retried") - pct(before.byWillRetry, "retried"),
      2,
      "byWillRetry retried delta",
    );
    assert.equal(
      pct(after.byWillRetry, "not_retried") -
        pct(before.byWillRetry, "not_retried"),
      4,
      "byWillRetry not_retried delta",
    );

    // Breakdown by HTTP method (delta).
    assert.equal(
      pct(after.byMethod, "POST") - pct(before.byMethod, "POST"),
      4,
      "byMethod POST delta",
    );
    assert.equal(
      pct(after.byMethod, "GET") - pct(before.byMethod, "GET"),
      2,
      "byMethod GET delta",
    );

    // Daily trend totals reflect the seeded rows (today's bucket got +6/+3).
    const dailyTotalDelta =
      after.daily.reduce((a, d) => a + d.total, 0) -
      before.daily.reduce((a, d) => a + d.total, 0);
    const dailyDegradedDelta =
      after.daily.reduce((a, d) => a + d.degraded, 0) -
      before.daily.reduce((a, d) => a + d.degraded, 0);
    assert.equal(dailyTotalDelta, 6, "daily total delta");
    assert.equal(dailyDegradedDelta, 3, "daily degraded delta");

    console.log("clerkProxyMetrics.e2e: OK");
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
