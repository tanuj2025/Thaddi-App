import React from 'react';
import { useI18n } from '../lib/i18n';
import { useFeatureFlag } from '../lib/useFeatureFlag';
import { Leaderboard } from './leaderboard';
import {
  useGetChallengeRanking,
  getGetChallengeRankingQueryKey,
  useGetWinningProbability,
  getGetWinningProbabilityQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, TrendingUp } from 'lucide-react';
import { formatNum } from '../lib/matchUtils';

export function ChallengeLeaderboard({ challengeId }: { challengeId: string }) {
  const { t } = useI18n();
  const { data, isLoading } = useGetChallengeRanking(challengeId, {
    query: { queryKey: getGetChallengeRankingQueryKey(challengeId) },
  });

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          {t('rankings.challengeStandings')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <Leaderboard
            entries={data?.entries ?? []}
            me={data?.me ?? null}
            emptyText={t('rankings.empty')}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ProbStat({ label, pct, lang }: { label: string; pct: number; lang: string }) {
  return (
    <div className="rounded-xl border border-border p-3 text-center">
      <p className="text-2xl font-extrabold tabular-nums text-primary">
        {formatNum(Math.round(pct), lang as 'ar' | 'en')}%
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

export function WinningProbabilityCard({ challengeId }: { challengeId: string }) {
  const { t, lang } = useI18n();
  const enabled = useFeatureFlag('winning_probability');
  const { data } = useGetWinningProbability(challengeId, {
    query: { enabled, queryKey: getGetWinningProbabilityQueryKey(challengeId) },
  });

  if (!enabled || !data) return null;

  return (
    <Card className="border-primary/30 bg-gradient-to-b from-primary/5 to-transparent">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          {t('winprob.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <ProbStat label={t('winprob.first')} pct={data.firstPlacePct} lang={lang} />
          <ProbStat label={t('winprob.topThree')} pct={data.topThreePct} lang={lang} />
          <ProbStat label={t('winprob.topTen')} pct={data.topTenPct} lang={lang} />
        </div>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t('winprob.rankOf')
              .replace('{rank}', formatNum(data.rank, lang))
              .replace('{total}', formatNum(data.participants, lang))}
          </span>
          <span>
            {t('winprob.gap')}: {formatNum(data.pointsGapToLead, lang)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground text-end">
          {t('winprob.remaining')}: {formatNum(data.remainingMatches, lang)}
        </div>
      </CardContent>
    </Card>
  );
}
