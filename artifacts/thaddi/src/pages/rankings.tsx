import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Link } from 'wouter';
import { Leaderboard } from '../components/leaderboard';
import { ChallengeLeaderboard } from '../components/challenge-stats';
import {
  useGetCompetitionRanking,
  useGetMyChallenges,
  getGetCompetitionRankingQueryKey,
} from '@workspace/api-client-react';
import { useCompetition } from '../lib/competition';
import { CompetitionComingSoon } from '../components/competition-empty';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Trophy, MessageCircle, CalendarDays, Swords } from 'lucide-react';
import { formatNum } from '../lib/matchUtils';

export default function RankingsPage() {
  const { t, lang } = useI18n();
  const [view, setView] = useState<'global' | 'challenge'>('global');
  const [challengeId, setChallengeId] = useState<string>('');

  const { selectedSlug, selectedSeason, isReady, comingSoon } = useCompetition();
  const rankParams = { season: selectedSeason ?? undefined };
  const { data, isLoading, isError, refetch } = useGetCompetitionRanking(
    selectedSlug ?? '',
    rankParams,
    {
      query: {
        queryKey: getGetCompetitionRankingQueryKey(selectedSlug ?? '', rankParams),
        enabled: isReady && !!selectedSlug,
      },
    },
  );
  const { data: mine } = useGetMyChallenges();

  const me = data?.me ?? null;
  const allChallenges = [...(mine?.owned ?? []), ...(mine?.joined ?? [])];

  const shareRank = () => {
    if (!me) return;
    const msg = t('rankings.shareMessage').replace('{rank}', formatNum(me.rank, lang));
    const base = import.meta.env.BASE_URL;
    const url = `${window.location.origin}${base}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`${msg} ${url}`)}`, '_blank');
  };

  const selectedChallenge = allChallenges.find((c) => c.id === challengeId);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-8 pb-12">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('rankings.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('rankings.subtitle')}</p>
          </div>

          {/* Clean Segment Control */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex rounded-lg border border-border/60 bg-muted/40 p-1 gap-1">
              <button
                onClick={() => setView('global')}
                data-testid="button-rankings-global"
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  view === 'global'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Trophy className="inline w-3.5 h-3.5 me-1.5" />
                {t('rankings.context.global')}
              </button>
              <button
                onClick={() => setView('challenge')}
                data-testid="button-rankings-challenge"
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  view === 'challenge'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Swords className="inline w-3.5 h-3.5 me-1.5" />
                {t('rankings.context.byChallenge')}
              </button>
            </div>

            {view === 'challenge' && allChallenges.length > 0 && (
              <Select value={challengeId} onValueChange={setChallengeId}>
                <SelectTrigger className="w-[220px] bg-background border-border/70 text-sm" data-testid="select-challenge-context">
                  <SelectValue placeholder={t('rankings.context.selectChallenge')} />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {allChallenges.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* ── GLOBAL VIEW ── */}
        {view === 'global' && (
          comingSoon ? (
            <CompetitionComingSoon />
          ) : (
            <div className="space-y-6">
              {/* Executive Your Rank Card */}
              {me ? (
                <Card className="border-border/80 shadow-sm bg-card overflow-hidden">
                  <div className="border-l-4 border-primary p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('rankings.yourRank')}</span>
                      <div className="flex items-baseline gap-4">
                        <span className="text-4xl sm:text-5xl font-extrabold text-foreground tabular-nums" dir="ltr">
                          #{formatNum(me.rank, lang)}
                        </span>
                        <span className="text-sm font-medium text-muted-foreground">
                          <strong className="text-foreground font-bold text-base">{formatNum(me.points, lang)}</strong> {t('rankings.points')}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 bg-[#25D366]/10 text-[#25D366] border-[#25D366]/30 hover:bg-[#25D366]/20 font-semibold text-xs"
                      onClick={shareRank}
                      data-testid="button-share-rank"
                    >
                      <MessageCircle className="w-4 h-4 fill-[#25D366]" />
                      {t('rankings.share')}
                    </Button>
                  </div>
                </Card>
              ) : isReady && !isLoading && !isError ? (
                <Card className="border-dashed border-border/80 bg-muted/10 shadow-none">
                  <CardContent className="py-12 flex flex-col items-center text-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                      <CalendarDays className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{t('rankings.noRankYet')}</p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-sm">{t('rankings.noRankYetDesc')}</p>
                    </div>
                    <Link href="/matches">
                      <Button size="sm" className="mt-2" data-testid="button-predict-from-rankings">
                        {t('rankings.noRankYetCta')}
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ) : null}

              {/* Leaderboard Table Card */}
              <Card className="border-border/80 shadow-sm bg-card">
                <CardHeader className="border-b border-border/50 pb-4">
                  <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-muted-foreground" />
                    <span>{t('rankings.standings')}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading || !isReady ? (
                    <div className="space-y-2 p-4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-md" />
                      ))}
                    </div>
                  ) : isError ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <p className="text-sm text-muted-foreground">{t('common.loadError')}</p>
                      <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-rankings">
                        {t('common.tryAgain')}
                      </Button>
                    </div>
                  ) : (
                    <Leaderboard entries={data?.entries ?? []} me={me} emptyText={t('rankings.empty')} />
                  )}
                </CardContent>
              </Card>
            </div>
          )
        )}

        {/* ── CHALLENGE VIEW ── */}
        {view === 'challenge' && (
          <div className="space-y-6">
            {allChallenges.length === 0 ? (
              <Card className="border-dashed border-border/80 bg-muted/10 shadow-none">
                <CardContent className="py-16 flex flex-col items-center text-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <Swords className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground max-w-sm">{t('rankings.context.noChallenges')}</p>
                  <Link href="/challenges">
                    <Button size="sm" className="mt-2">{t('home.nextAction.joinCta')}</Button>
                  </Link>
                </CardContent>
              </Card>
            ) : !challengeId ? (
              <Card className="border-dashed border-border/80 bg-muted/10 shadow-none">
                <CardContent className="py-16 flex flex-col items-center text-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <Swords className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">{t('rankings.context.selectChallenge')}</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {selectedChallenge && (
                  <div className="flex items-center justify-between gap-4 py-2 border-b border-border/40">
                    <p className="text-sm font-medium text-muted-foreground">
                      {t('rankings.context.challengeRank').replace('{name}', selectedChallenge.name)}
                    </p>
                    <Link href={`/challenges/${selectedChallenge.id}`}>
                      <Button variant="outline" size="sm" className="text-xs h-8">
                        {t('detail.openChallenge')} →
                      </Button>
                    </Link>
                  </div>
                )}
                <Card className="border-border/80 shadow-sm bg-card">
                  <CardContent className="p-0">
                    <ChallengeLeaderboard challengeId={challengeId} />
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
