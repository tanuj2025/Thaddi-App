import React from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Link } from 'wouter';
import { useGetMatches, GetMatchesScope } from '@workspace/api-client-react';
import type { MatchSummary, TeamRef } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CalendarDays, Clock, Check } from 'lucide-react';
import {
  useCountdown,
  formatCountdown,
  formatKickoff,
  formatNum,
  outcomeStyles,
  type Lang,
} from '../lib/matchUtils';

function TeamFlag({ team }: { team?: TeamRef | null }) {
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

function ScoreOrTime({ m, lang }: { m: MatchSummary; lang: Lang }) {
  const { t } = useI18n();
  const cd = useCountdown(m.predictionLockAt);

  if (m.hasKickedOff || m.status === 'finished' || m.status === 'full_time') {
    return (
      <div className="flex flex-col items-center px-3">
        <div className="flex items-center gap-2 text-2xl font-extrabold tabular-nums">
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

function StatusBadge({ m }: { m: MatchSummary }) {
  const { t } = useI18n();
  const isLive = m.status === 'live' || m.status === 'half_time';
  const isFinished = m.status === 'finished' || m.status === 'full_time';

  if (isLive) {
    return (
      <Badge className="bg-red-500 text-white border-transparent gap-1.5 animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
        {t('matches.live')}
        {m.minute != null && <span dir="ltr">{m.minute}'</span>}
      </Badge>
    );
  }
  if (isFinished) {
    return <Badge variant="secondary">{t('matches.tab.finished')}</Badge>;
  }
  return null;
}

function MatchCard({ m }: { m: MatchSummary }) {
  const { t, lang } = useI18n();
  const stageLabel = m.stageType ? t(`stage.${m.stageType}`) : '';

  return (
    <Link href={`/matches/${m.id}`}>
      <Card
        className="cursor-pointer transition-all border-border hover:border-primary/50 hover:shadow-md"
        data-testid={`card-match-${m.id}`}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground truncate">
              {stageLabel}
              {m.venue ? ` · ${m.venue}` : ''}
            </span>
            <StatusBadge m={m} />
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <TeamFlag team={m.homeTeam} />
            <ScoreOrTime m={m} lang={lang} />
            <div className="flex justify-end">
              <div className="flex flex-row-reverse items-center gap-2 min-w-0">
                <TeamFlag team={m.awayTeam} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
            <span className="text-xs text-muted-foreground">
              {formatKickoff(m.kickoffAt, lang)}
            </span>
            {m.myPrediction ? (
              <span className="flex items-center gap-2 text-xs font-medium">
                <span className="text-muted-foreground">{t('matches.predicted')}:</span>
                <span className="tabular-nums font-bold" dir="ltr">
                  {formatNum(m.myPrediction.homeScore, lang)}-
                  {formatNum(m.myPrediction.awayScore, lang)}
                </span>
                {m.myPrediction.outcome !== 'pending' && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${outcomeStyles[m.myPrediction.outcome] || ''}`}
                  >
                    {m.myPrediction.outcome === 'none'
                      ? t('outcome.none')
                      : `+${formatNum(m.myPrediction.pointsAwarded, lang)}`}
                  </Badge>
                )}
              </span>
            ) : m.isLocked ? (
              <span className="text-xs text-muted-foreground">{t('matches.locked')}</span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                <Check className="w-3 h-3" />
                {t('matches.predict')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="border-border">
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MatchList({ scope }: { scope: GetMatchesScope }) {
  const { t } = useI18n();
  const { data, isLoading } = useGetMatches({ scope });

  if (isLoading) return <ListSkeleton />;

  const matches = data || [];
  if (matches.length === 0) {
    return (
      <Card className="border-border">
        <CardContent className="py-16 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <CalendarDays className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">{t('matches.empty')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {matches.map((m) => (
        <MatchCard key={m.id} m={m} />
      ))}
    </div>
  );
}

export default function MatchCenterPage() {
  const { t } = useI18n();

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('matches.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('matches.subtitle')}</p>
        </div>

        <Tabs defaultValue={GetMatchesScope.all}>
          <TabsList>
            <TabsTrigger value={GetMatchesScope.all} data-testid="tab-all">
              {t('matches.tab.all')}
            </TabsTrigger>
            <TabsTrigger value={GetMatchesScope.live} data-testid="tab-live">
              {t('matches.tab.live')}
            </TabsTrigger>
            <TabsTrigger value={GetMatchesScope.upcoming} data-testid="tab-upcoming">
              {t('matches.tab.upcoming')}
            </TabsTrigger>
            <TabsTrigger value={GetMatchesScope.finished} data-testid="tab-finished">
              {t('matches.tab.finished')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={GetMatchesScope.all} className="mt-6">
            <MatchList scope={GetMatchesScope.all} />
          </TabsContent>
          <TabsContent value={GetMatchesScope.live} className="mt-6">
            <MatchList scope={GetMatchesScope.live} />
          </TabsContent>
          <TabsContent value={GetMatchesScope.upcoming} className="mt-6">
            <MatchList scope={GetMatchesScope.upcoming} />
          </TabsContent>
          <TabsContent value={GetMatchesScope.finished} className="mt-6">
            <MatchList scope={GetMatchesScope.finished} />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
