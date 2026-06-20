import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { useGetMatches, GetMatchesScope, getGetMatchesQueryKey } from '@workspace/api-client-react';
import type { MatchSummary } from '@workspace/api-client-react';
import { useCompetition } from '../lib/competition';
import { CompetitionComingSoon } from '../components/competition-empty';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CalendarDays, Check } from 'lucide-react';
import { formatNum } from '../lib/matchUtils';
import { MatchCard } from '@/components/match-card';


function PredictionSummary({ matches }: { matches: MatchSummary[] }) {
  const { t, lang } = useI18n();

  const predicted = matches.filter((m) => m.myPrediction).length;
  const open = matches.filter((m) => !m.myPrediction && !m.isLocked).length;
  const total = predicted + open;

  if (total === 0) return null;

  const pct = Math.round((predicted / total) * 100);
  const predictedText = `${formatNum(predicted, lang)} ${t('matches.summary.of')} ${formatNum(total, lang)} ${t('matches.summary.predicted')}`;
  const leftText = `${formatNum(open, lang)} ${t('matches.summary.left')}`;

  return (
    <div
      className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 space-y-2.5"
      data-testid="prediction-summary"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground min-w-0">
          <Check className="w-4 h-4 text-secondary shrink-0" />
          <span className="truncate" data-testid="text-predicted-count">{predictedText}</span>
        </span>
        {open > 0 ? (
          <Badge
            className="bg-secondary/15 text-secondary border-secondary/30 font-bold shrink-0"
            data-testid="badge-left-count"
          >
            {leftText}
          </Badge>
        ) : (
          <Badge
            className="bg-primary/15 text-primary border-primary/30 font-bold shrink-0"
            data-testid="badge-all-done"
          >
            {t('matches.summary.allDone')}
          </Badge>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-secondary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
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

function MatchList({ scope, onGoUpcoming }: { scope: GetMatchesScope; onGoUpcoming?: () => void }) {
  const { t } = useI18n();
  const { selectedSlug, selectedSeason, isReady } = useCompetition();
  const params = {
    scope,
    competitionSlug: selectedSlug ?? undefined,
    season: selectedSeason ?? undefined,
  };
  const { data, isLoading, isError, refetch } = useGetMatches(params, {
    query: {
      queryKey: getGetMatchesQueryKey(params),
      enabled: isReady && !!selectedSlug,
    },
  });

  if (isLoading || !isReady) return <ListSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <p className="text-sm text-muted-foreground">{t('common.loadError')}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="border-border/50 text-muted-foreground hover:text-foreground">
          {t('common.tryAgain')}
        </Button>
      </div>
    );
  }

  const matches = data || [];
  if (matches.length === 0) {
    const isLive = scope === GetMatchesScope.live;
    return (
      <Card className="border-border">
        <CardContent className="py-16 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <CalendarDays className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">{isLive ? t('matches.emptyLive') : t('matches.empty')}</p>
          {isLive && onGoUpcoming ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onGoUpcoming}
              className="border-secondary/30 text-secondary hover:bg-secondary/10"
              data-testid="button-empty-live-upcoming"
            >
              {t('matches.tab.upcoming')}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <PredictionSummary matches={matches} />
      <div className="grid gap-3 sm:grid-cols-2">
        {matches.map((m) => (
          <MatchCard key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

export default function MatchCenterPage() {
  const { t, lang } = useI18n();
  const { comingSoon, isReady } = useCompetition();
  const [tab, setTab] = useState<GetMatchesScope>(GetMatchesScope.live);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-gold-gradient">{t('matches.title')}</h1>
          <p className="text-muted-foreground font-medium">{t('matches.subtitle')}</p>
        </div>

        {!isReady ? (
          <ListSkeleton />
        ) : comingSoon ? (
          <CompetitionComingSoon />
        ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as GetMatchesScope)} className="w-full" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <TabsList className="bg-muted/40 border border-border/50 p-1 w-full justify-start overflow-x-auto rounded-xl">
            <TabsTrigger value={GetMatchesScope.live} data-testid="tab-live">
              {t('matches.tab.live')}
            </TabsTrigger>
            <TabsTrigger value={GetMatchesScope.upcoming} data-testid="tab-upcoming">
              {t('matches.tab.upcoming')}
            </TabsTrigger>
            <TabsTrigger value={GetMatchesScope.finished} data-testid="tab-finished">
              {t('matches.tab.finished')}
            </TabsTrigger>
            <TabsTrigger value={GetMatchesScope.all} data-testid="tab-all">
              {t('matches.tab.all')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={GetMatchesScope.live} className="mt-6">
            <MatchList scope={GetMatchesScope.live} onGoUpcoming={() => setTab(GetMatchesScope.upcoming)} />
          </TabsContent>
          <TabsContent value={GetMatchesScope.upcoming} className="mt-6">
            <MatchList scope={GetMatchesScope.upcoming} />
          </TabsContent>
          <TabsContent value={GetMatchesScope.finished} className="mt-6">
            <MatchList scope={GetMatchesScope.finished} />
          </TabsContent>
          <TabsContent value={GetMatchesScope.all} className="mt-6">
            <MatchList scope={GetMatchesScope.all} />
          </TabsContent>
        </Tabs>
        )}
      </div>
    </Layout>
  );
}
