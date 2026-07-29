#!/usr/bin/env tsx
/**
 * One-off script: sends one test email per notification type to a given address.
 * Usage: tsx scripts/send-test-emails.ts
 */

const TO = "asof@me.com";
const FROM_NAME = "تطبيق تحدي - Thaddi App";
const API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM = process.env.NOTIFICATIONS_FROM_EMAIL ?? "";
const APP_URL = process.env.THADDI_APP_URL ?? "https://thaddi.app";

if (!API_KEY) { console.error("RESEND_API_KEY not set"); process.exit(1); }
if (!FROM) { console.error("NOTIFICATIONS_FROM_EMAIL not set"); process.exit(1); }

const logoUrl = `${APP_URL}/logo-transparent.png`;

function buildEmailHtml(opts: {
  titleEn: string; titleAr: string;
  bodyEn?: string; bodyAr?: string;
  ctaUrl?: string; ctaLabelEn?: string; ctaLabelAr?: string;
}): string {
  const logoBlock = `<img src="${logoUrl}" alt="thaddi" width="60" height="60" style="display:block;margin:0 auto 16px;border-radius:12px">`;
  const ctaBlockEn = opts.ctaUrl && opts.ctaLabelEn
    ? `<a href="${opts.ctaUrl}" style="display:inline-block;margin-top:24px;padding:13px 28px;background-color:#D4A853;color:#0F1117;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;text-decoration:none;border-radius:8px">${opts.ctaLabelEn}</a>`
    : "";
  const ctaBlockAr = opts.ctaUrl && opts.ctaLabelAr
    ? `<a href="${opts.ctaUrl}" style="display:inline-block;margin-top:24px;padding:13px 28px;background-color:#D4A853;color:#0F1117;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;text-decoration:none;border-radius:8px">${opts.ctaLabelAr}</a>`
    : "";
  const bodyEnBlock = opts.bodyEn
    ? `<p style="margin:0;color:#9CA3AF;font-size:15px;line-height:1.7;font-family:Helvetica,Arial,sans-serif">${opts.bodyEn}</p>`
    : "";
  const bodyArBlock = opts.bodyAr
    ? `<p style="margin:0;color:#9CA3AF;font-size:15px;line-height:1.7;font-family:Helvetica,Arial,sans-serif">${opts.bodyAr}</p>`
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
          <tr>
            <td style="padding:32px 40px 24px;text-align:center;border-bottom:1px solid #2A2D3A">
              ${logoBlock}
              <p style="margin:0;color:#D4A853;font-size:12px;font-weight:700;letter-spacing:2px;font-family:Helvetica,Arial,sans-serif">تطبيق تحدي &nbsp;·&nbsp; THADDI APP</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;direction:ltr;text-align:left">
              <h1 style="margin:0 0 12px;color:#F0F0F0;font-size:22px;font-weight:700;line-height:1.3;font-family:Helvetica,Arial,sans-serif">${opts.titleEn}</h1>
              ${bodyEnBlock}
              ${ctaBlockEn}
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px">
              <div style="height:1px;background-color:#2A2D3A"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;direction:rtl;text-align:right">
              <h1 style="margin:0 0 12px;color:#F0F0F0;font-size:22px;font-weight:700;line-height:1.3;font-family:Helvetica,Arial,sans-serif">${opts.titleAr}</h1>
              ${bodyArBlock}
              ${ctaBlockAr}
            </td>
          </tr>
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

interface TestCase {
  type: string;
  titleEn: string; titleAr: string;
  bodyEn: string; bodyAr: string;
  ctaUrl?: string; ctaLabelEn?: string; ctaLabelAr?: string;
}

const challengeUrl = `${APP_URL}/challenges/demo-challenge-id`;

const cases: TestCase[] = [
  {
    type: "badge_unlocked",
    titleEn: "New badge unlocked!",
    titleAr: "وسام جديد!",
    bodyEn: 'You earned the "First Blood" badge.',
    bodyAr: 'كسبت وسام "الأول دائماً".',
  },
  {
    type: "competition_won",
    titleEn: "You won a competition!",
    titleAr: "فزت بالتحدي!",
    bodyEn: 'Congratulations — you finished first in "World Championship 2026 Group Stage".',
    bodyAr: 'مبروك — طلعت أول في "تحدّي دور المجموعات بطولة العالم 2026"! 🏆',

    ctaUrl: challengeUrl,
    ctaLabelEn: "View Results",
    ctaLabelAr: "شاهد النتائج",
  },
  {
    type: "ranking_updated",
    titleEn: "Your ranking changed",
    titleAr: "تغيّر ترتيبك",
    bodyEn: 'You are now ranked #3 in "World Championship 2026 Group Stage".',
    bodyAr: 'ترتيبك الحين #3 في "تحدّي دور المجموعات بطولة العالم 2026".',
ctaUrl: challengeUrl,
    ctaLabelEn: "View Leaderboard",
    ctaLabelAr: "شاهد الترتيب",
  },
  {
    type: "competition_ending",
    titleEn: "Competition ending soon",
    titleAr: "التحدّي قرّب يخلص",
    bodyEn: '"World Championship 2026 Group Stage" is ending soon — make your final predictions!',
    bodyAr: '"تحدّي دور المجموعات بطولة العالم 2026" قرّب يخلص — كمّل آخر توقّعاتك!',
ctaUrl: challengeUrl,
    ctaLabelEn: "Make Predictions",
    ctaLabelAr: "سجّل توقّعاتك",
  },
  {
    type: "prediction_closing",
    titleEn: "Predictions closing soon",
    titleAr: "التوقّعات بتتقفل قريب",
    bodyEn: "Predictions for Saudi Arabia vs Argentina close soon.",
    bodyAr: "بتتقفل التوقّعات على السعودية و الأرجنتين قريب.",
    ctaUrl: challengeUrl,
    ctaLabelEn: "Predict Now",
    ctaLabelAr: "توقّع الحين",
  },
  {
    type: "match_starting",
    titleEn: "Match starting soon",
    titleAr: "المباراة قرّبت تبدأ",
    bodyEn: "Saudi Arabia vs Argentina is about to kick off.",
    bodyAr: "السعودية و الأرجنتين بتبدأ بعد شوي.",
    ctaUrl: challengeUrl,
    ctaLabelEn: "Watch Live",
    ctaLabelAr: "شاهد المباراة",
  },
  {
    type: "join_request_received",
    titleEn: "New join request",
    titleAr: "طلب انضمام جديد",
    bodyEn: 'Abdullah Al-Ghamdi has requested to join your challenge "World Championship 2026 Group Stage". Review and respond from the challenge page.',
    bodyAr: 'عبدالله الغامدي طلب الانضمام لتحدّيك "تحدّي دور المجموعات بطولة العالم 2026". راجع الطلب من صفحة التحدّي.',
    ctaUrl: challengeUrl,
    ctaLabelEn: "Review Request",
    ctaLabelAr: "مراجعة الطلب",
  },
  {
    type: "join_request_approved",
    titleEn: "Join request approved!",
    titleAr: "تمت الموافقة على طلبك!",
    bodyEn: 'Welcome! You\'ve been approved to join "World Championship 2026 Group Stage". Start making your predictions now.',
    bodyAr: 'أهلاً وسهلاً! تمت الموافقة على انضمامك لتحدّي "تحدّي دور المجموعات بطولة العالم 2026". ابدأ بتسجيل توقّعاتك الحين.',

    ctaUrl: challengeUrl,
    ctaLabelEn: "Go to Challenge",
    ctaLabelAr: "افتح التحدّي",
  },
  {
    type: "join_request_declined",
    titleEn: "Join request not approved",
    titleAr: "لم تتم الموافقة على طلبك",
    bodyEn: 'Your request to join "World Championship 2026 Group Stage" was not approved this time.',
    bodyAr: 'لم تتم الموافقة على طلبك للانضمام إلى "تحدّي دور المجموعات بطولة العالم 2026" هذه المرة.',
  },
  {
    type: "general",
    titleEn: "Welcome to thaddi App",
    titleAr: "أهلاً في تطبيق تحدّي",
    bodyEn: "This is a general notification. You can use it for announcements, updates, and anything that doesn't fit the other types.",
    bodyAr: "هذا إشعار عام. يُستخدم للإعلانات والتحديثات وأي شيء لا يندرج ضمن الأنواع الأخرى.",
    ctaUrl: APP_URL,
    ctaLabelEn: "Open App",
    ctaLabelAr: "افتح التطبيق",
  },
];

async function sendOne(tc: TestCase): Promise<void> {
  const html = buildEmailHtml(tc);
  const subject = `[TEST] ${tc.titleEn} · ${tc.titleAr}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM}>`,
      to: TO,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const json = await res.json() as { id?: string };
  console.log(`✓ ${tc.type.padEnd(28)} → ${json.id}`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`Sending ${cases.length} test emails to ${TO}…\n`);
  let ok = 0; let fail = 0;
  for (const tc of cases) {
    try {
      await sendOne(tc);
      ok++;
    } catch (err) {
      console.error(`✗ ${tc.type}: ${err}`);
      fail++;
    }
    await sleep(600);
  }
  console.log(`\nDone: ${ok} sent, ${fail} failed.`);
  if (fail > 0) process.exit(1);
})();
