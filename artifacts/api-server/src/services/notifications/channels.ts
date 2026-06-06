import { db, notificationsTable } from "@workspace/db";
import { logger } from "../../lib/logger";
import type { NotificationType, RenderedNotification, NotificationData } from "./render";

export interface NotificationContext {
  userId: string;
  recipientEmail: string | null;
  type: NotificationType;
  content: RenderedNotification;
  data: NotificationData;
}

export interface NotificationChannel {
  readonly name: string;
  send(ctx: NotificationContext): Promise<void>;
}

// Writes the notification to the in-app feed. This is the only channel that
// creates feed rows (so unread-count reflects the in-app inbox).
class InAppChannel implements NotificationChannel {
  readonly name = "in_app";
  async send(ctx: NotificationContext): Promise<void> {
    await db.insert(notificationsTable).values({
      userId: ctx.userId,
      type: ctx.type,
      channel: "in_app",
      titleEn: ctx.content.titleEn,
      titleAr: ctx.content.titleAr,
      bodyEn: ctx.content.bodyEn,
      bodyAr: ctx.content.bodyAr,
      data: ctx.data as Record<string, unknown>,
    });
  }
}

// Sends email via Resend's REST API. Gracefully skips (with an explicit log)
// when not configured — never a silent fallback.
class EmailChannel implements NotificationChannel {
  readonly name = "email";
  async send(ctx: NotificationContext): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.NOTIFICATIONS_FROM_EMAIL;
    if (!apiKey || !from) {
      logger.info(
        { type: ctx.type, userId: ctx.userId, reason: !apiKey ? "no RESEND_API_KEY" : "no NOTIFICATIONS_FROM_EMAIL" },
        "email channel skipped (not configured)",
      );
      return;
    }
    if (!ctx.recipientEmail) {
      logger.info(
        { type: ctx.type, userId: ctx.userId },
        "email channel skipped (no recipient email)",
      );
      return;
    }
    // Bilingual email: English first, Arabic (RTL) below.
    const subject = `${ctx.content.titleEn} · ${ctx.content.titleAr}`;
    const html = [
      `<div style="font-family:sans-serif">`,
      `<h2>${ctx.content.titleEn}</h2>`,
      ctx.content.bodyEn ? `<p>${ctx.content.bodyEn}</p>` : "",
      `<hr/>`,
      `<div dir="rtl"><h2>${ctx.content.titleAr}</h2>`,
      ctx.content.bodyAr ? `<p>${ctx.content.bodyAr}</p>` : "",
      `</div></div>`,
    ].join("");
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: ctx.recipientEmail,
          subject,
          html,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error(
          { status: res.status, body: text, type: ctx.type, userId: ctx.userId },
          "email channel send failed",
        );
      }
    } catch (err) {
      logger.error({ err, type: ctx.type, userId: ctx.userId }, "email channel error");
    }
  }
}

export const inAppChannel = new InAppChannel();
export const emailChannel = new EmailChannel();
