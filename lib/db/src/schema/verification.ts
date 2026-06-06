import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { createInsertSchema } from "drizzle-zod";
import { mobileVerificationStatusEnum } from "./enums";
import { usersTable } from "./users";

// Tracks SMS OTP verification attempts. The OTP itself is generated and checked
// by the provider (Authentica); we store the session reference and status only.
export const mobileVerificationsTable = pgTable(
  "mobile_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    status: mobileVerificationStatusEnum("status")
      .notNull()
      .default("pending"),
    provider: text("provider").notNull().default("authentica"),
    providerRef: text("provider_ref"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => [
    index("mobile_verifications_user_idx").on(table.userId),
    index("mobile_verifications_phone_idx").on(table.phoneNumber),
  ],
);

export const insertMobileVerificationSchema = createInsertSchema(
  mobileVerificationsTable,
).omit({ id: true, requestedAt: true });
export type InsertMobileVerification = z.infer<
  typeof insertMobileVerificationSchema
>;
export type MobileVerification = typeof mobileVerificationsTable.$inferSelect;
