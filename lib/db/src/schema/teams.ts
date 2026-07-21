import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamKindEnum } from "./enums";

// Teams referenced by matches. Bilingual names, flag/badge artwork.
export const teamsTable = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    code: text("code"),
    flagUrl: text("flag_url"),
    countryCode: text("country_code"),
    // National team (World Championship / favourite-team picker) vs domestic club
    // (favourite-club picker). Defaults to "national" so existing rows keep
    // their meaning and the legacy national picker (GET /teams) is unaffected.
    kind: teamKindEnum("kind").notNull().default("national"),
    // For club teams: the competition the club primarily belongs to (e.g.
    // "eng.1"), used to group clubs by league in the favourite-club picker.
    primaryCompetitionSlug: text("primary_competition_slug"),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("teams_code_idx").on(table.code),
    index("teams_kind_idx").on(table.kind),
    index("teams_primary_competition_idx").on(table.primaryCompetitionSlug),
  ],
);

export const insertTeamSchema = createInsertSchema(teamsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teamsTable.$inferSelect;
