import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  userRoleEnum,
  userStatusEnum,
  gamificationLevelEnum,
} from "./enums";

// Core account. Authentication (email/password, Google, Apple, email
// verification) is owned by Clerk; clerkUserId links the local record to the
// Clerk identity. Mobile verification is handled separately via Authentica.
export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email"),
    emailVerified: boolean("email_verified").notNull().default(false),
    // Private — never exposed publicly.
    realName: text("real_name"),
    mobileNumber: text("mobile_number").unique(),
    mobileVerified: boolean("mobile_verified").notNull().default(false),
    role: userRoleEnum("role").notNull().default("user"),
    status: userStatusEnum("status").notNull().default("active"),
    level: gamificationLevelEnum("level").notNull().default("bronze"),
    totalPoints: integer("total_points").notNull().default(0),
    countryCode: text("country_code").default("SA"),
    // Referral tracking (no rewards program — analytics only).
    invitedByUserId: uuid("invited_by_user_id"),
    joinedViaLink: text("joined_via_link"),
    joinedViaCode: text("joined_via_code"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("users_email_idx").on(table.email),
    index("users_invited_by_idx").on(table.invitedByUserId),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
