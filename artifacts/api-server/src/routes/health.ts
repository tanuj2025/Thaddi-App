import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { runSystemMonitoringChecks } from "../services/monitoring/healthMonitor";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/monitoring", async (_req, res) => {
  try {
    const report = await runSystemMonitoringChecks();
    const hasCriticalIssues =
      report.dbStatus === "error" ||
      report.overdueMatches.length > 0 ||
      report.latePredictions.length > 0;

    if (hasCriticalIssues) {
      res.status(500).json({ status: "error", report });
    } else {
      res.json({ status: "ok", report });
    }
  } catch (err: any) {
    res.status(500).json({ status: "error", error: err.message ?? String(err) });
  }
});

export default router;
