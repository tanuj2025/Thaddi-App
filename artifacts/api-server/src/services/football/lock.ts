import { sql } from "drizzle-orm";

// Single advisory-lock key for the football domain (tournament sync + scoring).
// Acquiring it inside a transaction serializes those operations so that the
// read-then-write upserts in sync and the delete-then-insert ledger rewrite in
// scoring can never interleave and produce duplicate rows — even under
// concurrent requests or a startup sync racing a refresh call.
export const FOOTBALL_LOCK_KEY = 471706n;

// Acquire the football advisory lock for the lifetime of the surrounding
// transaction. Must be called with a transaction client.
export async function acquireFootballLock(tx: {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
}): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${FOOTBALL_LOCK_KEY})`);
}
