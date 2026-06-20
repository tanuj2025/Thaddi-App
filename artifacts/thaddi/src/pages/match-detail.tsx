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
  ArrowLeft, MapPin, CalendarDays, Lock, EyeOff, Minus, Plus, Loader2, History, Trophy,
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
  const cls = size === 'lg' ? 'w-12 h-8' : 'w-6 h-4';
  return team?.flagUrl ? (
    <img src={team.flagUrl} alt="" className={`${cls} rounded object-cover ring-1 ring-border`} />
  ) : (
    <div className={`${cls} rounded bg-muted`} />
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
      <span className="text-sm font-medium text-muted-foreground truncate max-w-[7rem] text-center">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full"
          disabled={disabled || value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
          data-testid={`button-${testId}-dec`}
        >
          <Minus className="w-4 h-4" />
        </Button>
        <span
          className="w-12 text-center text-3xl font-extrabold tabular-nums"
          data-testid={`text-${testId}-value`}
        >
          {formatNum(value, lang)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full"
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
    <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent/50">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="w-8 h-8">
          <AvatarImage src={p.avatarUrl || ''} />
          <AvatarFallback className="bg-primary/10 text-primary text-xs">
            {p.displayName?.charAt(0) || 'U'}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium truncate">{p.displayName || '—'}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="tabular-nums font-bold" dir="ltr">
          {formatNum(p.homeScore, lang)}-{formatNum(p.awayScore, lang)}
        </span>
        {p.outcome !== 'pending' && (
          <Badge variant="outline" className={`text-[10px] ${outcomeBadgeStyle(p.outcome)}`}>
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
    <Card className="border-border overflow-hidden">
      <div className="bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            {stageLabel && <span>{stageLabel}</span>}
            {isLive && (
              <Badge className="bg-red-500 text-white border-transparent gap-1.5 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                {t(matchPhaseLabelKey[phase])}
                {phaseShowsMinute(phase) && m.minute != null && (
                  <span dir="ltr">{formatNum(m.minute, lang)}&apos;</span>
                )}
              </Badge>
            )}
            {phase === 'ended' && (
              <Badge variant="secondary">{t(matchPhaseLabelKey[phase])}</Badge>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4" dir="ltr">
            <div className="flex flex-col items-center gap-2 text-center">
              <Flag team={m.homeTeam} />
              <span className="font-bold text-sm sm:text-base">{teamName(m.homeTeam, lang)}</span>
            </div>

            <div className="flex flex-col items-center">
              {showScore ? (
                <div className="flex items-center gap-3 text-4xl font-extrabold tabular-nums">
                  <span>{formatNum(m.homeScore ?? 0, lang)}</span>
                  <span className="text-muted-foreground text-2xl">-</span>
                  <span>{formatNum(m.awayScore ?? 0, lang)}</span>
                </div>
              ) : (
                <span className="text-xl font-bold text-muted-foreground">{t('matches.vs')}</span>
              )}
            </div>

            <div className="flex flex-col items-center gap-2 text-center">
              <Flag team={m.awayTeam} />
              <span className="font-bold text-sm sm:text-base">{teamName(m.awayTeam, lang)}</span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground pt-2">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" />
              {formatKickoff(m.kickoffAt, lang)}
            </span>
            {m.venue && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {m.venue}
              </span>
            )}
          </div>
        </CardContent>
      </div>
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
        return s === 'live' || s === 'half_time' ? 15000 : false;
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
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Layout>
    );
  }

  if (!m) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto text-center py-20 space-y-4">
          <p className="text-muted-foreground">{t('detail.notFound')}</p>
          <Button variant="outline" onClick={() => setLocation('/matches')}>
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
      <div className="max-w-2xl mx-auto space-y-6">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => setLocation('/matches')}
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          {t('matches.title')}
        </Button>

        <MatchHeader m={m} />

        {/* Challenge context banner */}
        {isSignedIn && (() => {
          const count = (mine?.owned?.length ?? 0) + (mine?.joined?.length ?? 0);
          if (count === 0) return null;
          const allC = [...(mine?.owned ?? []), ...(mine?.joined ?? [])];
          const label = count === 1
            ? t('match.countsInOneChallenge').replace('{name}', allC[0]?.name ?? '')
            : t('match.countsInChallenges').replace('{count}', String(count));
          return (
            <div className="flex items-center gap-3 rounded-xl border border-secondary/25 bg-secondary/5 px-4 py-2.5" data-testid="banner-match-challenges">
              <Trophy className="w-4 h-4 text-secondary shrink-0" />
              <span className="text-sm text-secondary/90">{label}</span>
            </div>
          );
        })()}

        {/* Prediction entry */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg">{t('match.yourPrediction')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!locked && cd && !cd.done && m.predictionLockAt && (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-4 py-2.5 text-sm">
                <Lock className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">{t('match.lockCountdown')}</span>
                <span className="font-bold text-primary tabular-nums" dir="ltr">
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
              <div className="flex items-center justify-center gap-2 rounded-lg bg-muted border border-border px-4 py-2.5 text-sm text-muted-foreground">
                <Lock className="w-4 h-4" />
                {t('match.lockedMsg')}
              </div>
            )}

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3" dir="ltr">
              <ScoreStepper
                label={teamName(m.homeTeam, lang)}
                value={home}
                onChange={setHome}
                disabled={locked || submit.isPending}
                testId="home"
              />
              <span className="text-2xl font-bold text-muted-foreground">-</span>
              <ScoreStepper
                label={teamName(m.awayTeam, lang)}
                value={away}
                onChange={setAway}
                disabled={locked || submit.isPending}
                testId="away"
              />
            </div>

            {m.myPrediction && m.myPrediction.outcome !== 'pending' && (
              <div className="flex items-center justify-center">
                <Badge
                  variant="outline"
                  className={outcomeBadgeStyle(m.myPrediction.outcome)}
                >
                  {t(outcomeLabelKey(m.myPrediction.outcome))}
                  {m.myPrediction.pointsAwarded > 0 &&
                    ` · +${formatNum(m.myPrediction.pointsAwarded, lang)} ${t('matches.points')}`}
                </Badge>
              </div>
            )}

            {!locked && (
              <Button
                className={`w-full transition-all ${predictionJustSaved ? 'bg-emerald-600 hover:bg-emerald-600 text-white' : ''}`}
                onClick={savePrediction}
                disabled={submit.isPending || predictionJustSaved}
                data-testid="button-save-prediction"
              >
                {submit.isPending ? (
                  <Loader2 className="w-4 h-4 me-2 animate-spin" />
                ) : predictionJustSaved ? (
                  <span className="me-2">✓</span>
                ) : null}
                {predictionJustSaved ? t('match.savedInline') : t('match.savePrediction')}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* After-match result summary */}
        {(m.status === 'finished' || m.status === 'full_time') &&
          m.myPrediction &&
          m.myPrediction.outcome !== 'pending' && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-lg">{t('match.result')}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">{t('match.result')}</p>
                  <p className="text-2xl font-extrabold tabular-nums" dir="ltr">
                    {formatNum(m.homeScore ?? 0, lang)}-{formatNum(m.awayScore ?? 0, lang)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-sm ${outcomeBadgeStyle(m.myPrediction.outcome)}`}
                >
                  {t(outcomeLabelKey(m.myPrediction.outcome))}
                </Badge>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">{t('match.yourPoints')}</p>
                  <p className="text-2xl font-extrabold tabular-nums text-primary">
                    {m.myPrediction.pointsAwarded > 0
                      ? `+${formatNum(m.myPrediction.pointsAwarded, lang)}`
                      : formatNum(0, lang)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

        {/* Prediction trends (percentages only — safe pre-lock) */}
        <TrendsCard m={m} />

        {/* Prediction comparison (gated; revealed post-kickoff) */}
        <ComparisonCard m={m} />

        {/* Participant predictions */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg">{t('match.allPredictions')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!m.revealed ? (
              <div className="flex flex-col items-center text-center gap-3 py-8">
                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                  <EyeOff className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground max-w-xs">
                  {t('match.predictionsHidden')}
                </p>
              </div>
            ) : m.participantPredictions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                {t('match.noPredictions')}
              </p>
            ) : (
              <div className="space-y-1">
                {m.participantPredictions.map((p) => (
                  <PredictionRow key={p.userId} p={p} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit history */}
        {history && history.length > 1 && (
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="w-5 h-5" />
                {t('match.history')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {history.map((h) => (
                  <li
                    key={h.id}
                    className="flex items-center justify-between text-sm rounded-lg px-3 py-2 bg-muted/40"
                  >
                    <span className="tabular-nums font-medium" dir="ltr">
                      {formatNum(h.homeScore, lang)}-{formatNum(h.awayScore, lang)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatKickoff(h.recordedAt, lang)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
