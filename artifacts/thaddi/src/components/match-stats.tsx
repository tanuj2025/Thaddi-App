import React from 'react';
import { useI18n } from '../lib/i18n';
import { useFeatureFlag } from '../lib/useFeatureFlag';
import {
  useGetMatchTrends,
  getGetMatchTrendsQueryKey,
  useGetMatchComparison,
  getGetMatchComparisonQueryKey,
} from '@workspace/api-client-react';
import type { ComparisonScorelineRarity, MatchDetail } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { BarChart3, Sparkles } from 'lucide-react';
import { formatNum, type Lang } from '../lib/matchUtils';

const rarityStyles: Record<string, string> = {
  popular: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
  common: 'bg-muted text-muted-foreground border-border',
  bold: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  rare: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30',
};

function teamName(
  team: MatchDetail['homeTeam'],
  lang: Lang,
): string {
  if (!team) return '—';
  return lang === 'ar' ? team.nameAr : team.nameEn;
}

function TrendBar({ label, pct, lang }: { label: string; pct: number; lang: Lang }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground truncate">{label}</span>
        <span className="font-bold tabular-nums">{formatNum(pct, lang)}%</span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

export function TrendsCard({ m }: { m: MatchDetail }) {
  const { t, lang } = useI18n();
  const showRarity = useFeatureFlag('rare_predictions');
  const { data } = useGetMatchTrends(m.id, {
    query: { queryKey: getGetMatchTrendsQueryKey(m.id) },
  });

  const total = data?.total ?? 0;

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          {t('trends.title')}
          {showRarity && data?.myRarity && (
            <Badge
              variant="outline"
              className={`ms-auto text-[10px] ${rarityStyles[data.myRarity] || ''}`}
            >
              <Sparkles className="w-3 h-3 me-1" />
              {t('rarity.yourPick')} · {t(`rarity.${data.myRarity}`)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('trends.empty')}
          </p>
        ) : (
          <>
            <TrendBar
              label={t('trends.homeWin').replace('{team}', teamName(m.homeTeam, lang))}
              pct={data?.homeWinPct ?? 0}
              lang={lang}
            />
            <TrendBar label={t('trends.draw')} pct={data?.drawPct ?? 0} lang={lang} />
            <TrendBar
              label={t('trends.awayWin').replace('{team}', teamName(m.awayTeam, lang))}
              pct={data?.awayWinPct ?? 0}
              lang={lang}
            />
            <p className="text-xs text-muted-foreground pt-1">
              {t('trends.basedOn').replace('{count}', formatNum(total, lang))}
              {!data?.locked && ` · ${t('trends.beforeLock')}`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ComparisonCard({ m }: { m: MatchDetail }) {
  const { t, lang } = useI18n();
  const enabled = useFeatureFlag('prediction_comparison');
  const showRarity = useFeatureFlag('rare_predictions');
  const { data } = useGetMatchComparison(m.id, {
    query: { enabled, queryKey: getGetMatchComparisonQueryKey(m.id) },
  });

  if (!enabled) return null;

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-lg">{t('comparison.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data?.revealed ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('comparison.beforeKickoff')}
          </p>
        ) : data.scorelines.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('trends.empty')}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('comparison.popularScores')}
            </p>
            {data.scorelines.map((s) => (
              <div
                key={`${s.homeScore}-${s.awayScore}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="font-bold tabular-nums text-lg" dir="ltr">
                  {formatNum(s.homeScore, lang)}-{formatNum(s.awayScore, lang)}
                </span>
                <div className="flex items-center gap-2">
                  {showRarity && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        rarityStyles[s.rarity as ComparisonScorelineRarity] || ''
                      }`}
                    >
                      {t(`rarity.${s.rarity}`)}
                    </Badge>
                  )}
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {formatNum(s.pct, lang)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
