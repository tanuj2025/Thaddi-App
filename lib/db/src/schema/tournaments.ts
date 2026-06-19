import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    // Stable competition grouping shared across seasons (e.g. "eng.1",
    // "fifa.world"). One tournament row = one competition-season; rows with the
    // same competitionSlug are the seasons of a single competition.
    competitionSlug: text("competition_slug"),
    // Provider league slug used to fetch this competition from ESPN (usually
    // identical to competitionSlug, e.g. "eng.1", "ksa.kings.cup").
    providerLeagueSlug: text("provider_league_slug"),
    // False while the provider has not yet published this season's fixtures
    // ("season coming soon"): the competition row exists and is active but has
    // no predictable matches until fixtures are published and auto-attached.
    hasPublishedFixtures: boolean("has_published_fixtures")
      .notNull()
      .default(false),
    // Sort order for the competition list (lower = shown first).
    displayOrder: integer("display_order").notNull().default(0),
    // Country/region this competition belongs to (e.g. "sa", "gb-eng"); null
    // for international competitions like the World Cup.
    countryCode: text("country_code"),
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
  (table) => [
    index("tournaments_status_idx").on(table.status),
    index("tournaments_competition_idx").on(table.competitionSlug),
    // Enforce the single-active-season-per-competition invariant at the DB
    // level: at most one active row may share a competitionSlug. Targeted sync
    // and the season resolvers do findFirst(competitionSlug + isActive), so two
    // active rows would make them nondeterministic. Partial so historical
    // (inactive) seasons and legacy slug-less rows are unconstrained.
    uniqueIndex("tournaments_active_competition_idx")
      .on(table.competitionSlug)
      .where(sql`${table.isActive} AND ${table.competitionSlug} IS NOT NULL`),
  ],
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
