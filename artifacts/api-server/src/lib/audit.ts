import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

export interface AuditInput {
  actorUserId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Extracts the caller's IP and user-agent for the audit trail. Uses Express's
// canonical `req.ip`, which derives the client IP from the configured
// `trust proxy` setting; this cannot be spoofed via a raw `x-forwarded-for`
// header set by an untrusted client.
function requestContext(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  };
}

// Records a sensitive admin action to the audit trail. Best-effort: a logging
// failure is recorded but never throws, so it can never break the action it is
// auditing.
export async function recordAudit(input: AuditInput, req?: Request): Promise<void> {
  try {
    const ctx = req ? requestContext(req) : { ip: null, userAgent: null };
    await db.insert(auditLogsTable).values({
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "recordAudit failed");
  }
}
