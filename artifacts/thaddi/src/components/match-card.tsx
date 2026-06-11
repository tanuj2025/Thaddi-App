import React from 'react';
import { Link } from 'wouter';
import { useI18n } from '../lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Clock, Check } from 'lucide-react';
import type { MatchSummary, TeamRef } from '@workspace/api-client-react';
import {
  useCountdown,
  formatCountdown,
  formatKickoff,
  formatNum,
  outcomeStyles,
  matchPhase,
  matchPhaseLabelKey,
  isLivePhase,
  phaseShowsMinute,
  type Lang,
} from '../lib/matchUtils';

export function TeamFlag({ team }: { team?: TeamRef | null }) {
  const { lang } = useI18n();
  const name = team ? (lang === 'ar' ? team.nameAr : team.nameEn) : '—';
  return (
    <div className="flex items-center gap-2 min-w-0">
      {team?.flagUrl ? (
        <img
          src={team.flagUrl}
          alt=""
          className="w-7 h-5 rounded-sm object-cover shrink-0 ring-1 ring-border"
        />
      ) : (
        <div className="w-7 h-5 rounded-sm bg-muted shrink-0" />
      )}
      <span className="font-semibold truncate">{name}</span>
    </div>
  );
}

export function ScoreOrTime({ m, lang }: { m: MatchSummary; lang: Lang }) {
  const { t } = useI18n();
  const cd = useCountdown(m.predictionLockAt);

  if (m.hasKickedOff || m.status === 'finished' || m.status === 'full_time') {
    return (
      <div className="flex flex-col items-center px-3">
        <div className="flex items-center gap-2 text-2xl font-extrabold tabular-nums" dir="ltr">
          <span>{formatNum(m.homeScore ?? 0, lang)}</span>
          <span className="text-muted-foreground text-lg">-</span>
          <span>{formatNum(m.awayScore ?? 0, lang)}</span>
        </div>
      </div>
    );
  }

  if (cd && !cd.done && m.predictionLockAt) {
    return (
      <div className="flex flex-col items-center px-3 text-center">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('matches.locksIn')}
        </span>
        <span className="text-sm font-bold text-primary tabular-nums" dir="ltr">
          {formatCountdown(cd, lang, {
            days: t('match.days'),
            hours: t('match.hours'),
            minutes: t('match.minutes'),
            seconds: t('match.seconds'),
          })}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-3 text-center">
      <Clock className="w-4 h-4 text-muted-foreground" />
      <span className="text-[10px] text-muted-foreground mt-1">{t('matches.locked')}</span>
    </div>
  );
}

export function StatusBadge({ m }: { m: MatchSummary }) {
  const { t, lang } = useI18n();
  const phase = matchPhase(m.status, m.minute);

  if (isLivePhase(phase)) {
    return (
      <Badge className="bg-red-500 text-white border-transparent gap-1.5 animate-pulse shrink-0 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
        {t(matchPhaseLabelKey[phase])}
        {phaseShowsMinute(phase) && m.minute != null && (
          <span dir="ltr">{formatNum(m.minute, lang)}&apos;</span>
        )}
      </Badge>
    );
  }
  if (phase === 'ended') {
    return <Badge variant="secondary" className="shrink-0 whitespace-nowrap">{t('matches.ended')}</Badge>;
  }
  return null;
}

export function MatchCard({ m }: { m: MatchSummary }) {
  const { t, lang } = useI18n();
  const stageLabel = m.stageType ? t(`stage.${m.stageType}`) : '';
  const needsPrediction = !m.myPrediction && !m.isLocked;

  return (
    <Link href={`/matches/${m.id}`}>
      <Card
        className={`${m.myPrediction ? 'card-predicted' : 'card-premium'} cursor-pointer transition-all hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)] hover:border-secondary/50 group relative`}
        data-testid={`card-match-${m.id}`}
      >
        {needsPrediction && (
          <span className="absolute top-3 end-3 flex h-2.5 w-2.5 z-10">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary" />
          </span>
        )}
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-wider uppercase text-secondary/80 truncate min-w-0">
              {stageLabel}
              {m.venue ? ` · ${m.venue}` : ''}
            </span>
            <StatusBadge m={m} />
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4" dir="ltr">
            <TeamFlag team={m.homeTeam} />
            <ScoreOrTime m={m} lang={lang} />
            <div className="flex justify-end min-w-0">
              <TeamFlag team={m.awayTeam} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pt-3 border-t border-border/40 mt-1">
            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 min-w-0">
              <CalendarDays className="w-3.5 h-3.5 opacity-70" />
              {formatKickoff(m.kickoffAt, lang)}
            </span>
            {m.myPrediction ? (
              <span className="flex items-center gap-2 text-xs font-medium">
                <span className="text-muted-foreground">{t('matches.predicted')}:</span>
                <span className="tabular-nums font-bold text-foreground" dir="ltr">
                  {formatNum(m.myPrediction.homeScore, lang)}-
                  {formatNum(m.myPrediction.awayScore, lang)}
                </span>
                {m.myPrediction.outcome !== 'pending' && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-bold border-0 px-2 py-0.5 ${outcomeStyles[m.myPrediction.outcome] || ''}`}
                  >
                    {m.myPrediction.outcome === 'none'
                      ? t('outcome.none')
                      : `+${formatNum(m.myPrediction.pointsAwarded, lang)}`}
                  </Badge>
                )}
              </span>
            ) : m.isLocked ? (
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Clock className="w-3 h-3" /> {t('matches.locked')}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-bold text-secondary group-hover:text-secondary group-hover:drop-shadow-[0_0_8px_rgba(200,160,50,0.5)] transition-all">
                <Check className="w-3.5 h-3.5" />
                {t('matches.predict')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
