import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { friendRequestStatusEnum } from "./enums";
import { usersTable } from "./users";

// One-directional follow graph: a row means `followerId` follows `followeeId`.
// Following is public and requires no approval. Unfollow deletes the row.
export const followsTable = pgTable(
  "follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A user can follow another at most once (insert is idempotent via
    // onConflictDoNothing on this constraint).
    unique("follows_follower_followee_unique").on(
      table.followerId,
      table.followeeId,
    ),
    index("follows_followee_idx").on(table.followeeId),
    check(
      "follows_no_self_follow",
      sql`${table.followerId} <> ${table.followeeId}`,
    ),
  ],
);

// Friend-request lifecycle. A request is directional (requester -> recipient)
// but friendship itself is symmetric (see friendshipsTable). Status is the
// state machine: pending -> accepted | declined | cancelled. Old non-pending
// rows are kept as history and never block a fresh request.
export const friendRequestsTable = pgTable(
  "friend_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: friendRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    // At most one PENDING request between a pair regardless of direction: this
    // blocks both a duplicate A->B and a simultaneous A->B / B->A race. The
    // expression keys on the unordered pair (least, greatest), partial on
    // status='pending' so historical declined/cancelled rows don't constrain.
    uniqueIndex("friend_requests_pending_pair_unique")
      .on(
        sql`least(${table.requesterId}, ${table.recipientId})`,
        sql`greatest(${table.requesterId}, ${table.recipientId})`,
      )
      .where(sql`${table.status} = 'pending'`),
    index("friend_requests_recipient_idx").on(table.recipientId),
    index("friend_requests_requester_idx").on(table.requesterId),
    check(
      "friend_requests_no_self",
      sql`${table.requesterId} <> ${table.recipientId}`,
    ),
  ],
);

// Symmetric friendships, stored once per pair in canonical order
// (userIdA < userIdB) so "are A and B friends" is a single lookup. Created on
// accept (onConflictDoNothing), deleted on unfriend by either party.
export const friendshipsTable = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userIdA: uuid("user_id_a")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    userIdB: uuid("user_id_b")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("friendships_pair_unique").on(table.userIdA, table.userIdB),
    index("friendships_user_b_idx").on(table.userIdB),
    check(
      "friendships_canonical_order",
      sql`${table.userIdA} < ${table.userIdB}`,
    ),
  ],
);

// User-to-user blocks: a row means `blockerId` has blocked `blockedId`. Blocking
// hides the pair's chat messages from each other, tears down any existing
// follow/friend relationship between them, and prevents future social actions.
// Block is one-directional but enforced symmetrically where it matters.
export const userBlocksTable = pgTable(
  "user_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("user_blocks_blocker_blocked_unique").on(
      table.blockerId,
      table.blockedId,
    ),
    index("user_blocks_blocked_idx").on(table.blockedId),
    check(
      "user_blocks_no_self_block",
      sql`${table.blockerId} <> ${table.blockedId}`,
    ),
  ],
);

export const insertFollowSchema = createInsertSchema(followsTable).omit({
  id: true,
  createdAt: true,
});
export const insertFriendRequestSchema = createInsertSchema(
  friendRequestsTable,
).omit({ id: true, createdAt: true, respondedAt: true });
export const insertFriendshipSchema = createInsertSchema(friendshipsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertFollow = z.infer<typeof insertFollowSchema>;
export type Follow = typeof followsTable.$inferSelect;
export type InsertFriendRequest = z.infer<typeof insertFriendRequestSchema>;
export type FriendRequest = typeof friendRequestsTable.$inferSelect;
export type InsertFriendship = z.infer<typeof insertFriendshipSchema>;
export type Friendship = typeof friendshipsTable.$inferSelect;
export type UserBlock = typeof userBlocksTable.$inferSelect;
