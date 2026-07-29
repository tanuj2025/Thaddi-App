import dotenv from "dotenv";
import path from "path";

// Load dotenv from workspace root
dotenv.config({ path: path.join(__dirname, "../.env") });

const MONITORED_TARGETS = [
  { name: "Sawt", url: "https://sawt.cxisuite.com" },
  { name: "cxisuite.com", url: "https://cxisuite.com" },
  { name: "Thaddi Web Front", url: "https://thaddi.com" },
  { name: "Thaddi API Healthz", url: "https://thaddi.com/api/healthz" },
  { name: "Thaddi Anomaly Monitor", url: "https://thaddi.com/api/healthz/monitoring" }
];

async function checkTarget(name: string, url: string): Promise<{ ok: boolean; status: number | string; latency: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ThaddiUptimeChecker/1.0" }
    });
    
    clearTimeout(timeoutId);
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      latency: Date.now() - start
    };
  } catch (err: any) {
    return {
      ok: false,
      status: err.name === "AbortError" ? "TIMEOUT" : (err.message ?? String(err)),
      latency: Date.now() - start
    };
  }
}

async function runUptimeChecker() {
  console.log(`[${new Date().toISOString()}] Starting external uptime checks...`);
  
  const failures: Array<{ name: string; url: string; status: number | string; latency: number }> = [];
  const results: Array<{ name: string; url: string; ok: boolean; status: number | string; latency: number }> = [];
  
  for (const target of MONITORED_TARGETS) {
    const res = await checkTarget(target.name, target.url);
    results.push({ name: target.name, url: target.url, ...res });
    
    if (!res.ok) {
      failures.push({ name: target.name, url: target.url, status: res.status, latency: res.latency });
    }
  }
  
  console.log(`Uptime check results:`, results);
  
  if (failures.length > 0) {
    console.warn(`🚨 ${failures.length} target failures detected! Dispatching email alerts...`);
    await sendUptimeAlertEmail(failures, results);
  } else {
    console.log(`✅ All targets healthy.`);
  }
}

async function sendUptimeAlertEmail(
  failures: typeof MONITORED_TARGETS & any[],
  allResults: typeof MONITORED_TARGETS & any[]
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("ALERT: RESEND_API_KEY is not configured in .env. Alert email skipped.");
    return;
  }
  
  const developerEmail = process.env.DEVELOPER_ALERT_EMAIL ?? "tanujp09@gmail.com";
  const founderEmail = process.env.FOUNDER_ALERT_EMAIL ?? "tanuj@cxisuite.com";
  const recipients = [developerEmail, founderEmail];
  
  const from = process.env.NOTIFICATIONS_FROM_EMAIL ?? "alerts@thaddi.com";
  const fromWithName = from.includes("<") ? from : `Thaddi Uptime Monitor <${from}>`;
  
  const timestamp = new Date().toISOString();
  const subject = `[UPTIME ALERT] Downtime Detected on cxisuite/Sawt/Thaddi - ${timestamp}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Uptime Warning Alert</title>
    </head>
    <body style="font-family: Arial, sans-serif; background-color: #0F1117; color: #E5E7EB; margin: 0; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #1A1D26; border-radius: 12px; border: 1px solid #374151; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="background-color: #EF4444; padding: 20px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 20px; font-weight: bold; letter-spacing: 1px;">🚨 DOWNTIME ALERT</h1>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">Timestamp: ${timestamp}</p>
        </div>
        <div style="padding: 24px;">
          <p style="margin-top: 0; color: #9CA3AF; font-size: 15px;">
            The external uptime monitoring check identified failures for active endpoints:
          </p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #111827; border-radius: 8px; overflow: hidden;">
            <thead>
              <tr style="background-color: #374151; color: white; text-align: left; font-size: 12px;">
                <th style="padding: 12px;">Target</th>
                <th style="padding: 12px;">Status</th>
                <th style="padding: 12px;">Latency</th>
              </tr>
            </thead>
            <tbody>
              ${allResults.map((r) => `
                <tr style="border-bottom: 1px solid #1F2937; font-size: 13px; color: ${r.ok ? '#10B981' : '#EF4444'}">
                  <td style="padding: 12px; font-weight: bold;">${r.name}<br/><span style="font-size: 10px; color: #6B7280;">${r.url}</span></td>
                  <td style="padding: 12px;">${r.ok ? '✅ HEALTHY' : `❌ FAILED (${r.status})`}</td>
                  <td style="padding: 12px; color: #9CA3AF;">${r.latency}ms</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          
          <hr style="border: 0; border-top: 1px solid #374151; margin: 24px 0;"/>
          <p style="margin: 0; font-size: 11px; text-align: center; color: #6B7280;">
            This is an automated uptime check. Setup triggers immediately on target status deviation.
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
          html
        })
      });
      
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`Failed to send email to ${to}:`, res.status, text);
      } else {
        console.log(`Alert email successfully sent to ${to}`);
      }
    } catch (err) {
      console.error(`Error sending email to ${to}:`, err);
    }
  }
}

// Run checks immediately
void runUptimeChecker();
