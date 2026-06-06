import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  tournamentTypeEnum,
  tournamentStatusEnum,
  stageTypeEnum,
} from "./enums";

// Generic tournament container (World Cup 2026 is seeded data, never hardcoded).
export const tournamentsTable = pgTable(
  "tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    type: tournamentTypeEnum("type").notNull().default("other"),
    season: text("season"),
    status: tournamentStatusEnum("status").notNull().default("upcoming"),
    logoUrl: text("logo_url"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    // Reference to an external sports-data provider (e.g. SportMonks).
    externalProvider: text("external_provider"),
    externalId: text("external_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("tournaments_status_idx").on(table.status)],
);

// Stages within a tournament (group stage, round of 16, final, ...).
export const stagesTable = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: "cascade" }),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    type: stageTypeEnum("type").notNull().default("group"),
    orderIndex: integer("order_index").notNull().default(0),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("stages_tournament_idx").on(table.tournamentId)],
);

export const insertTournamentSchema = createInsertSchema(tournamentsTable).omit(
  { id: true, createdAt: true, updatedAt: true },
);
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Tournament = typeof tournamentsTable.$inferSelect;

export const insertStageSchema = createInsertSchema(stagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStage = z.infer<typeof insertStageSchema>;
export type Stage = typeof stagesTable.$inferSelect;
