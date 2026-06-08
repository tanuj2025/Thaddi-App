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

// Writes the notification to the in-app feed.
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

function buildEmailHtml(content: RenderedNotification): string {
  const appUrl = process.env.THADDI_APP_URL ?? "";
  const logoUrl = appUrl ? `${appUrl}/logo-transparent.png` : "";
  const ctaUrl = content.ctaUrl ?? "";
  const ctaLabelEn = content.ctaLabelEn ?? "";
  const ctaLabelAr = content.ctaLabelAr ?? "";

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="thaddi" width="60" height="60" style="display:block;margin:0 auto 16px;border-radius:12px">`
    : "";

  const ctaBlockEn =
    ctaUrl && ctaLabelEn
      ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:24px;padding:13px 28px;background-color:#D4A853;color:#0F1117;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;text-decoration:none;border-radius:8px">${ctaLabelEn}</a>`
      : "";

  const ctaBlockAr =
    ctaUrl && ctaLabelAr
      ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:24px;padding:13px 28px;background-color:#D4A853;color:#0F1117;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;text-decoration:none;border-radius:8px">${ctaLabelAr}</a>`
      : "";

  const bodyEnBlock = content.bodyEn
    ? `<p style="margin:0 0 0;color:#9CA3AF;font-size:15px;line-height:1.7;font-family:Helvetica,Arial,sans-serif">${content.bodyEn}</p>`
    : "";

  const bodyArBlock = content.bodyAr
    ? `<p style="margin:0;color:#9CA3AF;font-size:15px;line-height:1.7;font-family:Helvetica,Arial,sans-serif">${content.bodyAr}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0F1117">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0F1117;padding:32px 16px">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#1A1D26;border-radius:16px;border:1px solid #2A2D3A">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2A2D3A">
              ${logoBlock}
              <p style="margin:0;color:#D4A853;font-size:12px;font-weight:700;letter-spacing:2px;font-family:Helvetica,Arial,sans-serif">تطبيق تحدي &nbsp;·&nbsp; THADDI APP</p>
            </td>
          </tr>

          <!-- English section (LTR) -->
          <tr>
            <td style="padding:32px 40px;direction:ltr;text-align:left">
              <h1 style="margin:0 0 12px;color:#F0F0F0;font-size:22px;font-weight:700;line-height:1.3;font-family:Helvetica,Arial,sans-serif">${content.titleEn}</h1>
              ${bodyEnBlock}
              ${ctaBlockEn}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px">
              <div style="height:1px;background-color:#2A2D3A"></div>
            </td>
          </tr>

          <!-- Arabic section (RTL) -->
          <tr>
            <td style="padding:32px 40px;direction:rtl;text-align:right">
              <h1 style="margin:0 0 12px;color:#F0F0F0;font-size:22px;font-weight:700;line-height:1.3;font-family:Helvetica,Arial,sans-serif">${content.titleAr}</h1>
              ${bodyArBlock}
              ${ctaBlockAr}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;text-align:center;border-top:1px solid #2A2D3A">
              <p style="margin:0;color:#4B5563;font-size:12px;font-family:Helvetica,Arial,sans-serif">تطبيق تحدي &nbsp;·&nbsp; thaddi App</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Sends email via Resend. Gracefully skips when not configured.
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
    const fromWithName = from.includes("<")
      ? from
      : `تطبيق تحدي - Thaddi App <${from}>`;
    const subject = `${ctx.content.titleEn} · ${ctx.content.titleAr}`;
    const html = buildEmailHtml(ctx.content);
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
