import React from 'react';
import { useI18n } from '../lib/i18n';
import { formatNum } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import {
  useGetMySocial,
  useRespondFriendRequest,
  useCancelFriendRequest,
} from '@workspace/api-client-react';
import type { FriendRequestItem } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, UserPlus, Inbox, Send, Check, X, Clock } from 'lucide-react';
import { PlayerCard } from '../components/social/player-card';
import {
  RelationshipButtons,
  useInvalidateSocial,
} from '../components/social/relationship-buttons';

function IncomingActions({ item }: { item: FriendRequestItem }) {
  const { t } = useI18n();
  const invalidate = useInvalidateSocial();
  const respond = useRespondFriendRequest({
    mutation: { onSuccess: () => invalidate(item.user.userId) },
  });
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={respond.isPending}
        onClick={() => respond.mutate({ requestId: item.id, data: { accept: true } })}
        data-testid={`button-accept-${item.id}`}
      >
        <Check className="w-4 h-4 me-1.5" />
        {t('social.accept')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={respond.isPending}
        onClick={() => respond.mutate({ requestId: item.id, data: { accept: false } })}
        data-testid={`button-decline-${item.id}`}
      >
        <X className="w-4 h-4 me-1.5" />
        {t('social.decline')}
      </Button>
    </div>
  );
}

function OutgoingActions({ item }: { item: FriendRequestItem }) {
  const { t } = useI18n();
  const invalidate = useInvalidateSocial();
  const cancel = useCancelFriendRequest({
    mutation: { onSuccess: () => invalidate(item.user.userId) },
  });
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={cancel.isPending}
      onClick={() => cancel.mutate({ id: item.user.userId })}
      data-testid={`button-cancel-${item.id}`}
    >
      <Clock className="w-4 h-4 me-1.5" />
      {t('social.cancelRequest')}
    </Button>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  empty,
  emptyText,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  const { lang } = useI18n();
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" />
        {title}
        {count > 0 && (
          <Badge variant="outline" className="text-[11px] py-0 border-primary/30 text-primary bg-primary/10">
            {formatNum(count, lang)}
          </Badge>
        )}
      </h2>
      {empty ? (
        <p className="text-sm text-muted-foreground py-3">{emptyText}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

export default function SocialPage() {
  const { t } = useI18n();
  const { data, isLoading } = useGetMySocial();

  const friends = data?.friends ?? [];
  const incoming = data?.incomingRequests ?? [];
  const outgoing = data?.outgoingRequests ?? [];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <UserPlus className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('social.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('social.subtitle')}</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-center text-muted-foreground py-12">{t('common.loading')}</p>
        ) : (
          <>
            <Section
              icon={Inbox}
              title={t('social.incoming')}
              count={incoming.length}
              empty={incoming.length === 0}
              emptyText={t('social.noIncoming')}
            >
              {incoming.map((item) => (
                <PlayerCard
                  key={item.id}
                  player={item.user}
                  actions={<IncomingActions item={item} />}
                />
              ))}
            </Section>

            <Section
              icon={Send}
              title={t('social.outgoing')}
              count={outgoing.length}
              empty={outgoing.length === 0}
              emptyText={t('social.noOutgoing')}
            >
              {outgoing.map((item) => (
                <PlayerCard
                  key={item.id}
                  player={item.user}
                  actions={<OutgoingActions item={item} />}
                />
              ))}
            </Section>

            <Section
              icon={Users}
              title={t('social.friends')}
              count={friends.length}
              empty={friends.length === 0}
              emptyText={t('social.noFriends')}
            >
              {friends.map((friend) => (
                <PlayerCard
                  key={friend.userId}
                  player={friend}
                  actions={
                    <RelationshipButtons userId={friend.userId} viewer={friend.viewer} size="sm" />
                  }
                />
              ))}
            </Section>
          </>
        )}
      </div>
    </Layout>
  );
}
