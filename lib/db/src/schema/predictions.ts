import {
  pgTable,
  uuid,
  integer,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { predictionOutcomeEnum } from "./enums";
import { usersTable } from "./users";
import { matchesTable } from "./matches";

// One prediction per user per match. Scored once; the result is surfaced across
// every challenge that includes the match. Edits allowed only before lock.
export const predictionsTable = pgTable(
  "predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    homeScore: integer("home_score").notNull(),
    awayScore: integer("away_score").notNull(),
    outcome: predictionOutcomeEnum("outcome").notNull().default("pending"),
    pointsAwarded: integer("points_awarded").notNull().default(0),
    isRare: boolean("is_rare").notNull().default(false),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("predictions_user_match_unique").on(table.userId, table.matchId),
    index("predictions_match_idx").on(table.matchId),
  ],
);

// Audit trail of every edit before lock (anti-cheating / timestamp logging).
export const predictionHistoryTable = pgTable(
  "prediction_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id")
      .notNull()
      .references(() => predictionsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
    homeScore: integer("home_score").notNull(),
    awayScore: integer("away_score").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("prediction_history_prediction_idx").on(table.predictionId)],
);

export const insertPredictionSchema = createInsertSchema(predictionsTable).omit({
  id: true,
  submittedAt: true,
  updatedAt: true,
});
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;
export type Prediction = typeof predictionsTable.$inferSelect;
export type PredictionHistory = typeof predictionHistoryTable.$inferSelect;
