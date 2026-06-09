import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { localeOf, type Lang } from '../../lib/matchUtils';
import {
  useAdminListSubscriptions,
  useAdminUpdateSubscription,
  useAdminListBadgePurchases,
  getAdminListSubscriptionsQueryKey,
  type AdminSubscription,
  type AdminBadgePurchase,
} from '@workspace/api-client-react';
import { AdminSubscriptionUpdateStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Sparkles } from 'lucide-react';

function formatDate(value?: string | null, lang?: Lang) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(localeOf(lang ?? 'en', 'en-GB'), { dateStyle: 'medium' });
  } catch {
    return value;
  }
}

function statusBadge(status: string) {
  if (status === 'active') return <Badge>{status}</Badge>;
  if (status === 'expired') return <Badge variant="secondary">{status}</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}

function BadgePurchasesSection({ lang }: { lang: Lang }) {
  const { t } = useI18n();
  const { data, isLoading } = useAdminListBadgePurchases({ limit: 200 });

  const badgeName = (p: AdminBadgePurchase) =>
    lang === 'ar' ? p.badgeNameAr || p.badgeNameEn : p.badgeNameEn || p.badgeNameAr;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-gold" />
        {t('admin.badgePurchases.title')}
        {data && (
          <span className="text-sm font-normal text-muted-foreground ms-1">({data.total})</span>
        )}
      </h2>

      <Card className="card-premium">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !data || data.purchases.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.badgePurchases.badge')}</TableHead>
                  <TableHead>{t('admin.badgePurchases.challenge')}</TableHead>
                  <TableHead>{t('admin.badgePurchases.buyer')}</TableHead>
                  <TableHead>{t('admin.badgePurchases.price')}</TableHead>
                  <TableHead>{t('admin.badgePurchases.payment')}</TableHead>
                  <TableHead>{t('admin.badgePurchases.date')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.purchases.map((p) => (
                  <TableRow key={p.id} data-testid={`row-badge-purchase-${p.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {p.badgeIconUrl && (
                          <img src={p.badgeIconUrl} alt="" className="h-6 w-6 rounded object-contain" />
                        )}
                        <div>
                          <div className="font-medium">{badgeName(p)}</div>
                          <div className="text-xs text-muted-foreground">{p.badgeCode}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{p.challengeName ?? '—'}</TableCell>
                    <TableCell className="text-sm">{p.buyerName ?? '—'}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {p.priceSar !== '0' ? `${p.priceSar} SAR` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {p.paymentReference
                        ? p.paymentReference.slice(0, 16) + (p.paymentReference.length > 16 ? '…' : '')
                        : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(p.purchasedAt as unknown as string, lang)}
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
    <div className="space-y-10">
      {/* Subscriptions */}
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

      {/* Badge purchases */}
      <BadgePurchasesSection lang={lang} />
    </div>
  );
}
