import React from 'react';
import { useI18n } from '../lib/i18n';
import { useFeatureFlag } from '../lib/useFeatureFlag';
import { Leaderboard } from './leaderboard';
import {
  useGetChallengeRanking,
  getGetChallengeRankingQueryKey,
  useGetWinningProbability,
  getGetWinningProbabilityQueryKey,
  useGetChallengeMatches,
  getGetChallengeMatchesQueryKey,
  useGetRankingImpact,
  getGetRankingImpactQueryKey,
  type MatchSummary,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, TrendingUp, ArrowUp, ArrowDown, Minus, Radio } from 'lucide-react';
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

function pickImpactMatch(matches: MatchSummary[] | undefined): MatchSummary | null {
  if (!matches || matches.length === 0) return null;
  const live = matches.find(
    (m) => m.status === 'live' || m.status === 'half_time',
  );
  if (live) return live;
  const lockedNotFinal = matches
    .filter((m) => m.isLocked && m.status !== 'finished')
    .sort((a, b) => +new Date(a.kickoffAt) - +new Date(b.kickoffAt));
  return lockedNotFinal[0] ?? null;
}

function ImpactRank({
  label,
  rank,
  lang,
  highlight,
}: {
  label: string;
  rank: number | null | undefined;
  lang: 'ar' | 'en';
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border p-3 text-center">
      <p
        className={`text-2xl font-extrabold tabular-nums ${
          highlight ? 'text-primary' : 'text-foreground'
        }`}
      >
        {rank == null ? '—' : `#${formatNum(rank, lang)}`}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

export function RankingImpactCard({ challengeId }: { challengeId: string }) {
  const { t, lang } = useI18n();
  const { data: matches } = useGetChallengeMatches(challengeId, {
    query: { queryKey: getGetChallengeMatchesQueryKey(challengeId) },
  });
  const target = pickImpactMatch(matches);
  const { data } = useGetRankingImpact(challengeId, target?.id ?? '', {
    query: {
      enabled: Boolean(target?.id),
      queryKey: getGetRankingImpactQueryKey(challengeId, target?.id ?? ''),
    },
  });

  if (!target || !data) return null;

  const delta = data.pointsDelta;
  const moved =
    data.currentRank != null &&
    data.projectedRank != null &&
    data.projectedRank !== data.currentRank;
  const improved =
    data.currentRank != null &&
    data.projectedRank != null &&
    data.projectedRank < data.currentRank;

  return (
    <Card className="border-primary/30 bg-gradient-to-b from-primary/5 to-transparent">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          {t('impact.title')}
          {data.live && (
            <span className="ms-auto inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-500">
              <Radio className="w-3 h-3" />
              {t('impact.live')}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.hasPrediction ? (
          <p className="text-sm text-muted-foreground text-center py-2">
            {t('impact.noPrediction')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <ImpactRank
                label={t('impact.currentRank')}
                rank={data.currentRank}
                lang={lang}
              />
              <ImpactRank
                label={t('impact.projectedRank')}
                rank={data.projectedRank}
                lang={lang}
                highlight
              />
            </div>
            <div className="flex items-center justify-center gap-2 text-sm">
              {moved ? (
                improved ? (
                  <ArrowUp className="w-4 h-4 text-emerald-500" />
                ) : (
                  <ArrowDown className="w-4 h-4 text-red-500" />
                )
              ) : (
                <Minus className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-muted-foreground">
                {t('impact.pointsGain')}:
              </span>
              <span
                className={`font-bold tabular-nums ${
                  delta > 0 ? 'text-emerald-500' : 'text-foreground'
                }`}
              >
                {delta > 0 ? '+' : ''}
                {formatNum(delta, lang)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
