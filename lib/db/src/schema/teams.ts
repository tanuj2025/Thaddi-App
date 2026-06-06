import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("teams_code_idx").on(table.code)],
);

export const insertTeamSchema = createInsertSchema(teamsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teamsTable.$inferSelect;
