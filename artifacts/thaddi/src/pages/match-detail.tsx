import React, { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { useLocation, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMatch,
  useGetPredictionHistory,
  useSubmitPrediction,
  useGetMyChallenges,
  getGetMatchQueryKey,
  getGetMatchesQueryKey,
  getGetPredictionHistoryQueryKey,
  getGetMyChallengesQueryKey,
} from '@workspace/api-client-react';
import type { MatchDetail, TeamRef, ParticipantPrediction } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, MapPin, CalendarDays, Lock, EyeOff, Minus, Plus, Loader2, History, Trophy, Check,
} from 'lucide-react';
import {
  useCountdown,
  formatCountdown,
  formatKickoff,
  formatNum,
  outcomeBadgeStyle,
  outcomeLabelKey,
  matchPhase,
  matchPhaseLabelKey,
  isLivePhase,
  phaseShowsMinute,
  type Lang,
} from '../lib/matchUtils';
import { TrendsCard, ComparisonCard } from '../components/match-stats';

function teamName(team: TeamRef | null | undefined, lang: Lang): string {
  if (!team) return '—';
  return lang === 'ar' ? team.nameAr : team.nameEn;
}

function Flag({ team, size = 'lg' }: { team?: TeamRef | null; size?: 'lg' | 'sm' }) {
  const cls = size === 'lg' ? 'w-16 h-11' : 'w-7 h-5';
  return team?.flagUrl ? (
    <img src={team.flagUrl} alt="" className={`${cls} rounded-md object-cover border border-border/80 shadow-sm`} />
  ) : (
    <div className={`${cls} rounded-md bg-muted/60 border border-border/50 flex items-center justify-center font-bold text-xs text-muted-foreground`} />
  );
}

function ScoreStepper({
  label,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  testId: string;
}) {
  const { lang } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate max-w-[8rem] text-center">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-lg text-foreground border-border/80 hover:bg-muted/50 transition-colors"
          disabled={disabled || value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
          data-testid={`button-${testId}-dec`}
        >
          <Minus className="w-4 h-4" />
        </Button>
        <div
          className="w-14 h-10 flex items-center justify-center text-2xl font-bold tabular-nums bg-muted/40 rounded-lg border border-border/70 text-foreground"
          data-testid={`text-${testId}-value`}
        >
          {formatNum(value, lang)}
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-lg text-foreground border-border/80 hover:bg-muted/50 transition-colors"
          disabled={disabled || value >= 99}
          onClick={() => onChange(Math.min(99, value + 1))}
          data-testid={`button-${testId}-inc`}
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function PredictionRow({ p }: { p: ParticipantPrediction }) {
  const { t, lang } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="w-8 h-8 border border-border/60">
          <AvatarImage src={p.avatarUrl || ''} className="object-cover" />
          <AvatarFallback className="bg-muted text-foreground text-xs font-semibold">
            {p.displayName?.charAt(0) || 'U'}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium text-sm text-foreground truncate">{p.displayName || '—'}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono font-bold tabular-nums text-base text-foreground" dir="ltr">
          {formatNum(p.homeScore, lang)} - {formatNum(p.awayScore, lang)}
        </span>
        {p.outcome !== 'pending' && (
          <Badge variant="outline" className={`text-xs font-semibold px-2 py-0.5 rounded-md ${outcomeBadgeStyle(p.outcome)}`}>
            {p.pointsAwarded > 0
              ? `+${formatNum(p.pointsAwarded, lang)}`
              : t('outcome.none')}
          </Badge>
        )}
      </div>
    </div>
  );
}

function MatchHeader({ m }: { m: MatchDetail }) {
  const { t, lang } = useI18n();
  const phase = matchPhase(m.status, m.minute);
  const isLive = isLivePhase(phase);
  const showScore = m.hasKickedOff || m.status === 'finished' || m.status === 'full_time';
  const stageLabel = m.stageType ? t(`stage.${m.stageType}`) : '';

  return (
    <Card className="border-border/80 shadow-sm bg-card overflow-hidden">
      <CardContent className="p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {stageLabel && (
            <span className="px-2.5 py-0.5 rounded-md bg-muted text-foreground">
              {stageLabel}
            </span>
          )}
          {isLive && (
            <Badge className="bg-red-500 text-white font-bold border-transparent gap-1.5 px-2.5 py-0.5 rounded-md animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-white" />
              {t(matchPhaseLabelKey[phase])}
              {phaseShowsMinute(phase) && m.minute != null && (
                <span dir="ltr" className="ms-1 font-mono">{formatNum(m.minute, lang)}&apos;</span>
              )}
            </Badge>
          )}
          {phase === 'ended' && (
            <Badge variant="outline" className="bg-muted border-border/70 text-muted-foreground font-medium">
              {t(matchPhaseLabelKey[phase])}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-8 max-w-2xl mx-auto" dir="ltr">
          <div className="flex flex-col items-center gap-2.5 text-center">
            <Flag team={m.homeTeam} />
            <span className="font-bold text-base sm:text-lg text-foreground tracking-tight">
              {teamName(m.homeTeam, lang)}
            </span>
          </div>

          <div className="flex flex-col items-center justify-center px-2">
            {showScore ? (
              <div className="flex items-center gap-3 text-4xl sm:text-5xl font-extrabold tabular-nums tracking-tight">
                <span>{formatNum(m.homeScore ?? 0, lang)}</span>
                <span className="text-muted-foreground font-light text-2xl sm:text-3xl">-</span>
                <span>{formatNum(m.awayScore ?? 0, lang)}</span>
              </div>
            ) : (
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <span className="text-sm font-bold text-muted-foreground uppercase">{t('matches.vs')}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-2.5 text-center">
            <Flag team={m.awayTeam} />
            <span className="font-bold text-base sm:text-lg text-foreground tracking-tight">
              {teamName(m.awayTeam, lang)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-medium text-muted-foreground pt-4 border-t border-border/40">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
            {formatKickoff(m.kickoffAt, lang)}
          </span>
          {m.venue && (
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
              {m.venue}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MatchDetailPage() {
  const { t, lang } = useI18n();
  const [, setLocation] = useLocation();
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isSignedIn } = useUser();

  const { data: m, isLoading } = useGetMatch(id, {
    query: {
      queryKey: getGetMatchQueryKey(id),
      refetchInterval: (q) => {
        const s = (q.state.data as MatchDetail | undefined)?.status;
        return s === 'live' || s === 'half_time' ? 3000 : false;
      },
    },
  });
  const { data: history } = useGetPredictionHistory(id, {
    query: { enabled: isSignedIn === true, queryKey: getGetPredictionHistoryQueryKey(id) },
  });
  const submit = useSubmitPrediction();
  const { data: mine } = useGetMyChallenges({
    query: { enabled: isSignedIn === true, queryKey: getGetMyChallengesQueryKey() },
  });

  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const cd = useCountdown(m?.predictionLockAt);

  useEffect(() => {
    if (m?.myPrediction) {
      setHome(m.myPrediction.homeScore);
      setAway(m.myPrediction.awayScore);
    }
  }, [m?.myPrediction]);

  const [predictionJustSaved, setPredictionJustSaved] = React.useState(false);

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto space-y-6">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-56 w-full rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <Skeleton className="md:col-span-7 h-64 rounded-xl" />
            <Skeleton className="md:col-span-5 h-64 rounded-xl" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!m) {
    return (
      <Layout>
        <div className="max-w-6xl mx-auto text-center py-24 space-y-4">
          <p className="text-base font-medium text-foreground">{t('detail.notFound')}</p>
          <Button variant="outline" size="sm" onClick={() => setLocation('/matches')}>
            <ArrowLeft className="w-4 h-4 me-2" />
            {t('common.back')}
          </Button>
        </div>
      </Layout>
    );
  }

  const locked = m.isLocked;

  const savePrediction = () => {
    submit.mutate(
      { id, data: { homeScore: home, awayScore: away } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMatchQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetPredictionHistoryQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetMatchesQueryKey() });
          toast({ title: t('match.predictionSaved') });
          setPredictionJustSaved(true);
          setTimeout(() => setPredictionJustSaved(false), 2000);
        },
        onError: (err) =>
          toast({
            title: err.data?.error || t('match.predictionError'),
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <Layout>
      {/* Expanded wide container to fill width like other pages */}
      <div className="max-w-6xl mx-auto space-y-6 pb-12">
        
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs font-medium"
            onClick={() => setLocation('/matches')}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            {t('matches.title')}
          </Button>

          {isSignedIn && (() => {
            const count = (mine?.owned?.length ?? 0) + (mine?.joined?.length ?? 0);
            if (count === 0) return null;
            const allC = [...(mine?.owned ?? []), ...(mine?.joined ?? [])];
            const label = count === 1
              ? t('match.countsInOneChallenge').replace('{name}', allC[0]?.name ?? '')
              : t('match.countsInChallenges').replace('{count}', String(count));
            return (
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md border border-border/50" data-testid="banner-match-challenges">
                <Trophy className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>{label}</span>
              </div>
            );
          })()}
        </div>

        {/* Full width match header */}
        <MatchHeader m={m} />

        {/* Mature 2-column grid layout for interactive components */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Main Left Column (7 cols): Predictions & Results */}
          <div className="lg:col-span-7 space-y-6">
            <Card className="border-border/80 shadow-sm bg-card">
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle className="text-base font-bold">{t('match.yourPrediction')}</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {!locked && cd && !cd.done && m.predictionLockAt && (
                  <div className="flex items-center justify-between rounded-lg bg-muted/40 border border-border/60 px-4 py-2.5 text-xs sm:text-sm">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <Lock className="w-4 h-4 text-primary shrink-0" />
                      {t('match.lockCountdown')}
                    </span>
                    <span className="font-mono font-bold text-foreground" dir="ltr">
                      {formatCountdown(cd, lang, {
                        days: t('match.days'),
                        hours: t('match.hours'),
                        minutes: t('match.minutes'),
                        seconds: t('match.seconds'),
                      })}
                    </span>
                  </div>
                )}

                {locked && (
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/60 border border-border/60 px-4 py-2.5 text-sm font-medium text-muted-foreground">
                    <Lock className="w-4 h-4" />
                    {t('match.lockedMsg')}
                  </div>
                )}

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-2" dir="ltr">
                  <ScoreStepper
                    label={teamName(m.homeTeam, lang)}
                    value={home}
                    onChange={setHome}
                    disabled={locked || submit.isPending}
                    testId="home"
                  />
                  <div className="flex flex-col items-center justify-center mt-5">
                    <span className="text-xl font-bold text-muted-foreground/50">-</span>
                  </div>
                  <ScoreStepper
                    label={teamName(m.awayTeam, lang)}
                    value={away}
                    onChange={setAway}
                    disabled={locked || submit.isPending}
                    testId="away"
                  />
                </div>

                {m.myPrediction && m.myPrediction.outcome !== 'pending' && (
                  <div className="flex items-center justify-center pt-2">
                    <Badge variant="outline" className={`px-3 py-1 font-semibold text-xs rounded-md ${outcomeBadgeStyle(m.myPrediction.outcome)}`}>
                      {t(outcomeLabelKey(m.myPrediction.outcome))}
                      {m.myPrediction.pointsAwarded > 0 &&
                        ` · +${formatNum(m.myPrediction.pointsAwarded, lang)} ${t('matches.points')}`}
                    </Badge>
                  </div>
                )}

                {!locked && (
                  <Button
                    className={`w-full h-11 text-sm font-semibold rounded-lg transition-all ${
                      predictionJustSaved ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : ''
                    }`}
                    onClick={savePrediction}
                    disabled={submit.isPending || predictionJustSaved}
                    data-testid="button-save-prediction"
                  >
                    {submit.isPending ? (
                      <Loader2 className="w-4 h-4 me-2 animate-spin" />
                    ) : predictionJustSaved ? (
                      <Check className="w-4 h-4 me-2" />
                    ) : null}
                    {predictionJustSaved ? t('match.savedInline') : t('match.savePrediction')}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Post-match result card */}
            {(m.status === 'finished' || m.status === 'full_time') &&
              m.myPrediction &&
              m.myPrediction.outcome !== 'pending' && (
                <Card className="border-border/80 shadow-sm bg-card">
                  <CardHeader className="border-b border-border/50 pb-3">
                    <CardTitle className="text-base font-bold">{t('match.result')}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 flex items-center justify-around gap-4">
                    <div className="text-center space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('match.result')}</p>
                      <p className="text-2xl font-bold tabular-nums text-foreground" dir="ltr">
                        {formatNum(m.homeScore ?? 0, lang)} - {formatNum(m.awayScore ?? 0, lang)}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-xs font-semibold px-3 py-1 ${outcomeBadgeStyle(m.myPrediction.outcome)}`}>
                      {t(outcomeLabelKey(m.myPrediction.outcome))}
                    </Badge>
                    <div className="text-center space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('match.yourPoints')}</p>
                      <p className="text-2xl font-bold tabular-nums text-primary">
                        {m.myPrediction.pointsAwarded > 0
                          ? `+${formatNum(m.myPrediction.pointsAwarded, lang)}`
                          : formatNum(0, lang)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

            {/* All participant predictions */}
            <Card className="border-border/80 shadow-sm bg-card">
              <CardHeader className="border-b border-border/50 pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-bold">{t('match.allPredictions')}</CardTitle>
                  {m.revealed && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {formatNum(m.participantPredictions.length, lang)}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!m.revealed ? (
                  <div className="flex flex-col items-center text-center gap-2 py-12">
                    <EyeOff className="w-6 h-6 text-muted-foreground/60 mb-1" />
                    <p className="text-sm font-medium text-muted-foreground max-w-xs">
                      {t('match.predictionsHidden')}
                    </p>
                  </div>
                ) : m.participantPredictions.length === 0 ? (
                  <p className="text-sm font-medium text-muted-foreground text-center py-10">
                    {t('match.noPredictions')}
                  </p>
                ) : (
                  <div className="divide-y divide-border/40">
                    {m.participantPredictions.map((p) => (
                      <PredictionRow key={p.userId} p={p} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar Column (5 cols): Trends, Comparison & Edit History */}
          <div className="lg:col-span-5 space-y-6">
            <TrendsCard m={m} />
            <ComparisonCard m={m} />

            {/* Edit history */}
            {history && history.length > 1 && (
              <Card className="border-border/80 shadow-sm bg-card">
                <CardHeader className="border-b border-border/50 pb-3">
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <History className="w-4 h-4" />
                    <span>{t('match.history')}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <ul className="space-y-2">
                    {history.map((h) => (
                      <li
                        key={h.id}
                        className="flex items-center justify-between text-sm rounded-lg px-3.5 py-2.5 bg-muted/30 border border-border/40"
                      >
                        <span className="tabular-nums font-bold text-foreground" dir="ltr">
                          {formatNum(h.homeScore, lang)} - {formatNum(h.awayScore, lang)}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {formatKickoff(h.recordedAt, lang)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

        </div>
      </div>
    </Layout>
  );
}
