import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import {
  useAdminListSubscriptions,
  useAdminUpdateSubscription,
  getAdminListSubscriptionsQueryKey,
  type AdminSubscription,
} from '@workspace/api-client-react';
import { AdminSubscriptionUpdateStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

function formatDate(value?: string | null, lang?: string) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium' });
  } catch {
    return value;
  }
}

function statusBadge(status: string) {
  if (status === 'active') return <Badge>{status}</Badge>;
  if (status === 'expired') return <Badge variant="secondary">{status}</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}

export default function AdminSubscriptionsPage() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { data: list, isLoading } = useAdminListSubscriptions({
    status: statusFilter === 'all' ? undefined : statusFilter,
    limit: 100,
  });
  const update = useAdminUpdateSubscription();

  const onUpdate = (sub: AdminSubscription, status: (typeof AdminSubscriptionUpdateStatus)[keyof typeof AdminSubscriptionUpdateStatus]) => {
    update.mutate(
      { id: sub.id, data: { status } },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListSubscriptionsQueryKey() });
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-subscriptions-title">{t('admin.subscriptions.title')}</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-subscription-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.common.all')}</SelectItem>
            {Object.values(AdminSubscriptionUpdateStatus).map((st) => (
              <SelectItem key={st} value={st}>{st}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="card-premium">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !list || list.subscriptions.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.subscriptions.user')}</TableHead>
                  <TableHead>{t('admin.subscriptions.plan')}</TableHead>
                  <TableHead>{t('admin.subscriptions.edition')}</TableHead>
                  <TableHead>{t('admin.subscriptions.started')}</TableHead>
                  <TableHead>{t('admin.subscriptions.expires')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.subscriptions.map((s) => (
                  <TableRow key={s.id} data-testid={`row-subscription-${s.id}`}>
                    <TableCell className="font-medium">{s.userName ?? '—'}</TableCell>
                    <TableCell>{s.planNameEn ?? s.planCode ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.edition ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(s.startedAt, lang)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(s.expiresAt, lang)}</TableCell>
                    <TableCell>{statusBadge(s.status)}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        {s.status === 'active' && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => onUpdate(s, 'expired')} disabled={update.isPending} data-testid={`button-expire-${s.id}`}>
                              {t('admin.subscriptions.markExpired')}
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => onUpdate(s, 'cancelled')} disabled={update.isPending} data-testid={`button-cancel-sub-${s.id}`}>
                              {t('admin.subscriptions.cancel')}
                            </Button>
                          </>
                        )}
                        {s.status !== 'active' && (
                          <Button variant="outline" size="sm" onClick={() => onUpdate(s, 'active')} disabled={update.isPending} data-testid={`button-activate-sub-${s.id}`}>
                            {t('admin.subscriptions.activate')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
