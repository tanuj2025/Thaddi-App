import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { challengesTable } from "./challenges";

// Admin-managed catalog of decorative, purchasable challenge badges. These are
// distinct from earnable gamification badges (`badges`): they are bought with
// real money (Moyasar, SAR) and attached to a specific challenge as decoration.
export const challengeBadgeCatalogTable = pgTable("challenge_badge_catalog", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  iconUrl: text("icon_url").notNull(),
  priceSar: numeric("price_sar").notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A badge purchased for a challenge. The set is shared per-challenge: each badge
// can be bought once per challenge (by the owner or any active participant) and
// is then displayed on the challenge for everyone.
export const challengePurchasedBadgesTable = pgTable(
  "challenge_purchased_badges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challengesTable.id, { onDelete: "cascade" }),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => challengeBadgeCatalogTable.id, { onDelete: "cascade" }),
    purchasedByUserId: uuid("purchased_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    paymentProvider: text("payment_provider"),
    paymentReference: text("payment_reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The shared per-challenge set: a given badge appears at most once per
    // challenge. Backs the onConflictDoNothing idempotency guard in the callback.
    unique("challenge_purchased_badges_unique").on(
      table.challengeId,
      table.badgeId,
    ),
    // Each provider payment can attach at most one badge. Partial so manual rows
    // (null reference) are unconstrained.
    uniqueIndex("challenge_purchased_badges_payment_ref_unique")
      .on(table.paymentProvider, table.paymentReference)
      .where(sql`${table.paymentReference} is not null`),
  ],
);

export const insertChallengeBadgeSchema = createInsertSchema(
  challengeBadgeCatalogTable,
).omit({ id: true, createdAt: true });
export type InsertChallengeBadge = z.infer<typeof insertChallengeBadgeSchema>;
export type ChallengeBadge = typeof challengeBadgeCatalogTable.$inferSelect;
export type ChallengePurchasedBadge =
  typeof challengePurchasedBadgesTable.$inferSelect;
