import { and, eq, sql } from "drizzle-orm";
import { db, challengesTable, challengeParticipantsTable } from "@workspace/db";

// Transaction client type derived from db.transaction's callback parameter.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Either the pooled db handle or an open transaction client.
type DbOrTx = typeof db | Tx;

// Advisory-lock namespace for serializing participant-pool checks per owner.
// Uses the TWO-key advisory-lock space (int4, int4) via
// pg_advisory_xact_lock(ns, hashtext(ownerId)), which is a separate lock space
// from the single-key football lock (FOOTBALL_LOCK_KEY), so the two never
// collide. The lock is held for the lifetime of the surrounding transaction.
export const PARTICIPANT_POOL_LOCK_NS = 471707;

// Acquire the per-owner participant-pool lock so concurrent joins / challenge
// creations for the SAME owner are serialized and cannot exceed the shared pool.
// Must be called with a transaction client.
export async function acquireOwnerPoolLock(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  ownerId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${PARTICIPANT_POOL_LOCK_NS}, hashtext(${ownerId}))`,
  );
}

// Count active participants across EVERY challenge owned by `ownerId`. This is
// the owner's shared participant budget usage (the owner's own auto-added seat
// in each challenge counts toward it). Accepts the pooled db or a tx so it can
// be used both for read-only displays and inside an enforcement transaction.
export async function countActiveParticipantsForOwner(
  client: DbOrTx,
  ownerId: string,
): Promise<number> {
  const [row] = await client
    .select({ value: sql<number>`cast(count(*) as int)` })
    .from(challengeParticipantsTable)
    .innerJoin(
      challengesTable,
      eq(challengesTable.id, challengeParticipantsTable.challengeId),
    )
    .where(
      and(
        eq(challengesTable.ownerId, ownerId),
        eq(challengeParticipantsTable.status, "active"),
      ),
    );
  return row?.value ?? 0;
}
