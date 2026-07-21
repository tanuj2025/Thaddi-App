import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  challengeTypeEnum,
  challengeVisibilityEnum,
  challengeScopeEnum,
  challengeEndConditionEnum,
  challengeStatusEnum,
  predictionVisibilityEnum,
  participantStatusEnum,
  joinRequestStatusEnum,
  messageReportStatusEnum,
} from "./enums";
import { usersTable } from "./users";
import { tournamentsTable, stagesTable } from "./tournaments";
import { teamsTable } from "./teams";
import { matchesTable } from "./matches";

// Reusable challenge templates (World Championship, Saudi matches, Group Stage, ...).
export const challengeTemplatesTable = pgTable("challenge_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  descriptionEn: text("description_en"),
  descriptionAr: text("description_ar"),
  scope: challengeScopeEnum("scope").notNull().default("custom"),
  config: jsonb("config"),
  isActive: boolean("is_active").notNull().default(true),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A competition created by a user. Generic scope across any tournament.
export const challengesTable = pgTable(
  "challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    type: challengeTypeEnum("type").notNull().default("friends"),
    visibility: challengeVisibilityEnum("visibility")
      .notNull()
      .default("private"),
    scope: challengeScopeEnum("scope").notNull().default("entire_tournament"),
    templateId: uuid("template_id").references(
      () => challengeTemplatesTable.id,
      { onDelete: "set null" },
    ),
    tournamentId: uuid("tournament_id").references(() => tournamentsTable.id, {
      onDelete: "set null",
    }),
    stageId: uuid("stage_id").references(() => stagesTable.id, {
      onDelete: "set null",
    }),
    teamId: uuid("team_id").references(() => teamsTable.id, {
      onDelete: "set null",
    }),
    inviteCode: text("invite_code").unique(),
    inviteLink: text("invite_link"),
    endCondition: challengeEndConditionEnum("end_condition")
      .notNull()
      .default("tournament_ends"),
    endDate: timestamp("end_date", { withTimezone: true }),
    predictionVisibility: predictionVisibilityEnum("prediction_visibility")
      .notNull()
      .default("reveal_after_kickoff"),
    participantLimit: integer("participant_limit"),
    status: challengeStatusEnum("status").notNull().default("active"),
    // Referral tracking for growth analytics.
    createdViaCode: text("created_via_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("challenges_owner_idx").on(table.ownerId),
    index("challenges_visibility_idx").on(table.visibility),
    index("challenges_status_idx").on(table.status),
  ],
);

// Members of a challenge, with per-challenge standing and referral attribution.
export const challengeParticipantsTable = pgTable(
  "challenge_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challengesTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: participantStatusEnum("status").notNull().default("active"),
    points: integer("points").notNull().default(0),
    rank: integer("rank"),
    exactPredictions: integer("exact_predictions").notNull().default(0),
    totalPredictions: integer("total_predictions").notNull().default(0),
    invitedByUserId: uuid("invited_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    joinedViaLink: text("joined_via_link"),
    joinedViaCode: text("joined_via_code"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("challenge_participants_unique").on(
      table.challengeId,
      table.userId,
    ),
    index("challenge_participants_user_idx").on(table.userId),
  ],
);

// Per-challenge assistants: participants the owner promotes to help manage
// members. Scoped to a single challenge — being an assistant here grants no
// rights elsewhere. The composite FK to challenge_participants guarantees the
// assistant is an existing participant and clears the role automatically when
// that participant is removed (their participant row is deleted).
export const challengeAssistantsTable = pgTable(
  "challenge_assistants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challengesTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    assignedByUserId: uuid("assigned_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("challenge_assistants_unique").on(table.challengeId, table.userId),
    index("challenge_assistants_user_idx").on(table.userId),
    foreignKey({
      columns: [table.challengeId, table.userId],
      foreignColumns: [
        challengeParticipantsTable.challengeId,
        challengeParticipantsTable.userId,
      ],
      name: "challenge_assistants_participant_fk",
    }).onDelete("cascade"),
  ],
);

// Explicit match selection for custom-scope challenges.
export const challengeMatchesTable = pgTable(
  "challenge_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challengesTable.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matchesTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    unique("challenge_matches_unique").on(table.challengeId, table.matchId),
  ],
);

// Custom prize tiers configured by the challenge owner (Professional+).
export const challengePrizesTable = pgTable("challenge_prizes", {
  id: uuid("id").primaryKey().defaultRandom(),
  challengeId: uuid("challenge_id")
    .notNull()
    .references(() => challengesTable.id, { onDelete: "cascade" }),
  place: integer("place").notNull(),
  titleEn: text("title_en"),
  titleAr: text("title_ar"),
  description: text("description"),
  value: numeric("value"),
  currency: text("currency").default("SAR"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Per-challenge text & emoji chat. Soft-deletable for moderation.
export const challengeMessagesTable = pgTable(
  "challenge_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challengesTable.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByUserId: uuid("deleted_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("challenge_messages_challenge_idx").on(
      table.challengeId,
      table.createdAt,
    ),
  ],
);

// User reports of abusive chat messages (Apple Guideline 1.2 moderation).
// A reporter flags a message once; the owner/admin reviews and acts (the chat is
// already soft-deletable by owners/assistants). Unique per (message, reporter)
// makes reporting idempotent.
export const messageReportsTable = pgTable(
  "message_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challengesTable.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => challengeMessagesTable.id, { onDelete: "cascade" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reason: text("reason"),
    status: messageReportStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("message_reports_message_reporter_unique").on(
      table.messageId,
      table.reporterId,
    ),
    index("message_reports_status_idx").on(table.status, table.createdAt),
  ],
);

// Join requests for private challenges. A non-member sends a request; the
// owner approves or declines. Approved requests run through the standard join
// flow (respecting participant pool limits).
export const challengeJoinRequestsTable = pgTable(
  "challenge_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => challengesTable.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: joinRequestStatusEnum("status").notNull().default("pending"),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("challenge_join_requests_unique").on(
      table.challengeId,
      table.requesterId,
    ),
    index("challenge_join_requests_challenge_idx").on(
      table.challengeId,
      table.status,
    ),
    index("challenge_join_requests_requester_idx").on(table.requesterId),
  ],
);
export type ChallengeJoinRequest =
  typeof challengeJoinRequestsTable.$inferSelect;

export const insertChallengeSchema = createInsertSchema(challengesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertChallenge = z.infer<typeof insertChallengeSchema>;
export type Challenge = typeof challengesTable.$inferSelect;
export type ChallengeParticipant =
  typeof challengeParticipantsTable.$inferSelect;
export type ChallengeAssistant =
  typeof challengeAssistantsTable.$inferSelect;
export type ChallengeTemplate = typeof challengeTemplatesTable.$inferSelect;
export type ChallengePrize = typeof challengePrizesTable.$inferSelect;
export type ChallengeMessage = typeof challengeMessagesTable.$inferSelect;
export type MessageReport = typeof messageReportsTable.$inferSelect;
