import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db, tournamentsTable, matchesTable, predictionsTable } from "@workspace/db";
import { logger } from "../../lib/logger";

export interface AnomalyReport {
  timestamp: string;
  dbStatus: "ok" | "error";
  dbError: string | null;
  staleTournaments: Array<{ id: string; nameEn: string; slug: string; updatedAt: string }>;
  overdueMatches: Array<{ id: string; homeTeamId: string | null; awayTeamId: string | null; kickoffAt: string }>;
  invalidLockTimes: Array<{ id: string; kickoffAt: string; predictionLockAt: string | null }>;
  latePredictions: Array<{
    predictionId: string;
    userId: string;
    matchId: string;
    submittedAt: string;
    lockTime: string;
  }>;
}

// Global throttle cache to prevent alert storming.
// Alert keys mapped to last alert timestamp.
const ALERT_THROTTLE_MS = 4 * 60 * 60 * 1000; // Throttle alerts for 4 hours per category
const alertHistory: Record<string, number> = {};

export async function runSystemMonitoringChecks(): Promise<AnomalyReport> {
  const now = new Date();
  
  // 1. Database Check
  let dbStatus: "ok" | "error" = "ok";
  let dbError: string | null = null;
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err: any) {
    dbStatus = "error";
    dbError = err.message ?? String(err);
  }

  // 2. Stale Sync Check (Active tournaments not updated in the last 12 hours)
  const staleThresholdDate = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  let staleTournaments: AnomalyReport["staleTournaments"] = [];
  if (dbStatus === "ok") {
    try {
      const rows = await db
        .select()
        .from(tournamentsTable)
        .where(
          and(
            eq(tournamentsTable.isActive, true),
            lte(tournamentsTable.updatedAt, staleThresholdDate)
          )
        );
      staleTournaments = rows.map((r) => ({
        id: r.id,
        nameEn: r.nameEn,
        slug: r.slug,
        updatedAt: r.updatedAt.toISOString(),
      }));
    } catch (err) {
      logger.error({ err }, "Monitoring stale sync query failed");
    }
  }

  // 3. Overdue Matches Check (Scheduled matches past kickoff by >10 minutes)
  const overdueThresholdDate = new Date(now.getTime() - 10 * 60 * 1000);
  let overdueMatches: AnomalyReport["overdueMatches"] = [];
  if (dbStatus === "ok") {
    try {
      const rows = await db
        .select()
        .from(matchesTable)
        .where(
          and(
            eq(matchesTable.status, "scheduled"),
            lte(matchesTable.kickoffAt, overdueThresholdDate)
          )
        );
      overdueMatches = rows.map((r) => ({
        id: r.id,
        homeTeamId: r.homeTeamId,
        awayTeamId: r.awayTeamId,
        kickoffAt: r.kickoffAt.toISOString(),
      }));
    } catch (err) {
      logger.error({ err }, "Monitoring overdue matches query failed");
    }
  }

  // 4. Invalid Lock Times Check (Lock time in the future relative to kickoff)
  let invalidLockTimes: AnomalyReport["invalidLockTimes"] = [];
  if (dbStatus === "ok") {
    try {
      const rows = await db
        .select()
        .from(matchesTable)
        .where(gt(matchesTable.predictionLockAt, matchesTable.kickoffAt));
      invalidLockTimes = rows.map((r) => ({
        id: r.id,
        kickoffAt: r.kickoffAt.toISOString(),
        predictionLockAt: r.predictionLockAt ? r.predictionLockAt.toISOString() : null,
      }));
    } catch (err) {
      logger.error({ err }, "Monitoring invalid lock times query failed");
    }
  }

  // 5. Late Predictions Check (Predictions submitted after kickoff lock)
  let latePredictions: AnomalyReport["latePredictions"] = [];
  if (dbStatus === "ok") {
    try {
      const rows = await db
        .select({
          predictionId: predictionsTable.id,
          userId: predictionsTable.userId,
          matchId: predictionsTable.matchId,
          submittedAt: predictionsTable.submittedAt,
          predictionLockAt: matchesTable.predictionLockAt,
          kickoffAt: matchesTable.kickoffAt,
        })
        .from(predictionsTable)
        .innerJoin(matchesTable, eq(predictionsTable.matchId, matchesTable.id))
        .where(
          sql`${predictionsTable.submittedAt} > COALESCE(${matchesTable.predictionLockAt}, ${matchesTable.kickoffAt})`
        );
      latePredictions = rows.map((r) => ({
        predictionId: r.predictionId,
        userId: r.userId,
        matchId: r.matchId,
        submittedAt: r.submittedAt.toISOString(),
        lockTime: (r.predictionLockAt ?? r.kickoffAt).toISOString(),
      }));
    } catch (err) {
      logger.error({ err }, "Monitoring late predictions query failed");
    }
  }

  const report: AnomalyReport = {
    timestamp: now.toISOString(),
    dbStatus,
    dbError,
    staleTournaments,
    overdueMatches,
    invalidLockTimes,
    latePredictions,
  };

  // Trigger alerting if anomalies are found
  void evaluateAndDispatchAlerts(report);

  return report;
}

function formatAlertList<T>(items: T[], formatFn: (item: T) => string, max = 5): string {
  const formatted = items.slice(0, max).map(formatFn).join("<br/>");
  if (items.length > max) {
    return formatted + `<br/><em>...and ${items.length - max} more records (see monitoring logs for full details)</em>`;
  }
  return formatted;
}

async function evaluateAndDispatchAlerts(report: AnomalyReport): Promise<void> {
  const anomaliesList: string[] = [];
  let alertType = "";

  if (report.dbStatus === "error") {
    anomaliesList.push(`🚨 <strong>Database Down:</strong> ${report.dbError}`);
    alertType = "db_down";
  }
  if (report.staleTournaments.length > 0) {
    anomaliesList.push(
      `⚠️ <strong>Stale Sports Sync:</strong> ${report.staleTournaments.length} active tournaments have not synced in over 12 hours.<br/>` +
      formatAlertList(report.staleTournaments, (t) => `• ${t.nameEn} (slug: ${t.slug}) - Last updated: ${t.updatedAt}`)
    );
    alertType = "stale_sync";
  }
  if (report.overdueMatches.length > 0) {
    anomaliesList.push(
      `🚨 <strong>Overdue Matches (Stale Feed status):</strong> ${report.overdueMatches.length} matches are past kickoff by >10 minutes but status is still 'scheduled'. Live scores may be failing to refresh.<br/>` +
      formatAlertList(report.overdueMatches, (m) => `• Match ID: ${m.id} - Kickoff: ${m.kickoffAt}`)
    );
    alertType = "overdue_matches";
  }
  if (report.invalidLockTimes.length > 0) {
    anomaliesList.push(
      `⚠️ <strong>Invalid Prediction Lock Settings:</strong> ${report.invalidLockTimes.length} fixtures lock after kickoff.<br/>` +
      formatAlertList(report.invalidLockTimes, (m) => `• Match ID: ${m.id} - Kickoff: ${m.kickoffAt}, Lock: ${m.predictionLockAt}`)
    );
    alertType = "invalid_lock";
  }
  if (report.latePredictions.length > 0) {
    anomaliesList.push(
      `🚨 <strong>Prediction Lock Bypass Detected:</strong> ${report.latePredictions.length} predictions were created/updated after match lock boundaries.<br/>` +
      formatAlertList(report.latePredictions, (p) => `• Pred: ${p.predictionId} - User: ${p.userId} - Submitted: ${p.submittedAt} (Lock was: ${p.lockTime})`)
    );
    alertType = "lock_bypass";
  }

  if (anomaliesList.length === 0) {
    return;
  }

  if (process.env.NODE_ENV === "test") {
    logger.info({ anomaliesList }, "Monitoring anomalies detected, suppressing email alerts in test environment");
    return;
  }

  // Throttle check
  const now = Date.now();
  const lastAlert = alertHistory[alertType] ?? 0;
  if (now - lastAlert < ALERT_THROTTLE_MS) {
    logger.info({ alertType }, "System alert throttled to prevent spam");
    return;
  }
  alertHistory[alertType] = now;

  // Compile recipients without defaulting to personal email
  const developerEmail = process.env.DEVELOPER_ALERT_EMAIL;
  const founderEmail = process.env.FOUNDER_ALERT_EMAIL ?? "tanuj@cxisuite.com";
  const recipients = [developerEmail, founderEmail].filter((email): email is string => !!email);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.error({ anomaliesList }, "ALERT: RESEND_API_KEY is not set. System anomalies could not be mailed.");
    return;
  }

  const from = process.env.NOTIFICATIONS_FROM_EMAIL ?? "alerts@thaddi.com";
  const fromWithName = from.includes("<") ? from : `Thaddi Monitoring <${from}>`;

  const subject = `[THADDI ALERT] System Anomalies Detected - ${report.timestamp}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Thaddi System Alert</title>
    </head>
    <body style="font-family: Arial, sans-serif; background-color: #0F1117; color: #E5E7EB; margin: 0; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #1A1D26; border-radius: 12px; border: 1px solid #374151; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background-color: #EF4444; padding: 20px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 1px;">SYSTEM ANOMALY DETECTED</h1>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">Timestamp: ${report.timestamp}</p>
        </div>
        <div style="padding: 24px;">
          <p style="margin-top: 0; color: #9CA3AF; font-size: 15px;">
            The automated monitoring checks on the Thaddi App backend have identified the following system anomalies that require developer attention:
          </p>
          <hr style="border: 0; border-top: 1px solid #374151; margin: 20px 0;"/>
          
          <div style="gap: 16px; display: flex; flex-direction: column;">
            ${anomaliesList.map((a) => `
              <div style="padding: 16px; border-radius: 8px; background-color: #111827; border-left: 4px solid #EF4444; line-height: 1.6; font-size: 14px;">
                ${a}
              </div>
            `).join("")}
          </div>
          
          <hr style="border: 0; border-top: 1px solid #374151; margin: 24px 0;"/>
          <p style="margin: 0; font-size: 11px; text-align: center; color: #6B7280;">
            This is an automated system check. Alerts are throttled at 4-hour intervals per event category.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  for (const to of recipients) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromWithName,
          to,
          subject,
          html,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error({ to, status: res.status, body: text }, "Failed to send monitoring alert email");
      } else {
        logger.info({ to }, "Sent monitoring alert email successfully");
      }
    } catch (err) {
      logger.error({ err, to }, "Error dispatching monitoring alert email");
    }
  }
}
