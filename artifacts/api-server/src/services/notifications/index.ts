import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, notificationsTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import { renderNotification, type NotificationType, type NotificationData } from "./render";
import {
  inAppChannel,
  emailChannel,
  type NotificationChannel,
} from "./channels";

// Per-type channel routing. Every product event type is delivered in-app AND
// by email; the email channel itself no-ops with an explicit log when Resend is
// not configured, so it is never a silent fallback. `general` is the only
// in-app-only type (internal/system messages with no email counterpart).
const DISPATCH: Record<NotificationType, NotificationChannel[]> = {
  prediction_closing: [inAppChannel, emailChannel],
  match_starting: [inAppChannel, emailChannel],
  ranking_updated: [inAppChannel, emailChannel],
  competition_ending: [inAppChannel, emailChannel],
  badge_unlocked: [inAppChannel, emailChannel],
  competition_won: [inAppChannel, emailChannel],
  general: [inAppChannel],
};

// Renders and dispatches a notification across its configured channels. Best
// effort: a channel failure is logged but never throws to the caller (scoring
// and refresh flows must not break because a notification could not be sent).
export async function notify(
  userId: string,
  type: NotificationType,
  data: NotificationData = {},
): Promise<void> {
  try {
    const content = renderNotification(type, data);
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, userId),
    });
    const ctx = {
      userId,
      recipientEmail: user?.email ?? null,
      type,
      content,
      data,
    };
    const channels = DISPATCH[type] ?? [inAppChannel];
    for (const ch of channels) {
      try {
        await ch.send(ctx);
      } catch (err) {
        logger.error({ err, channel: ch.name, type, userId }, "notification channel failed");
      }
    }
  } catch (err) {
    logger.error({ err, type, userId }, "notify failed");
  }
}

// Sends a notification only if one of the same type for the same entity key
// does not already exist for the user. Used for one-shot time-based reminders
// (prediction_closing, match_starting, competition_ending) so the refresh
// cycle does not re-notify on every poll. Returns true when it sent.
export async function notifyOnce(
  userId: string,
  type: NotificationType,
  entityKey: "matchId" | "challengeId",
  entityValue: string,
  data: NotificationData = {},
): Promise<boolean> {
  try {
    const existing = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.type, type),
          sql`${notificationsTable.data}->>${entityKey} = ${entityValue}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) return false;
    await notify(userId, type, { ...data, [entityKey]: entityValue });
    return true;
  } catch (err) {
    logger.error({ err, type, userId, entityValue }, "notifyOnce failed");
    return false;
  }
}

export { renderNotification } from "./render";
export type { NotificationType, NotificationData } from "./render";
