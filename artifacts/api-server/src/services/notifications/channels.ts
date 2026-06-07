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
    // The brand display name shown as the email sender. We wrap the configured
    // from-address with the display name unless it already carries one.
    const fromWithName = from.includes("<") ? from : `thaddi App <${from}>`;
    // Bilingual email: English first, Arabic (RTL) below. A brand header and
    // footer name the platform in both languages.
    const subject = `${ctx.content.titleEn} · ${ctx.content.titleAr}`;
    const html = [
      `<div style="font-family:sans-serif">`,
      `<p style="font-weight:bold;font-size:18px;margin:0 0 12px">thaddi App · تطبيق تحدي</p>`,
      `<h2>${ctx.content.titleEn}</h2>`,
      ctx.content.bodyEn ? `<p>${ctx.content.bodyEn}</p>` : "",
      `<hr/>`,
      `<div dir="rtl"><h2>${ctx.content.titleAr}</h2>`,
      ctx.content.bodyAr ? `<p>${ctx.content.bodyAr}</p>` : "",
      `</div>`,
      `<hr/>`,
      `<p style="color:#888;font-size:12px;margin:12px 0 0">thaddi App · تطبيق تحدي</p>`,
      `</div>`,
    ].join("");
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromWithName,
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
