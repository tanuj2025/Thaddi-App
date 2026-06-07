import React from 'react';
import { useI18n } from '../lib/i18n';
import { localeOf } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import {
  useGetMyNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getGetMyNotificationsQueryKey,
  getGetUnreadNotificationCountQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, CheckCheck } from 'lucide-react';

export default function NotificationsPage() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetMyNotifications();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
  };

  const markRead = useMarkNotificationRead({ mutation: { onSuccess: invalidate } });
  const markAll = useMarkAllNotificationsRead({ mutation: { onSuccess: invalidate } });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Bell className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{t('notif.title')}</h1>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-4 h-4" />
              {t('notif.markAllRead')}
            </Button>
          )}
        </div>

        {isLoading ? (
          <p className="text-muted-foreground text-center py-12">{t('notif.loading')}</p>
        ) : notifications.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t('notif.empty')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <Card
                key={n.id}
                className={`transition-colors ${n.read ? '' : 'border-primary/40 bg-primary/[0.03]'}`}
                data-testid={`notification-${n.id}`}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{lang === 'ar' ? n.titleAr : n.titleEn}</p>
                    {(n.bodyAr || n.bodyEn) && (
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {lang === 'ar' ? n.bodyAr : n.bodyEn}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {new Date(n.createdAt).toLocaleString(localeOf(lang))}
                    </p>
                  </div>
                  {!n.read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => markRead.mutate({ id: n.id })}
                      disabled={markRead.isPending}
                      data-testid={`button-mark-read-${n.id}`}
                    >
                      {t('notif.markRead')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
