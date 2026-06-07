import React from 'react';
import { useI18n } from '../../lib/i18n';
import { formatNum } from '../../lib/matchUtils';
import {
  useAdminGetDemoStatus,
  useAdminGetDemoActivity,
  useAdminSeedDemo,
  useAdminTeardownDemo,
  useAdminAdvanceDemo,
  getAdminGetDemoStatusQueryKey,
  getAdminGetDemoActivityQueryKey,
  type AdminDemoActivityEvent,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  FlaskConical,
  PlayCircle,
  Trash2,
  RefreshCw,
  Loader2,
  CalendarClock,
  Radio,
  CheckCircle2,
  Swords,
  Users,
  ListChecks,
  FastForward,
  SkipForward,
  Trophy,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

function StatCard({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <Card data-testid={testId} className="card-premium hover:border-primary/50 transition-colors">
      <CardContent className="p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 glow-green">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold tabular-nums text-gold-gradient">{value.toLocaleString()}</div>
          <div className="text-sm text-muted-foreground truncate">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function relativeTime(at: string, lang: string): string {
  const diff = Date.now() - new Date(at).getTime();
  const sec = Math.max(0, Math.round(diff / 1000));
  const rtf = new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  if (sec < 60) return rtf.format(-sec, 'second');
  const min = Math.round(sec / 60);
  if (min < 60) return rtf.format(-min, 'minute');
  const hr = Math.round(min / 60);
  return rtf.format(-hr, 'hour');
}

function ActivityRow({ ev }: { ev: AdminDemoActivityEvent }) {
  const { t, lang } = useI18n();

  const home = lang === 'ar' ? ev.homeTeamAr : ev.homeTeamEn;
  const away = lang === 'ar' ? ev.awayTeamAr : ev.awayTeamEn;
  // Render as discrete spans (team / score / team) and bidi-isolate the numeric
  // score so a mixed Arabic-name + digit run doesn't scramble in RTL.
  const scoreline =
    home && away ? (
      <span>
        <span>{home}</span>
        <span dir="ltr" className="mx-1 tabular-nums">
          {ev.homeScore != null ? formatNum(ev.homeScore, lang) : '–'}
          {'-'}
          {ev.awayScore != null ? formatNum(ev.awayScore, lang) : '–'}
        </span>
        <span>{away}</span>
      </span>
    ) : null;

  let icon: React.ReactNode;
  let label: string;
  let detail: React.ReactNode = null;
  let accent = 'text-muted-foreground';

  switch (ev.kind) {
    case 'match_live':
      icon = <Radio className="w-4 h-4" />;
      label = t('admin.demo.feed.live');
      accent = 'text-primary';
      detail = (
        <span>
          {scoreline}
          {ev.minute != null && (
            <span className="ms-2 text-xs text-muted-foreground tabular-nums">
              {t('admin.demo.feed.minute').replace('{minute}', formatNum(ev.minute, lang))}
            </span>
          )}
        </span>
      );
      break;
    case 'match_finished':
      icon = <CheckCircle2 className="w-4 h-4" />;
      label = t('admin.demo.feed.finished');
      detail = <span>{scoreline}</span>;
      break;
    case 'points_awarded': {
      icon = <Trophy className="w-4 h-4" />;
      label = t('admin.demo.feed.points');
      accent = 'text-primary';
      const reasonLabel = ev.reason ? t(`admin.demo.feed.reason.${ev.reason}`) : '';
      detail = (
        <span>
          <span className="font-medium text-foreground">{ev.displayName ?? '—'}</span>
          {ev.points != null && (
            <span className="ms-1 text-gold-gradient font-bold tabular-nums">
              {t('admin.demo.feed.pts').replace('{points}', formatNum(ev.points, lang))}
            </span>
          )}
          {reasonLabel && <span className="ms-1 text-xs text-muted-foreground">· {reasonLabel}</span>}
          {scoreline && <span className="block text-xs text-muted-foreground truncate">{scoreline}</span>}
        </span>
      );
      break;
    }
    case 'ranking_change': {
      const up = ev.previousRank != null && ev.rank != null && ev.rank < ev.previousRank;
      icon = up ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />;
      label = t('admin.demo.feed.ranking');
      accent = up ? 'text-primary' : 'text-muted-foreground';
      const tmpl = up ? t('admin.demo.feed.rankUp') : t('admin.demo.feed.rankDown');
      detail = (
        <span>
          <span className="font-medium text-foreground">{ev.displayName ?? '—'}</span>{' '}
          {tmpl
            .replace('{rank}', ev.rank != null ? formatNum(ev.rank, lang) : '—')
            .replace('{previousRank}', ev.previousRank != null ? formatNum(ev.previousRank, lang) : '—')}
        </span>
      );
      break;
    }
    default:
      icon = <Radio className="w-4 h-4" />;
      label = '';
  }

  return (
    <li className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0" data-testid={`activity-row-${ev.kind}`}>
      <div className={`w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground/90">{detail}</div>
      </div>
      <div className="text-xs text-muted-foreground shrink-0 tabular-nums whitespace-nowrap">
        {relativeTime(ev.at, lang)}
      </div>
    </li>
  );
}

export default function AdminDemoPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdminGetDemoStatus();
  const seed = useAdminSeedDemo();
  const teardown = useAdminTeardownDemo();
  const advance = useAdminAdvanceDemo();

  const active = data?.active ?? false;

  const { data: activity } = useAdminGetDemoActivity({
    query: {
      enabled: active,
      refetchInterval: active ? 5000 : false,
      queryKey: getAdminGetDemoActivityQueryKey(),
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getAdminGetDemoStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getAdminGetDemoActivityQueryKey() });
  };

  const onSeed = () => {
    seed.mutate(undefined, {
      onSuccess: () => {
        toast({ description: t('admin.demo.seeded') });
        invalidate();
      },
      onError: (err: unknown) => {
        const status = (err as { status?: number } | null)?.status;
        toast({
          description: status === 409 ? t('admin.demo.alreadyActive') : t('admin.common.error'),
          variant: 'destructive',
        });
      },
    });
  };

  const onTeardown = () => {
    if (!window.confirm(t('admin.demo.confirmTeardown'))) return;
    teardown.mutate(undefined, {
      onSuccess: () => {
        toast({ description: t('admin.demo.tornDown') });
        invalidate();
      },
      onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
    });
  };

  const onAdvance = (body: { minutes?: number; finishLive?: boolean }) => {
    advance.mutate(
      { data: body },
      {
        onSuccess: () => {
          toast({ description: t('admin.demo.advanced') });
          invalidate();
        },
        onError: (err: unknown) => {
          const status = (err as { status?: number } | null)?.status;
          toast({
            description: status === 409 ? t('admin.demo.noActive') : t('admin.common.error'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const disabled = data ? !data.enabled : false;
  const busy = seed.isPending || teardown.isPending || advance.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gold-gradient flex items-center gap-2" data-testid="text-admin-demo-title">
          <FlaskConical className="w-6 h-6" />
          {t('admin.demo.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">{t('admin.demo.subtitle')}</p>
      </div>

      {disabled ? (
        <Card className="card-premium border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">{t('admin.demo.disabledTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{t('admin.demo.disabled')}</CardContent>
        </Card>
      ) : (
        <>
          <Card className="card-premium">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {t('admin.demo.status')}
                {!isLoading && data && (
                  <>
                    <Badge variant={active ? 'default' : 'secondary'} data-testid="badge-demo-active">
                      {active ? t('admin.demo.active') : t('admin.demo.inactive')}
                    </Badge>
                    {active && (
                      <Badge variant={data.engineRunning ? 'default' : 'secondary'} data-testid="badge-demo-engine">
                        {data.engineRunning ? t('admin.demo.engineRunning') : t('admin.demo.engineStopped')}
                      </Badge>
                    )}
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button
                onClick={onSeed}
                disabled={busy || active}
                data-testid="button-demo-seed"
              >
                {seed.isPending ? (
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                ) : (
                  <PlayCircle className="w-4 h-4 me-2" />
                )}
                {seed.isPending ? t('admin.demo.seeding') : t('admin.demo.seed')}
              </Button>
              <Button
                onClick={onTeardown}
                disabled={busy || !active}
                variant="destructive"
                data-testid="button-demo-teardown"
              >
                {teardown.isPending ? (
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 me-2" />
                )}
                {teardown.isPending ? t('admin.demo.tearingDown') : t('admin.demo.teardown')}
              </Button>
              <Button
                onClick={invalidate}
                variant="outline"
                className="ms-auto"
                data-testid="button-demo-refresh"
              >
                <RefreshCw className="w-4 h-4 me-2" />
                {t('admin.demo.refresh')}
              </Button>
            </CardContent>
          </Card>

          <Card className="card-premium">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FastForward className="w-4 h-4 text-primary" />
                {t('admin.demo.clock')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground max-w-3xl">{t('admin.demo.clockHint')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => onAdvance({ minutes: 5 })}
                  disabled={busy || !active}
                  variant="outline"
                  data-testid="button-demo-advance-5"
                >
                  <FastForward className="w-4 h-4 me-2" />
                  {t('admin.demo.advance5')}
                </Button>
                <Button
                  onClick={() => onAdvance({ minutes: 15 })}
                  disabled={busy || !active}
                  variant="outline"
                  data-testid="button-demo-advance-15"
                >
                  <FastForward className="w-4 h-4 me-2" />
                  {t('admin.demo.advance15')}
                </Button>
                <Button
                  onClick={() => onAdvance({ minutes: 30 })}
                  disabled={busy || !active}
                  variant="outline"
                  data-testid="button-demo-advance-30"
                >
                  <FastForward className="w-4 h-4 me-2" />
                  {t('admin.demo.advance30')}
                </Button>
                <Button
                  onClick={() => onAdvance({ finishLive: true })}
                  disabled={busy || !active}
                  data-testid="button-demo-finish-live"
                >
                  {advance.isPending ? (
                    <Loader2 className="w-4 h-4 me-2 animate-spin" />
                  ) : (
                    <SkipForward className="w-4 h-4 me-2" />
                  )}
                  {advance.isPending ? t('admin.demo.advancing') : t('admin.demo.finishLive')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard icon={ListChecks} label={t('admin.demo.totalMatches')} value={data?.totalMatches ?? 0} testId="stat-demo-total" />
              <StatCard icon={CalendarClock} label={t('admin.demo.upcoming')} value={data?.upcoming ?? 0} testId="stat-demo-upcoming" />
              <StatCard icon={Radio} label={t('admin.demo.live')} value={data?.live ?? 0} testId="stat-demo-live" />
              <StatCard icon={CheckCircle2} label={t('admin.demo.finished')} value={data?.finished ?? 0} testId="stat-demo-finished" />
              <StatCard icon={Swords} label={t('admin.demo.challenges')} value={data?.challenges ?? 0} testId="stat-demo-challenges" />
              <StatCard icon={Users} label={t('admin.demo.users')} value={data?.users ?? 0} testId="stat-demo-users" />
            </div>
          )}

          {active && (
            <Card className="card-premium" data-testid="card-demo-activity">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Radio className="w-4 h-4 text-primary" />
                  {t('admin.demo.feed.title')}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t('admin.demo.feed.subtitle')}</p>
              </CardHeader>
              <CardContent>
                {!activity || activity.events.length === 0 ? (
                  <div className="py-6 text-sm text-muted-foreground" data-testid="text-demo-activity-empty">
                    {t('admin.demo.feed.empty')}
                  </div>
                ) : (
                  <ul className="max-h-[28rem] overflow-y-auto" data-testid="list-demo-activity">
                    {activity.events.map((ev) => (
                      <ActivityRow key={ev.id} ev={ev} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
