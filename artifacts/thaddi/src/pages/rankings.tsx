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
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/10 text-secondary ring-1 ring-secondary/20 shadow-[0_0_15px_rgba(200,160,50,0.15)]">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-gold-gradient">{t('rankings.title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('rankings.subtitle')}</p>
          </div>
        </div>

        {me && (
          <Card className="card-premium glow-gold border-secondary/30 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-secondary/10 to-transparent pointer-events-none" />
            <CardContent className="p-6 flex items-center justify-between gap-4 relative z-10">
              <div>
                <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1">{t('rankings.yourRank')}</p>
                <p className="text-4xl font-black tabular-nums text-foreground" dir="ltr">
                  #{formatNum(me.rank, lang)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="text-secondary font-bold">{formatNum(me.points, lang)}</span> {t('rankings.points')}
                </p>
              </div>
              <Button
                className="bg-[#25D366] hover:bg-[#1da851] text-white shadow-lg transition-transform hover:scale-105"
                onClick={shareRank}
                data-testid="button-share-rank"
              >
                <MessageCircle className="w-4 h-4 me-2" />
                {t('rankings.share')}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="card-premium border-border/50">
          <CardHeader className="border-b border-border/50 pb-4">
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <Trophy className="w-5 h-5 text-secondary" />
              {t('rankings.standings')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
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
