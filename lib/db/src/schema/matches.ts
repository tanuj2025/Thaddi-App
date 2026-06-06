import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { matchStatusEnum } from "./enums";
import { tournamentsTable, stagesTable } from "./tournaments";
import { teamsTable } from "./teams";

// A single fixture. predictionLockAt is computed (kickoff - 30 min) and is the
// authoritative lock boundary for predictions.
export const matchesTable = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournamentsTable.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").references(() => stagesTable.id, {
      onDelete: "set null",
    }),
    homeTeamId: uuid("home_team_id").references(() => teamsTable.id, {
      onDelete: "set null",
    }),
    awayTeamId: uuid("away_team_id").references(() => teamsTable.id, {
      onDelete: "set null",
    }),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    predictionLockAt: timestamp("prediction_lock_at", { withTimezone: true }),
    status: matchStatusEnum("status").notNull().default("scheduled"),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    minute: integer("minute"),
    venue: text("venue"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("matches_tournament_idx").on(table.tournamentId),
    index("matches_kickoff_idx").on(table.kickoffAt),
    index("matches_status_idx").on(table.status),
  ],
);

export const insertMatchSchema = createInsertSchema(matchesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Match = typeof matchesTable.$inferSelect;
