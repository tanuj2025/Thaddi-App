import {
  pgTable,
  uuid,
  integer,
  numeric,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { createInsertSchema } from "drizzle-zod";
import { rankingScopeEnum } from "./enums";
import { usersTable } from "./users";
import { matchesTable } from "./matches";
import { challengesTable } from "./challenges";
import { predictionsTable } from "./predictions";

// Append-only ledger of every point award (Exact 100 / Winner 50 /
// GoalDiff 30 / Submitted 10 / None 0). Standings are derived from this.
export const pointsLedgerTable = pgTable(
  "points_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    challengeId: uuid("challenge_id").references(() => challengesTable.id, {
      onDelete: "cascade",
    }),
    matchId: uuid("match_id").references(() => matchesTable.id, {
      onDelete: "cascade",
    }),
    predictionId: uuid("prediction_id").references(() => predictionsTable.id, {
      onDelete: "set null",
    }),
    points: integer("points").notNull().default(0),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("points_ledger_user_idx").on(table.userId),
    index("points_ledger_challenge_idx").on(table.challengeId),
  ],
);

// Snapshot rankings to support rank movement (challenge / global / saudi).
export const rankingsTable = pgTable(
  "rankings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: rankingScopeEnum("scope").notNull(),
    challengeId: uuid("challenge_id").references(() => challengesTable.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    previousRank: integer("previous_rank"),
    points: integer("points").notNull().default(0),
    accuracy: numeric("accuracy"),
    exactPredictions: integer("exact_predictions").notNull().default(0),
    totalPredictions: integer("total_predictions").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rankings_scope_idx").on(table.scope),
    index("rankings_challenge_idx").on(table.challengeId),
    index("rankings_user_idx").on(table.userId),
  ],
);

export const insertPointsLedgerSchema = createInsertSchema(
  pointsLedgerTable,
).omit({ id: true, createdAt: true });
export type InsertPointsLedger = z.infer<typeof insertPointsLedgerSchema>;
export type PointsLedgerEntry = typeof pointsLedgerTable.$inferSelect;
export type Ranking = typeof rankingsTable.$inferSelect;
