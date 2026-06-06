import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { createInsertSchema } from "drizzle-zod";
import { gamificationLevelEnum, achievementTypeEnum } from "./enums";
import { usersTable } from "./users";
import { challengesTable } from "./challenges";

// Reference table of levels and their point thresholds (Bronze..Legend).
export const levelsTable = pgTable("levels", {
  level: gamificationLevelEnum("level").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  minPoints: integer("min_points").notNull().default(0),
  orderIndex: integer("order_index").notNull().default(0),
  iconUrl: text("icon_url"),
});

// Earnable badges (Prediction King, Goal Master, Saudi Expert, Elite Predictor).
export const badgesTable = pgTable("badges", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  iconUrl: text("icon_url"),
  criteria: jsonb("criteria"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userBadgesTable = pgTable(
  "user_badges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => badgesTable.id, { onDelete: "cascade" }),
    awardedAt: timestamp("awarded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("user_badges_unique").on(table.userId, table.badgeId)],
);

// Hall of Fame and other permanent achievements.
export const achievementsTable = pgTable("achievements", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  type: achievementTypeEnum("type").notNull().default("hall_of_fame"),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  iconUrl: text("icon_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userAchievementsTable = pgTable(
  "user_achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    achievementId: uuid("achievement_id")
      .notNull()
      .references(() => achievementsTable.id, { onDelete: "cascade" }),
    challengeId: uuid("challenge_id").references(() => challengesTable.id, {
      onDelete: "set null",
    }),
    awardedAt: timestamp("awarded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("user_achievements_unique").on(
      table.userId,
      table.achievementId,
      table.challengeId,
    ),
  ],
);

export const insertBadgeSchema = createInsertSchema(badgesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBadge = z.infer<typeof insertBadgeSchema>;
export type Level = typeof levelsTable.$inferSelect;
export type Badge = typeof badgesTable.$inferSelect;
export type UserBadge = typeof userBadgesTable.$inferSelect;
export type Achievement = typeof achievementsTable.$inferSelect;
export type UserAchievement = typeof userAchievementsTable.$inferSelect;
