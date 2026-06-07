import React from 'react';
import { useI18n } from '../../lib/i18n';
import {
  useAdminGetDemoStatus,
  useAdminSeedDemo,
  useAdminTeardownDemo,
  getAdminGetDemoStatusQueryKey,
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

export default function AdminDemoPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdminGetDemoStatus();
  const seed = useAdminSeedDemo();
  const teardown = useAdminTeardownDemo();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getAdminGetDemoStatusQueryKey() });

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

  const disabled = data ? !data.enabled : false;
  const active = data?.active ?? false;
  const busy = seed.isPending || teardown.isPending;

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
        </>
      )}
    </div>
  );
}
