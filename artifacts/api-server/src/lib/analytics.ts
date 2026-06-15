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

// --------------------------------------------------------------------------
// Clerk proxy failure recording
// --------------------------------------------------------------------------

export interface ClerkProxyFailureInput {
  // The Node error code from the upstream failure (ECONNRESET, ECONNREFUSED…).
  code?: string | null;
  // Whether the proxy automatically retried this request (idempotent + pre-connect).
  willRetry: boolean;
  method: string;
  // True for the un-retryable Apple form_post callback degrade (the residual risk
  // worth alerting on): a top-level navigation POST that failed and could not be
  // safely replayed, so the user was bounced back to the sign-in page.
  degraded: boolean;
}

// Fire-and-forget durable record of a Clerk-proxy upstream failure. Stored in
// analytics_events so the breakdown survives across autoscale instances and
// beyond log retention. Best-effort via recordEvent (never throws / blocks the
// proxy's own error handling).
export function recordClerkProxyFailure(input: ClerkProxyFailureInput): void {
  void recordEvent({
    type: "clerk_proxy_error",
    metadata: {
      code: input.code ?? "unknown",
      willRetry: input.willRetry,
      method: input.method.toUpperCase(),
      degraded: input.degraded,
    },
  });
}

export interface AnalyticsMetricPoint {
  type: string;
  count: number;
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
  byType: AnalyticsMetricPoint[];
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

  const byTypePoints: AnalyticsMetricPoint[] = rows.map((r) => ({
    type: r.type,
    count: r.count,
  }));

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
    byType: byTypePoints,
  };
}

// --------------------------------------------------------------------------
// Page-view metrics
// --------------------------------------------------------------------------

export interface PageViewDailyPoint {
  date: string;
  views: number;
  unique: number;
}

export interface PageViewBreakdownItem {
  label: string;
  count: number;
  pct: number;
}

export interface PageViewMetrics {
  windowDays: number;
  totalViews: number;
  uniqueSessions: number;
  daily: PageViewDailyPoint[];
  topReferrers: PageViewBreakdownItem[];
  deviceBreakdown: PageViewBreakdownItem[];
  countryBreakdown: PageViewBreakdownItem[];
  topPaths: PageViewBreakdownItem[];
}

function normalizeReferrer(ref: string | null | undefined): string {
  if (!ref) return "Direct";
  try {
    return new URL(ref).hostname;
  } catch {
    return ref.slice(0, 100);
  }
}

function toBreakdown(
  map: Map<string, number>,
  limit = 10,
): PageViewBreakdownItem[] {
  const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      pct: Math.round((count / total) * 1000) / 10,
    }));
}

export async function computePageViewMetrics(
  windowDays = 30,
): Promise<PageViewMetrics> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      createdAt: analyticsEventsTable.createdAt,
      metadata: analyticsEventsTable.metadata,
    })
    .from(analyticsEventsTable)
    .where(
      and(
        eq(analyticsEventsTable.type, "page_view"),
        gte(analyticsEventsTable.createdAt, since),
      ),
    );

  const sessionSet = new Set<string>();
  const dailyMap = new Map<string, { views: number; sessions: Set<string> }>();
  const referrerMap = new Map<string, number>();
  const deviceMap = new Map<string, number>();
  const countryMap = new Map<string, number>();
  const pathMap = new Map<string, number>();

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const sessionId =
      typeof meta.sessionId === "string" ? meta.sessionId : null;
    const referrer = normalizeReferrer(
      typeof meta.referrer === "string" ? meta.referrer : null,
    );
    const deviceType =
      typeof meta.deviceType === "string" ? meta.deviceType : "desktop";
    const country =
      typeof meta.country === "string" ? meta.country : "Unknown";
    const path = typeof meta.path === "string" ? meta.path : "/";

    if (sessionId) sessionSet.add(sessionId);

    const dateKey = row.createdAt.toISOString().split("T")[0];
    if (!dailyMap.has(dateKey))
      dailyMap.set(dateKey, { views: 0, sessions: new Set() });
    const day = dailyMap.get(dateKey)!;
    day.views++;
    if (sessionId) day.sessions.add(sessionId);

    referrerMap.set(referrer, (referrerMap.get(referrer) ?? 0) + 1);
    deviceMap.set(deviceType, (deviceMap.get(deviceType) ?? 0) + 1);
    countryMap.set(country, (countryMap.get(country) ?? 0) + 1);
    pathMap.set(path, (pathMap.get(path) ?? 0) + 1);
  }

  // Fill every day in the window (including zeros)
  const daily: PageViewDailyPoint[] = [];
  for (let d = 0; d < windowDays; d++) {
    const date = new Date(since.getTime() + d * 24 * 60 * 60 * 1000);
    const dateKey = date.toISOString().split("T")[0];
    const day = dailyMap.get(dateKey);
    daily.push({
      date: dateKey,
      views: day?.views ?? 0,
      unique: day?.sessions.size ?? 0,
    });
  }

  return {
    windowDays,
    totalViews: rows.length,
    uniqueSessions: sessionSet.size,
    daily,
    topReferrers: toBreakdown(referrerMap),
    deviceBreakdown: toBreakdown(deviceMap),
    countryBreakdown: toBreakdown(countryMap),
    topPaths: toBreakdown(pathMap),
  };
}

// --------------------------------------------------------------------------
// Clerk proxy failure metrics
// --------------------------------------------------------------------------

export interface ClerkProxyDailyPoint {
  date: string;
  total: number;
  degraded: number;
}

export interface ClerkProxyMetrics {
  windowDays: number;
  totalErrors: number;
  // Failures the proxy automatically retried (idempotent, pre-connect).
  retriedErrors: number;
  // Un-retryable Apple form_post callback degrades — the residual risk to alert on.
  degradedCallbacks: number;
  byCode: PageViewBreakdownItem[];
  byWillRetry: PageViewBreakdownItem[];
  byMethod: PageViewBreakdownItem[];
  daily: ClerkProxyDailyPoint[];
}

export async function computeClerkProxyMetrics(
  windowDays = 30,
): Promise<ClerkProxyMetrics> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      createdAt: analyticsEventsTable.createdAt,
      metadata: analyticsEventsTable.metadata,
    })
    .from(analyticsEventsTable)
    .where(
      and(
        eq(analyticsEventsTable.type, "clerk_proxy_error"),
        gte(analyticsEventsTable.createdAt, since),
      ),
    );

  const codeMap = new Map<string, number>();
  const retryMap = new Map<string, number>();
  const methodMap = new Map<string, number>();
  const dailyMap = new Map<string, { total: number; degraded: number }>();
  let retriedErrors = 0;
  let degradedCallbacks = 0;

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const code = typeof meta.code === "string" ? meta.code : "unknown";
    const willRetry = meta.willRetry === true;
    const method = typeof meta.method === "string" ? meta.method : "UNKNOWN";
    const degraded = meta.degraded === true;

    codeMap.set(code, (codeMap.get(code) ?? 0) + 1);
    const retryKey = willRetry ? "retried" : "not_retried";
    retryMap.set(retryKey, (retryMap.get(retryKey) ?? 0) + 1);
    methodMap.set(method, (methodMap.get(method) ?? 0) + 1);
    if (willRetry) retriedErrors++;
    if (degraded) degradedCallbacks++;

    const dateKey = row.createdAt.toISOString().split("T")[0];
    if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, { total: 0, degraded: 0 });
    const day = dailyMap.get(dateKey)!;
    day.total++;
    if (degraded) day.degraded++;
  }

  const daily: ClerkProxyDailyPoint[] = [];
  const cursor = new Date(since);
  cursor.setUTCHours(0, 0, 0, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // Inclusive of today's bucket: failures right after a deploy must show on the
  // trend, so iterate calendar days from the window start through today.
  for (; cursor <= today; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dateKey = cursor.toISOString().split("T")[0];
    const day = dailyMap.get(dateKey);
    daily.push({
      date: dateKey,
      total: day?.total ?? 0,
      degraded: day?.degraded ?? 0,
    });
  }

  return {
    windowDays,
    totalErrors: rows.length,
    retriedErrors,
    degradedCallbacks,
    byCode: toBreakdown(codeMap),
    byWillRetry: toBreakdown(retryMap),
    byMethod: toBreakdown(methodMap),
    daily,
  };
}
