import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { createInsertSchema } from "drizzle-zod";
import { planCodeEnum, subscriptionStatusEnum } from "./enums";
import { usersTable } from "./users";

// World Cup Pass plans (edition-based, not monthly/yearly).
// Free (المبتدئ) / Professional (المحترف) / Legend (الأسطورة) / Business (الأعمال).
export const plansTable = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: planCodeEnum("code").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  priceSar: numeric("price_sar").notNull().default("0"),
  participantLimit: integer("participant_limit"),
  isActive: boolean("is_active").notNull().default(true),
  isComingSoon: boolean("is_coming_soon").notNull().default(false),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Capability entitlements per plan (e.g. advanced_stats, custom_prizes,
// priority_support, max_participants). Drives Phase-2 enforcement.
export const planEntitlementsTable = pgTable(
  "plan_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plansTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [unique("plan_entitlements_unique").on(table.planId, table.key)],
);

// A user's purchased pass for a given tournament edition.
export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plansTable.id, { onDelete: "restrict" }),
  edition: text("edition"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // Payment provider reference (Moyasar — wired in a later phase).
  paymentProvider: text("payment_provider"),
  paymentReference: text("payment_reference"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
export type PlanEntitlement = typeof planEntitlementsTable.$inferSelect;
export type Subscription = typeof subscriptionsTable.$inferSelect;
