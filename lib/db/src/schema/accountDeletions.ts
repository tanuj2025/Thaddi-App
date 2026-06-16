import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// Tombstone of deleted accounts, keyed by the Clerk user id. On account deletion
// the local `users` row is hard-deleted (FK cascade removes all dependent data),
// so there is no row left to mark. This record outlives it: a Clerk session
// token stays signature-valid until its short expiry, and JIT provisioning would
// otherwise re-create a fresh local user on the next authenticated read. The
// tombstone lets `getOrProvisionUser` refuse to re-provision a deleted account.
export const accountDeletionsTable = pgTable("account_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AccountDeletion = typeof accountDeletionsTable.$inferSelect;
