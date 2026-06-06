import React from 'react';
import { useI18n } from '../lib/i18n';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Bell } from 'lucide-react';
import {
  useGetUnreadNotificationCount,
  getGetUnreadNotificationCountQueryKey,
} from '@workspace/api-client-react';

export function NotificationBell() {
  const { t } = useI18n();
  const { data } = useGetUnreadNotificationCount({
    query: {
      queryKey: getGetUnreadNotificationCountQueryKey(),
      refetchInterval: 60_000,
    },
  });
  const count = data?.unreadCount ?? 0;

  return (
    <Link href="/notifications">
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={t('nav.notifications')}
        data-testid="button-notification-bell"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span
            className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
            data-testid="badge-unread-count"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Button>
    </Link>
  );
}
