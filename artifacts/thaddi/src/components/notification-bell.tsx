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
        className="relative hover:bg-secondary/10 hover:text-secondary rounded-xl transition-colors"
        aria-label={t('nav.notifications')}
        data-testid="button-notification-bell"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span
            className="absolute -top-1 -end-1 min-w-[20px] h-[20px] px-1 rounded-full bg-secondary text-secondary-foreground text-[10px] font-black flex items-center justify-center shadow-[0_0_10px_rgba(200,160,50,0.5)] ring-2 ring-background"
            data-testid="badge-unread-count"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Button>
    </Link>
  );
}
