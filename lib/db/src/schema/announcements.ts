import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";

// Admin-authored broadcast announcements shown to every user as a dismissible
// banner on their dashboard. Bilingual content stored per record. Dismissal is
// tracked client-side (per user, per announcement id), so the row itself is a
// single shared broadcast rather than one row per recipient.
export const announcementsTable = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    titleEn: text("title_en").notNull(),
    titleAr: text("title_ar").notNull(),
    bodyEn: text("body_en"),
    bodyAr: text("body_ar"),
    // Active announcements are eligible to show; deactivating hides one without
    // deleting it (keeps the audit trail intact).
    isActive: boolean("is_active").notNull().default(true),
    // Optional auto-expiry: past this time the announcement stops showing.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("announcements_active_idx").on(table.isActive)],
);

export const insertAnnouncementSchema = createInsertSchema(
  announcementsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcementsTable.$inferSelect;
