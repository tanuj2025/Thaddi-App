import { Router, type IRouter } from "express";
import { requireCurrentUser } from "../lib/currentUser";
import {
  recordEvent,
  computeMetrics,
  computePageViewMetrics,
  computeClerkProxyMetrics,
  MAX_ANALYTICS_WINDOW_DAYS,
} from "../lib/analytics";

const router: IRouter = Router();

// Client-emitted events. Only the client-driven event types are accepted here;
// server-side events (registration, verification, etc.) are recorded internally
// at their source and cannot be spoofed through this endpoint.
const CLIENT_EVENT_TYPES = new Set(["whatsapp_share", "daily_active"]);

router.post("/analytics/track", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  const type = String(req.body?.type ?? "");
  if (!CLIENT_EVENT_TYPES.has(type)) {
    res.status(400).json({ error: "Unsupported event type" });
    return;
  }
  await recordEvent({
    type: type as "whatsapp_share" | "daily_active",
    userId: record.user.id,
    entityType: typeof req.body?.entityType === "string" ? req.body.entityType : null,
    entityId: typeof req.body?.entityId === "string" ? req.body.entityId : null,
    metadata:
      req.body?.metadata && typeof req.body.metadata === "object"
        ? (req.body.metadata as Record<string, unknown>)
        : null,
  });
  res.json({ success: true });
});

router.get("/analytics/metrics", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  if (record.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const windowDays = Math.min(MAX_ANALYTICS_WINDOW_DAYS, Math.max(1, Number(req.query.days) || 30));
  const metrics = await computeMetrics(windowDays);
  res.json(metrics);
});

// Admin-only Clerk sign-in proxy failure metrics
router.get("/analytics/clerk-proxy", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  if (record.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const windowDays = Math.min(MAX_ANALYTICS_WINDOW_DAYS, Math.max(1, Number(req.query.days) || 30));
  const metrics = await computeClerkProxyMetrics(windowDays);
  res.json(metrics);
});

// --------------------------------------------------------------------------
// Public page-view tracking — no auth required (visitors aren't signed in).
// Best-effort: never fails the caller.
// --------------------------------------------------------------------------

function detectDevice(ua: string): "mobile" | "tablet" | "desktop" {
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return "tablet";
  if (/Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua))
    return "mobile";
  return "desktop";
}

router.post("/analytics/page-view", async (req, res) => {
  const path =
    typeof req.body?.path === "string" ? req.body.path.slice(0, 500) : "/";
  const referrer =
    typeof req.body?.referrer === "string"
      ? req.body.referrer.slice(0, 500)
      : null;
  const sessionId =
    typeof req.body?.sessionId === "string"
      ? req.body.sessionId.slice(0, 100)
      : null;

  const ua = String(req.headers["user-agent"] ?? "");
  const deviceType = detectDevice(ua);

  // Cloudflare sets CF-IPCountry in production; falls back to 'Unknown'
  const cfCountry = req.headers["cf-ipcountry"];
  const country =
    typeof cfCountry === "string" && cfCountry !== "XX"
      ? cfCountry
      : "Unknown";

  await recordEvent({
    type: "page_view",
    metadata: { path, referrer, deviceType, country, sessionId },
  });

  res.json({ success: true });
});

// Admin-only aggregated page-view metrics
router.get("/analytics/page-views", async (req, res) => {
  const record = await requireCurrentUser(req, res);
  if (!record) return;
  if (record.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const windowDays = Math.min(MAX_ANALYTICS_WINDOW_DAYS, Math.max(1, Number(req.query.days) || 30));
  const metrics = await computePageViewMetrics(windowDays);
  res.json(metrics);
});

export default router;
