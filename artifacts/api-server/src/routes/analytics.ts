import { Router, type IRouter } from "express";
import { requireCurrentUser } from "../lib/currentUser";
import { recordEvent, computeMetrics } from "../lib/analytics";

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
  const windowDays = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const metrics = await computeMetrics(windowDays);
  res.json(metrics);
});

export default router;
