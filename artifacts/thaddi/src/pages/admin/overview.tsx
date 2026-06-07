import React from 'react';
import { useI18n } from '../../lib/i18n';
import { useGetAdminOverview } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  ShieldCheck,
  UserX,
  Trophy,
  CalendarDays,
  Flag,
  Swords,
  Activity,
  Target,
  CreditCard,
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
    <Card data-testid={testId}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
          <div className="text-sm text-muted-foreground truncate">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminOverviewPage() {
  const { t } = useI18n();
  const { data, isLoading } = useGetAdminOverview();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold" data-testid="text-admin-overview-title">
          {t('admin.overview.title')}
        </h1>
        {data && (
          <Badge variant={data.liveProviderConfigured ? 'default' : 'secondary'} data-testid="badge-provider">
            {t('admin.overview.provider')}: {data.provider}{' '}
            {data.liveProviderConfigured ? `(${t('admin.overview.live')})` : `(${t('admin.overview.mock')})`}
          </Badge>
        )}
      </div>

      {isLoading || !data ? (
        <div className="text-muted-foreground">{t('admin.common.loading')}</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard icon={Users} label={t('admin.overview.users')} value={data.totalUsers} testId="stat-users" />
          <StatCard icon={ShieldCheck} label={t('admin.overview.admins')} value={data.totalAdmins} testId="stat-admins" />
          <StatCard icon={UserX} label={t('admin.overview.suspended')} value={data.suspendedUsers} testId="stat-suspended" />
          <StatCard icon={Trophy} label={t('admin.overview.tournaments')} value={data.totalTournaments} testId="stat-tournaments" />
          <StatCard icon={CalendarDays} label={t('admin.overview.matches')} value={data.totalMatches} testId="stat-matches" />
          <StatCard icon={Flag} label={t('admin.overview.teams')} value={data.totalTeams} testId="stat-teams" />
          <StatCard icon={Swords} label={t('admin.overview.challenges')} value={data.totalChallenges} testId="stat-challenges" />
          <StatCard icon={Activity} label={t('admin.overview.activeChallenges')} value={data.activeChallenges} testId="stat-active-challenges" />
          <StatCard icon={Target} label={t('admin.overview.predictions')} value={data.totalPredictions} testId="stat-predictions" />
          <StatCard icon={CreditCard} label={t('admin.overview.subscriptions')} value={data.totalSubscriptions} testId="stat-subscriptions" />
          <StatCard icon={CreditCard} label={t('admin.overview.activeSubscriptions')} value={data.activeSubscriptions} testId="stat-active-subscriptions" />
        </div>
      )}
    </div>
  );
}
