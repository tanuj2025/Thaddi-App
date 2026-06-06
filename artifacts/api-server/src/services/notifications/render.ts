import type { Notification } from "@workspace/db";

export type NotificationType = Notification["type"];

// Free-form structured payload carried with each notification. Renderers read
// only the keys they need; everything is optional so callers can pass minimal
// context.
export interface NotificationData {
  badgeCode?: string;
  badgeNameEn?: string;
  badgeNameAr?: string;
  challengeId?: string;
  challengeName?: string;
  matchId?: string;
  homeEn?: string;
  homeAr?: string;
  awayEn?: string;
  awayAr?: string;
  rank?: number;
  scope?: "challenge" | "global";
  hoursLeft?: number;
  // For `general` notifications the content is supplied directly.
  titleEn?: string;
  titleAr?: string;
  bodyEn?: string;
  bodyAr?: string;
  [key: string]: unknown;
}

export interface RenderedNotification {
  titleEn: string;
  titleAr: string;
  bodyEn: string | null;
  bodyAr: string | null;
}

function matchLabel(d: NotificationData, lang: "en" | "ar"): string {
  if (lang === "en") {
    if (d.homeEn && d.awayEn) return `${d.homeEn} vs ${d.awayEn}`;
  } else if (d.homeAr && d.awayAr) {
    return `${d.homeAr} و ${d.awayAr}`;
  }
  return lang === "en" ? "your match" : "مباراتك";
}

// Produces bilingual title/body for a notification type from its data payload.
export function renderNotification(
  type: NotificationType,
  d: NotificationData,
): RenderedNotification {
  switch (type) {
    case "badge_unlocked":
      return {
        titleEn: "New badge unlocked!",
        titleAr: "وسام جديد!",
        bodyEn: d.badgeNameEn
          ? `You earned the "${d.badgeNameEn}" badge.`
          : "You earned a new badge.",
        bodyAr: d.badgeNameAr
          ? `حصلت على وسام "${d.badgeNameAr}".`
          : "حصلت على وسام جديد.",
      };
    case "competition_won":
      return {
        titleEn: "You won a competition!",
        titleAr: "فزت بالتحدي!",
        bodyEn: d.challengeName
          ? `Congratulations — you finished first in "${d.challengeName}".`
          : "Congratulations — you finished first!",
        bodyAr: d.challengeName
          ? `مبروك — حصلت على المركز الأول في "${d.challengeName}".`
          : "مبروك — حصلت على المركز الأول!",
      };
    case "ranking_updated": {
      const where =
        d.scope === "challenge" && d.challengeName
          ? ` in "${d.challengeName}"`
          : "";
      const whereAr =
        d.scope === "challenge" && d.challengeName
          ? ` في "${d.challengeName}"`
          : "";
      return {
        titleEn: "Your ranking changed",
        titleAr: "تغيّر ترتيبك",
        bodyEn: d.rank
          ? `You are now ranked #${d.rank}${where}.`
          : `Your ranking was updated${where}.`,
        bodyAr: d.rank
          ? `ترتيبك الآن #${d.rank}${whereAr}.`
          : `تم تحديث ترتيبك${whereAr}.`,
      };
    }
    case "competition_ending":
      return {
        titleEn: "Competition ending soon",
        titleAr: "التحدي ينتهي قريباً",
        bodyEn: d.challengeName
          ? `"${d.challengeName}" is ending soon — make your final predictions!`
          : "A competition is ending soon — make your final predictions!",
        bodyAr: d.challengeName
          ? `"${d.challengeName}" ينتهي قريباً — أكمل توقعاتك الأخيرة!`
          : "أحد التحديات ينتهي قريباً — أكمل توقعاتك الأخيرة!",
      };
    case "prediction_closing":
      return {
        titleEn: "Predictions closing soon",
        titleAr: "التوقعات تُغلق قريباً",
        bodyEn: `Predictions for ${matchLabel(d, "en")} close soon.`,
        bodyAr: `تُغلق التوقعات على ${matchLabel(d, "ar")} قريباً.`,
      };
    case "match_starting":
      return {
        titleEn: "Match starting soon",
        titleAr: "المباراة تبدأ قريباً",
        bodyEn: `${matchLabel(d, "en")} is about to kick off.`,
        bodyAr: `${matchLabel(d, "ar")} على وشك أن تبدأ.`,
      };
    case "general":
    default:
      return {
        titleEn: d.titleEn ?? "Notification",
        titleAr: d.titleAr ?? "إشعار",
        bodyEn: d.bodyEn ?? null,
        bodyAr: d.bodyAr ?? null,
      };
  }
}
