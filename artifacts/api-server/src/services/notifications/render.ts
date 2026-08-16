import type { Notification } from "@workspace/db";

export type NotificationType = Notification["type"];

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
  pointsAwarded?: number;
  outcome?: string;
  rank?: number;
  scope?: "challenge" | "global";
  hoursLeft?: number;
  requesterName?: string;
  requesterUsername?: string;
  requestId?: string;
  approved?: boolean;
  // Social: the user who performed the action (follower / friend requester /
  // the friend who accepted a request).
  actorName?: string;
  actorUsername?: string;
  actorUserId?: string;
  ctaUrl?: string;
  ctaLabelEn?: string;
  ctaLabelAr?: string;
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
  ctaUrl?: string;
  ctaLabelEn?: string;
  ctaLabelAr?: string;
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
          ? `كسبت وسام "${d.badgeNameAr}".`
          : "كسبت وسام جديد.",
      };
    case "competition_won":
      return {
        titleEn: "You won a competition!",
        titleAr: "فزت بالتحدي!",
        bodyEn: d.challengeName
          ? `Congratulations — you finished first in "${d.challengeName}".`
          : "Congratulations — you finished first!",
        bodyAr: d.challengeName
          ? `مبروك — طلعت أول في "${d.challengeName}"! 🏆`
          : "مبروك — طلعت أول! 🏆",
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
          ? `ترتيبك الحين #${d.rank}${whereAr}.`
          : `انحدّث ترتيبك${whereAr}.`,
      };
    }
    case "competition_ending":
      return {
        titleEn: "Competition ending soon",
        titleAr: "التحدّي قرّب يخلص",
        bodyEn: d.challengeName
          ? `"${d.challengeName}" is ending soon — make your final predictions!`
          : "A competition is ending soon — make your final predictions!",
        bodyAr: d.challengeName
          ? `"${d.challengeName}" قرّب يخلص — كمّل آخر توقّعاتك!`
          : "أحد التحديات قرّب يخلص — كمّل آخر توقّعاتك!",
      };
    case "prediction_closing":
      return {
        titleEn: "Predictions closing soon",
        titleAr: "التوقّعات بتتقفل قريب",
        bodyEn: `Predictions for ${matchLabel(d, "en")} close soon.`,
        bodyAr: `بتتقفل التوقّعات على ${matchLabel(d, "ar")} قريب.`,
      };
    case "prediction_scored": {
      const match = matchLabel(d, "en");
      const matchAr = matchLabel(d, "ar");
      const points = typeof d.pointsAwarded === "number" ? d.pointsAwarded : 0;
      let bodyEn: string;
      let bodyAr: string;
      if (d.outcome === "exact") {
        bodyEn = `You earned ${points} pts on ${match} — exact score!`;
        bodyAr = `كسبت ${points} نقاط على ${matchAr} — جبت النتيجة بالملّي! 🎯`;
      } else if (d.outcome === "winner") {
        bodyEn = `You earned ${points} pt on ${match} — correct winner.`;
        bodyAr = `كسبت ${points} نقطة على ${matchAr} — خمّنت الفايز صح!`;
      } else {
        bodyEn = `No points on ${match} this time.`;
        bodyAr = `ما كسبت نقاط على ${matchAr} هالمرة. الجايات أكثر!`;
      }
      return {
        titleEn: "Prediction result",
        titleAr: "نتيجة توقّعك",
        bodyEn,
        bodyAr,
        ctaUrl: d.ctaUrl ?? (d.matchId ? `/match/${d.matchId}` : undefined),
        ctaLabelEn: d.ctaLabelEn ?? "View Match",
        ctaLabelAr: d.ctaLabelAr ?? "افتح المباراة",
      };
    }
    case "match_starting":
      return {
        titleEn: "Match starting soon",
        titleAr: "المباراة قرّبت تبدأ",
        bodyEn: `${matchLabel(d, "en")} is about to kick off.`,
        bodyAr: `${matchLabel(d, "ar")} بتبدأ بعد شوي.`,
      };
    case "join_request_received": {
      const requester = d.requesterName ?? d.requesterUsername ?? "Someone";
      const requesterAr = d.requesterName ?? d.requesterUsername ?? "شخص";
      return {
        titleEn: "New join request",
        titleAr: "طلب انضمام جديد",
        bodyEn: d.challengeName
          ? `${requester} has requested to join your challenge "${d.challengeName}". Review and respond from the challenge page.`
          : `${requester} has requested to join your challenge.`,
        bodyAr: d.challengeName
          ? `${requesterAr} طلب الانضمام لتحدّيك "${d.challengeName}". راجع الطلب من صفحة التحدّي.`
          : `${requesterAr} طلب الانضمام لتحدّيك.`,
        ctaUrl: d.ctaUrl,
        ctaLabelEn: d.ctaLabelEn ?? "Review Request",
        ctaLabelAr: d.ctaLabelAr ?? "مراجعة الطلب",
      };
    }
    case "join_request_approved":
      return {
        titleEn: "Join request approved!",
        titleAr: "تمت الموافقة على طلبك!",
        bodyEn: d.challengeName
          ? `Welcome! You've been approved to join "${d.challengeName}". Start making your predictions now.`
          : "Your join request was approved. Welcome to the challenge!",
        bodyAr: d.challengeName
          ? `أهلاً وسهلاً! تمت الموافقة على انضمامك لتحدّي "${d.challengeName}". ابدأ بتسجيل توقّعاتك الحين.`
          : "تمت الموافقة على طلبك. أهلاً في التحدّي!",
        ctaUrl: d.ctaUrl,
        ctaLabelEn: d.ctaLabelEn ?? "Go to Challenge",
        ctaLabelAr: d.ctaLabelAr ?? "افتح التحدّي",
      };
    case "join_request_declined":
      return {
        titleEn: "Join request not approved",
        titleAr: "لم تتم الموافقة على طلبك",
        bodyEn: d.challengeName
          ? `Your request to join "${d.challengeName}" was not approved this time.`
          : "Your join request was not approved.",
        bodyAr: d.challengeName
          ? `لم تتم الموافقة على طلبك للانضمام إلى "${d.challengeName}" هذه المرة.`
          : "لم تتم الموافقة على طلبك.",
      };
    case "new_follower": {
      const actor = d.actorName ?? d.actorUsername ?? "Someone";
      const actorAr = d.actorName ?? d.actorUsername ?? "شخص";
      return {
        titleEn: "New follower",
        titleAr: "متابِع جديد",
        bodyEn: `${actor} started following you.`,
        bodyAr: `${actorAr} صار يتابعك.`,
        ctaUrl: d.ctaUrl,
        ctaLabelEn: d.ctaLabelEn ?? "View Profile",
        ctaLabelAr: d.ctaLabelAr ?? "عرض الملف",
      };
    }
    case "friend_request_received": {
      const actor = d.actorName ?? d.actorUsername ?? "Someone";
      const actorAr = d.actorName ?? d.actorUsername ?? "شخص";
      return {
        titleEn: "New friend request",
        titleAr: "طلب صداقة جديد",
        bodyEn: `${actor} sent you a friend request. Review and respond from their profile.`,
        bodyAr: `${actorAr} أرسل لك طلب صداقة. راجع الطلب من صفحته.`,
        ctaUrl: d.ctaUrl,
        ctaLabelEn: d.ctaLabelEn ?? "View Request",
        ctaLabelAr: d.ctaLabelAr ?? "عرض الطلب",
      };
    }
    case "friend_request_accepted": {
      const actor = d.actorName ?? d.actorUsername ?? "Someone";
      const actorAr = d.actorName ?? d.actorUsername ?? "شخص";
      return {
        titleEn: "Friend request accepted",
        titleAr: "تم قبول طلب الصداقة",
        bodyEn: `${actor} accepted your friend request. You're now friends!`,
        bodyAr: `${actorAr} قبل طلب صداقتك. صرتوا أصدقاء الحين!`,
        ctaUrl: d.ctaUrl,
        ctaLabelEn: d.ctaLabelEn ?? "View Profile",
        ctaLabelAr: d.ctaLabelAr ?? "عرض الملف",
      };
    }
    case "favorite_club_nudge":
      return {
        titleEn: "Pick your favorite club",
        titleAr: "اختر ناديك المفضّل",
        bodyEn:
          "You can now choose your favorite club, not just your national team. Add it to personalize your experience.",
        bodyAr:
          "تقدر الحين تختار ناديك المفضّل، مو بس منتخبك. أضِفه عشان نخصّص لك تجربتك.",
        ctaUrl: d.ctaUrl ?? "/profile",
        ctaLabelEn: d.ctaLabelEn ?? "Choose Club",
        ctaLabelAr: d.ctaLabelAr ?? "اختر النادي",
      };
    case "general":
    default:
      return {
        titleEn: d.titleEn ?? "Notification",
        titleAr: d.titleAr ?? "إشعار",
        bodyEn: d.bodyEn ?? null,
        bodyAr: d.bodyAr ?? null,
        ctaUrl: d.ctaUrl,
        ctaLabelEn: d.ctaLabelEn,
        ctaLabelAr: d.ctaLabelAr,
      };
  }
}
