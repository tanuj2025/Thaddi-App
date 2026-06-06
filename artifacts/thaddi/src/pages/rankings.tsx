import React from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Leaderboard } from '../components/leaderboard';
import {
  useGetGlobalRanking,
  getGetGlobalRankingQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, MessageCircle } from 'lucide-react';
import { formatNum } from '../lib/matchUtils';

export default function RankingsPage() {
  const { t, lang } = useI18n();
  const { data, isLoading } = useGetGlobalRanking(undefined, {
    query: { queryKey: getGetGlobalRankingQueryKey() },
  });

  const me = data?.me ?? null;

  const shareRank = () => {
    if (!me) return;
    const msg = t('rankings.shareMessage').replace(
      '{rank}',
      formatNum(me.rank, lang),
    );
    const base = import.meta.env.BASE_URL;
    const url = `${window.location.origin}${base}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${msg} ${url}`)}`,
      '_blank',
    );
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('rankings.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('rankings.subtitle')}</p>
          </div>
        </div>

        {me && (
          <Card className="border-primary/30 bg-gradient-to-b from-primary/10 to-transparent">
            <CardContent className="p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{t('rankings.yourRank')}</p>
                <p className="text-3xl font-extrabold tabular-nums text-primary">
                  #{formatNum(me.rank, lang)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatNum(me.points, lang)} {t('rankings.points')}
                </p>
              </div>
              <Button
                className="bg-[#25D366] hover:bg-[#1da851] text-white"
                onClick={shareRank}
                data-testid="button-share-rank"
              >
                <MessageCircle className="w-4 h-4 me-2" />
                {t('rankings.share')}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg">{t('rankings.standings')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : (
              <Leaderboard
                entries={data?.entries ?? []}
                me={me}
                emptyText={t('rankings.empty')}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
