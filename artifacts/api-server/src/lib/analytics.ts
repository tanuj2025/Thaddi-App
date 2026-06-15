import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, analyticsEventsTable, type AnalyticsEvent } from "@workspace/db";
import { logger } from "./logger";

export type AnalyticsEventType = AnalyticsEvent["type"];

// The largest history window any admin analytics breakdown can request. The
// admin routes (routes/analytics.ts) clamp `?days=` to this, and the retention
// pruner uses it as a hard floor so pruning can never remove a row that a valid
// dashboard query could still display. Keep the route caps and this constant in
// lockstep.
export const MAX_ANALYTICS_WINDOW_DAYS = 365;

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

// --------------------------------------------------------------------------
// Clerk proxy failure retention / pruning
// --------------------------------------------------------------------------

function intervalFromEnv(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

// How long a clerk_proxy_error row is kept. Defaults to the max dashboard
// window so storage stays bounded (rows older than a year can never appear in
// any breakdown) while every supported `?days=` query stays complete. An
// operator may RAISE retention via CLERK_PROXY_ERROR_RETENTION_DAYS, but never
// below MAX_ANALYTICS_WINDOW_DAYS — pruning inside a queryable window would
// silently truncate the admin breakdown.
function retentionDays(): number {
  const raw = Number(process.env.CLERK_PROXY_ERROR_RETENTION_DAYS);
  const requested =
    Number.isFinite(raw) && raw > 0 ? raw : MAX_ANALYTICS_WINDOW_DAYS;
  return Math.max(requested, MAX_ANALYTICS_WINDOW_DAYS);
}

// Delete clerk_proxy_error rows older than the retention window so the table
// (and the breakdown query that scans it) stays bounded as sign-in failures
// accumulate. Best-effort: never throws. Returns the number of rows pruned.
export async function pruneClerkProxyErrors(): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays() * 24 * 60 * 60 * 1000);
  try {
    const deleted = await db
      .delete(analyticsEventsTable)
      .where(
        and(
          eq(analyticsEventsTable.type, "clerk_proxy_error"),
          lt(analyticsEventsTable.createdAt, cutoff),
        ),
      )
      .returning({ id: analyticsEventsTable.id });
    if (deleted.length > 0) {
      logger.info(
        { pruned: deleted.length, retentionDays: retentionDays() },
        "Pruned old clerk_proxy_error analytics rows",
      );
    }
    return deleted.length;
  } catch (err) {
    logger.error({ err }, "pruneClerkProxyErrors failed");
    return 0;
  }
}

// Starts the recurring retention pruner. Self-scheduling timer so passes never
// overlap; best-effort so a transient DB error never kills the loop. Runs one
// pass shortly after boot (to clear any backlog) then on a fixed interval.
// Returns a stop function. The DELETE is idempotent and races harmlessly across
// autoscale instances (deleting an already-deleted row is a no-op), so no
// advisory lock is needed.
export function startClerkProxyErrorPruner(): () => void {
  const intervalMs = intervalFromEnv(
    "CLERK_PROXY_ERROR_PRUNE_INTERVAL_MS",
    24 * 60 * 60 * 1000,
  );
  const firstDelayMs = intervalFromEnv(
    "CLERK_PROXY_ERROR_PRUNE_FIRST_DELAY_MS",
    60 * 1000,
  );

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(tick, delayMs);
  };

  const tick = async () => {
    try {
      await pruneClerkProxyErrors();
    } catch (err) {
      logger.error({ err }, "clerk_proxy_error prune tick failed");
    }
    scheduleNext(intervalMs);
  };

  logger.info(
    { intervalMs, retentionDays: retentionDays() },
    "Clerk proxy error pruner started",
  );
  scheduleNext(firstDelayMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    logger.info("Clerk proxy error pruner stopped");
  };
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
