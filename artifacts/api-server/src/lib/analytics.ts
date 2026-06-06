import { and, eq, gte, sql } from "drizzle-orm";
import { db, analyticsEventsTable, type AnalyticsEvent } from "@workspace/db";
import { logger } from "./logger";

export type AnalyticsEventType = AnalyticsEvent["type"];

export interface RecordEventInput {
  type: AnalyticsEventType;
  userId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Best-effort analytics write. Never throws — analytics must not break the main
// request flow. For `daily_active` it de-duplicates per user per UTC day so the
// DAU metric is not inflated by every request.
export async function recordEvent(input: RecordEventInput): Promise<void> {
  try {
    if (input.type === "daily_active" && input.userId) {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const existing = await db
        .select({ id: analyticsEventsTable.id })
        .from(analyticsEventsTable)
        .where(
          and(
            eq(analyticsEventsTable.type, "daily_active"),
            eq(analyticsEventsTable.userId, input.userId),
            gte(analyticsEventsTable.createdAt, since),
          ),
        )
        .limit(1);
      if (existing.length > 0) return;
    }
    await db.insert(analyticsEventsTable).values({
      type: input.type,
      userId: input.userId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    logger.error({ err, type: input.type }, "recordEvent failed");
  }
}

export interface AnalyticsMetrics {
  windowDays: number;
  registrations: number;
  emailVerified: number;
  mobileVerified: number;
  challengesCreated: number;
  challengesJoined: number;
  predictionsSubmitted: number;
  whatsappShares: number;
  dailyActiveUsers: number;
  predictionSubmissionRate: number; // predictions per joined challenge
  whatsappShareRate: number; // shares per challenge created
  totals: Record<string, number>;
}

// Aggregated growth-funnel metrics over the trailing `windowDays` window.
export async function computeMetrics(windowDays = 30): Promise<AnalyticsMetrics> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      type: analyticsEventsTable.type,
      count: sql<number>`cast(count(*) as int)`,
      distinctUsers: sql<number>`cast(count(distinct ${analyticsEventsTable.userId}) as int)`,
    })
    .from(analyticsEventsTable)
    .where(gte(analyticsEventsTable.createdAt, since))
    .groupBy(analyticsEventsTable.type);

  const byType = new Map(rows.map((r) => [r.type, r]));
  const count = (t: AnalyticsEventType) => byType.get(t)?.count ?? 0;

  const registrations = count("registration");
  const emailVerified = count("email_verified");
  const mobileVerified = count("mobile_verified");
  const challengesCreated = count("challenge_created");
  const challengesJoined = count("challenge_joined");
  const predictionsSubmitted = count("prediction_submitted");
  const whatsappShares = count("whatsapp_share");
  const dailyActiveUsers = byType.get("daily_active")?.distinctUsers ?? 0;

  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.type] = r.count;

  return {
    windowDays,
    registrations,
    emailVerified,
    mobileVerified,
    challengesCreated,
    challengesJoined,
    predictionsSubmitted,
    whatsappShares,
    dailyActiveUsers,
    predictionSubmissionRate:
      challengesJoined > 0
        ? Math.round((predictionsSubmitted / challengesJoined) * 100) / 100
        : 0,
    whatsappShareRate:
      challengesCreated > 0
        ? Math.round((whatsappShares / challengesCreated) * 100) / 100
        : 0,
    totals,
  };
}
