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
import { BarChart3, Scale } from 'lucide-react';
import { formatNum, type Lang } from '../lib/matchUtils';

const rarityStyles: Record<string, string> = {
  popular: 'bg-primary/15 text-primary border-primary/30',
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

function TrendBar({ label, pct, lang, colorClass = 'bg-primary' }: { label: string; pct: number; lang: Lang; colorClass?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs font-semibold text-foreground">
        <span className="truncate pr-2">{label}</span>
        <span className="font-mono tabular-nums text-muted-foreground font-bold">{formatNum(pct, lang)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
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
    <Card className="border-border/80 shadow-sm bg-card">
      <CardHeader className="border-b border-border/50 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            <span>{t('trends.title')}</span>
          </CardTitle>
          {showRarity && data?.myRarity && (
            <Badge variant="outline" className={`text-[10px] font-bold px-2 py-0.5 rounded ${rarityStyles[data.myRarity] || ''}`}>
              {t('rarity.yourPick')} · {t(`rarity.${data.myRarity}`)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {total === 0 ? (
          <p className="text-sm font-medium text-muted-foreground text-center py-4">
            {t('trends.empty')}
          </p>
        ) : (
          <div className="space-y-3.5">
            <TrendBar
              label={t('trends.homeWin').replace('{team}', teamName(m.homeTeam, lang))}
              pct={data?.homeWinPct ?? 0}
              lang={lang}
              colorClass="bg-primary"
            />
            <TrendBar
              label={t('trends.draw')}
              pct={data?.drawPct ?? 0}
              lang={lang}
              colorClass="bg-muted-foreground/60"
            />
            <TrendBar
              label={t('trends.awayWin').replace('{team}', teamName(m.awayTeam, lang))}
              pct={data?.awayWinPct ?? 0}
              lang={lang}
              colorClass="bg-foreground/80"
            />
            <div className="pt-2 border-t border-border/40">
              <p className="text-[11px] font-medium text-muted-foreground text-center">
                {t('trends.basedOn').replace('{count}', formatNum(total, lang))}
                {!data?.locked && ` · ${t('trends.beforeLock')}`}
              </p>
            </div>
          </div>
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
    <Card className="border-border/80 shadow-sm bg-card">
      <CardHeader className="border-b border-border/50 pb-3">
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Scale className="w-4 h-4" />
          <span>{t('comparison.title')}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {!data?.revealed ? (
          <p className="text-sm font-medium text-muted-foreground text-center py-4">
            {t('comparison.beforeKickoff')}
          </p>
        ) : data.scorelines.length === 0 ? (
          <p className="text-sm font-medium text-muted-foreground text-center py-4">
            {t('trends.empty')}
          </p>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('comparison.popularScores')}
            </p>
            <div className="grid gap-2">
              {data.scorelines.map((s) => (
                <div
                  key={`${s.homeScore}-${s.awayScore}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 border border-border/60 px-3.5 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <span className="font-mono font-bold text-base text-foreground" dir="ltr">
                    {formatNum(s.homeScore, lang)} - {formatNum(s.awayScore, lang)}
                  </span>
                  <div className="flex items-center gap-2">
                    {showRarity && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          rarityStyles[s.rarity as ComparisonScorelineRarity] || ''
                        }`}
                      >
                        {t(`rarity.${s.rarity}`)}
                      </Badge>
                    )}
                    <span className="text-xs font-mono font-bold text-muted-foreground">
                      {formatNum(s.pct, lang)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
