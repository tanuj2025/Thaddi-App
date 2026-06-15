import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { localeOf, type Lang } from '../../lib/matchUtils';
import {
  useGetPageViewMetrics,
  useGetClerkProxyMetrics,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Eye,
  Users,
  Loader2,
  Globe,
  Monitor,
  Link2,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Code2,
  Network,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

const DAY_OPTIONS = [7, 30, 90] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

function StatCard({
  icon: Icon,
  label,
  value,
  testId,
  lang,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  testId: string;
  lang: Lang;
}) {
  return (
    <Card data-testid={testId} className="card-premium hover:border-primary/50 transition-colors">
      <CardContent className="p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 glow-green">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold tabular-nums text-gold-gradient">
            {value.toLocaleString(localeOf(lang))}
          </div>
          <div className="text-sm text-muted-foreground truncate">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

interface BreakdownItem {
  label: string;
  count: number;
  pct: number;
}

function BreakdownTable({
  title,
  icon: Icon,
  items,
  lang,
  noDataLabel,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: BreakdownItem[];
  lang: Lang;
  noDataLabel: string;
}) {
  return (
    <Card className="card-premium">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{noDataLabel}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.label} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium truncate">{item.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {item.count.toLocaleString(localeOf(lang))} ({item.pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.min(100, item.pct)}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ClerkProxyPanel({ days, lang }: { days: DayOption; lang: Lang }) {
  const { t } = useI18n();
  const { data, isLoading } = useGetClerkProxyMetrics({ days });

  if (isLoading || !data) return null;

  const hasDaily = data.daily.some((d) => d.total > 0);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gold-gradient flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-primary" />
        {t('admin.clerkProxy.title')}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={ShieldAlert}
          label={t('admin.clerkProxy.totalErrors')}
          value={data.totalErrors}
          testId="stat-proxy-total-errors"
          lang={lang}
        />
        <StatCard
          icon={AlertTriangle}
          label={t('admin.clerkProxy.degradedCallbacks')}
          value={data.degradedCallbacks}
          testId="stat-proxy-degraded"
          lang={lang}
        />
        <StatCard
          icon={RefreshCw}
          label={t('admin.clerkProxy.retriedErrors')}
          value={data.retriedErrors}
          testId="stat-proxy-retried"
          lang={lang}
        />
      </div>

      <Card className="card-premium">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('admin.clerkProxy.dailyTrend')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasDaily ? (
            <p className="text-sm text-muted-foreground py-4">{t('admin.analytics.noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.daily} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v: string) => v.slice(5)}
                  interval="preserveStartEnd"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                  itemStyle={{ color: 'hsl(var(--muted-foreground))' }}
                  formatter={(value: number, name: string) => [
                    value.toLocaleString(localeOf(lang)),
                    name === 'total'
                      ? t('admin.clerkProxy.total')
                      : t('admin.clerkProxy.degraded'),
                  ]}
                  labelFormatter={(label: string) => label}
                />
                <Bar dataKey="total" fill="hsl(var(--secondary))" radius={[3, 3, 0, 0]} maxBarSize={32} />
                <Bar dataKey="degraded" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <BreakdownTable
          title={t('admin.clerkProxy.byCode')}
          icon={Code2}
          items={data.byCode}
          lang={lang}
          noDataLabel={t('admin.analytics.noData')}
        />
        <BreakdownTable
          title={t('admin.clerkProxy.byWillRetry')}
          icon={RefreshCw}
          items={data.byWillRetry}
          lang={lang}
          noDataLabel={t('admin.analytics.noData')}
        />
        <BreakdownTable
          title={t('admin.clerkProxy.byMethod')}
          icon={Network}
          items={data.byMethod}
          lang={lang}
          noDataLabel={t('admin.analytics.noData')}
        />
      </div>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const { t, lang } = useI18n();
  const [days, setDays] = useState<DayOption>(30);
  const { data, isLoading } = useGetPageViewMetrics({ days });

  const dayLabels: Record<DayOption, string> = {
    7: t('admin.analytics.days7'),
    30: t('admin.analytics.days30'),
    90: t('admin.analytics.days90'),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-gold-gradient">{t('admin.analytics.title')}</h1>
        <div className="flex items-center gap-2">
          {DAY_OPTIONS.map((d) => (
            <Button
              key={d}
              variant={days === d ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(d)}
              data-testid={`button-analytics-days-${d}`}
            >
              {dayLabels[d]}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin me-2" />
          {t('admin.common.loading')}
        </div>
      ) : !data ? (
        <p className="text-muted-foreground">{t('admin.analytics.noData')}</p>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              icon={Eye}
              label={t('admin.analytics.totalViews')}
              value={data.totalViews}
              testId="stat-total-views"
              lang={lang}
            />
            <StatCard
              icon={Users}
              label={t('admin.analytics.uniqueVisitors')}
              value={data.uniqueSessions}
              testId="stat-unique-sessions"
              lang={lang}
            />
          </div>

          {/* Daily trend chart */}
          <Card className="card-premium">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('admin.analytics.dailyTrend')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.daily.every((d) => d.views === 0) ? (
                <p className="text-sm text-muted-foreground py-4">{t('admin.analytics.noData')}</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={data.daily}
                    margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(v: string) => v.slice(5)}
                      interval="preserveStartEnd"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      itemStyle={{ color: 'hsl(var(--muted-foreground))' }}
                      formatter={(value: number, name: string) => [
                        value.toLocaleString(localeOf(lang)),
                        name === 'views' ? t('admin.analytics.views') : t('admin.analytics.unique'),
                      ]}
                      labelFormatter={(label: string) => label}
                    />
                    <Bar
                      dataKey="views"
                      fill="hsl(var(--primary))"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={32}
                    />
                    <Bar
                      dataKey="unique"
                      fill="hsl(var(--secondary))"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={32}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <BreakdownTable
              title={t('admin.analytics.topReferrers')}
              icon={Link2}
              items={data.topReferrers}
              lang={lang}
              noDataLabel={t('admin.analytics.noData')}
            />
            <BreakdownTable
              title={t('admin.analytics.deviceBreakdown')}
              icon={Monitor}
              items={data.deviceBreakdown}
              lang={lang}
              noDataLabel={t('admin.analytics.noData')}
            />
            <BreakdownTable
              title={t('admin.analytics.countryBreakdown')}
              icon={Globe}
              items={data.countryBreakdown}
              lang={lang}
              noDataLabel={t('admin.analytics.noData')}
            />
            <BreakdownTable
              title={t('admin.analytics.topPaths')}
              icon={Eye}
              items={data.topPaths}
              lang={lang}
              noDataLabel={t('admin.analytics.noData')}
            />
          </div>

          {/* Clerk sign-in proxy failures */}
          <ClerkProxyPanel days={days} lang={lang} />
        </>
      )}
    </div>
  );
}
