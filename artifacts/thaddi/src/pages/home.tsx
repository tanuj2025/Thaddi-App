import React from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetMe,
  useTrackAnalyticsEvent,
  useDiscoverChallenges,
  useGetGlobalRanking,
  getGetGlobalRankingQueryKey,
  useGetMatches,
  GetMatchesScope,
} from '@workspace/api-client-react';
import { Zap } from 'lucide-react';
import type {
  ChallengeSummary,
  RankingEntry,
  MatchSummary,
  TeamRef,
} from '@workspace/api-client-react';
import { SiWhatsapp } from 'react-icons/si';
import {
  Users,
  Trophy,
  CalendarDays,
  Crown,
} from 'lucide-react';
import {
  useCountdown,
  formatCountdown,
  formatKickoff,
  formatNum,
} from '../lib/matchUtils';

function NextActionBanner() {
  const { t } = useI18n();
  const { data, isLoading } = useGetMatches({ scope: GetMatchesScope.upcoming });

  if (isLoading) return null;

  const upcoming = data || [];
  const pending = upcoming.filter((m) => !m.myPrediction && !m.isLocked);
  const pendingCount = pending.length;

  if (pendingCount === 0) return null;

  const label = t('home.nextAction.pendingPredictions').replace('{count}', String(pendingCount));

  return (
    <Link href="/matches">
      <div
        className="flex items-center justify-between gap-4 rounded-xl border border-secondary/40 bg-secondary/8 px-4 py-3 cursor-pointer hover:bg-secondary/12 transition-colors group"
        data-testid="banner-next-action"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-secondary/15 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-secondary" />
          </div>
          <span className="text-sm font-semibold text-foreground truncate">{label}</span>
        </div>
        <span className="text-xs font-bold text-secondary shrink-0 group-hover:underline underline-offset-2">
          {t('home.nextAction.predictCta')} →
        </span>
      </div>
    </Link>
  );
}

function CardShell({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Card className="card-premium border-border/50 hover:border-secondary/50 transition-colors">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-lg font-bold">{title}</CardTitle>
        <Link href={href}>
          <Button
            variant="ghost"
            size="sm"
            className="text-secondary hover:text-secondary hover:bg-secondary/10 -me-2"
            data-testid={`link-view-all-${href.replace('/', '')}`}
          >
            {t('home.viewAll')}
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="min-h-32">{children}</CardContent>
    </Card>
  );
}

function RowSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-muted/50" />
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-28 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ChallengesCard() {
  const { t, lang } = useI18n();
  const { data, isLoading } = useDiscoverChallenges();
  // Only surface challenges whose detail page the viewer can actually open:
  // public ones are always accessible, and private ones are only linkable when
  // the viewer owns/joined them (the API exposes an inviteCode in that case).
  // Private non-member challenges would 403 on /challenges/:id, so we drop them.
  const items: ChallengeSummary[] = (data || [])
    .filter((c) => c.visibility === 'public' || Boolean(c.inviteCode))
    .slice(0, 3);

  return (
    <CardShell title={t('nav.challenges')} href="/challenges">
      {isLoading ? (
        <RowSkeleton />
      ) : items.length === 0 ? (
        <EmptyState text={t('challenges.emptyDiscover')} />
      ) : (
        <ul className="space-y-2" data-testid="list-home-challenges">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/challenges/${c.id}`}>
                <div
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer group"
                  data-testid={`row-home-challenge-${c.id}`}
                >
                  <div className="w-9 h-9 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
                    <Trophy className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate group-hover:text-secondary transition-colors">
                      {c.name}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      <span dir="ltr">{formatNum(c.participantCount, lang)}</span>
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function RankingCard() {
  const { t, lang } = useI18n();
  const { data, isLoading } = useGetGlobalRanking(
    { limit: 5 },
    { query: { queryKey: getGetGlobalRankingQueryKey({ limit: 5 }) } },
  );
  const me = data?.me ?? null;
  const entries: RankingEntry[] = data?.entries ?? [];

  return (
    <CardShell title={t('nav.rankings')} href="/rankings">
      {isLoading ? (
        <RowSkeleton />
      ) : entries.length === 0 && !me ? (
        <EmptyState text={t('rankings.empty')} />
      ) : (
        <div className="space-y-3" data-testid="home-ranking">
          {me && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary/10 ring-1 ring-secondary/20 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-secondary font-semibold">
                  {t('rankings.yourRank')}
                </p>
                <p className="text-2xl font-black tabular-nums text-foreground" dir="ltr">
                  #{formatNum(me.rank, lang)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground shrink-0">
                <span className="text-secondary font-bold">{formatNum(me.points, lang)}</span>{' '}
                {t('rankings.points')}
              </p>
            </div>
          )}
          {entries.length > 0 && (
            <ul className="space-y-1" data-testid="list-home-ranking">
              {entries.slice(0, 3).map((e) => (
                <li
                  key={e.userId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors"
                  data-testid={`row-home-ranking-${e.userId}`}
                >
                  <div className="w-6 text-center font-black tabular-nums text-sm text-muted-foreground">
                    {e.rank <= 3 ? (
                      <Crown className="w-4 h-4 mx-auto text-secondary" />
                    ) : (
                      formatNum(e.rank, lang)
                    )}
                  </div>
                  <span className="min-w-0 flex-1 truncate font-semibold text-sm">
                    {e.displayName || '—'}
                  </span>
                  <span className="shrink-0 font-black tabular-nums text-primary" dir="ltr">
                    {formatNum(e.points, lang)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </CardShell>
  );
}

function teamName(team: TeamRef | null | undefined, lang: 'ar' | 'en'): string {
  if (!team) return '—';
  return lang === 'ar' ? team.nameAr : team.nameEn;
}

function NextMatchRow({ m }: { m: MatchSummary }) {
  const { t, lang } = useI18n();
  const cd = useCountdown(m.kickoffAt);

  return (
    <Link href={`/matches/${m.id}`}>
      <div
        className="rounded-lg px-3 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer space-y-2"
        data-testid={`row-home-match-${m.id}`}
      >
        <div className="flex items-center justify-center gap-3 text-sm font-semibold">
          <span className="min-w-0 flex-1 text-end truncate">{teamName(m.homeTeam, lang)}</span>
          <span className="text-xs text-muted-foreground shrink-0">{t('matches.vs')}</span>
          <span className="min-w-0 flex-1 text-start truncate">{teamName(m.awayTeam, lang)}</span>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs">
          {cd && !cd.done ? (
            <span className="text-primary font-bold tabular-nums" dir="ltr">
              {t('landing.upcoming.kicksOff')}{' '}
              {formatCountdown(cd, lang, {
                days: t('match.days'),
                hours: t('match.hours'),
                minutes: t('match.minutes'),
                seconds: t('match.seconds'),
              })}
            </span>
          ) : (
            <span className="text-muted-foreground flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" />
              {formatKickoff(m.kickoffAt, lang)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function MatchesCard() {
  const { t } = useI18n();
  const { data, isLoading } = useGetMatches({ scope: GetMatchesScope.upcoming });
  const items: MatchSummary[] = (data || []).slice(0, 2);

  return (
    <CardShell title={t('nav.matches')} href="/matches">
      {isLoading ? (
        <RowSkeleton count={2} />
      ) : items.length === 0 ? (
        <EmptyState text={t('matches.empty')} />
      ) : (
        <div className="space-y-2" data-testid="list-home-matches">
          {items.map((m) => (
            <NextMatchRow key={m.id} m={m} />
          ))}
        </div>
      )}
    </CardShell>
  );
}

export default function HomePage() {
  const { t } = useI18n();
  const { data: me } = useGetMe();
  const trackEvent = useTrackAnalyticsEvent();

  const shareWhatsApp = () => {
    const base = import.meta.env.BASE_URL;
    const url = `${window.location.origin}${base}`;
    // Best-effort analytics; never block the share action on the request.
    trackEvent.mutate({ data: { type: 'whatsapp_share', entityType: 'app' } });
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${t('home.shareMessage')} ${url}`)}`,
      '_blank',
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gold-gradient">
              {t('home.welcome')}, {me?.displayName || me?.realName || '@' + me?.username}!
            </h1>
            <p className="text-muted-foreground mt-2">{t('home.level')}: <span className="font-semibold capitalize text-secondary">{me?.level}</span> | {t('home.points')}: <span className="font-semibold text-primary">{me?.totalPoints}</span></p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/challenges/new">
              <Button className="gap-2 glow-green" data-testid="button-create-challenge">
                {t('home.createChallenge')}
              </Button>
            </Link>
            <Button variant="outline" className="gap-2 border-secondary/30 hover:bg-secondary/10 hover:text-secondary transition-colors" onClick={shareWhatsApp} data-testid="button-share-whatsapp-home">
              <SiWhatsapp className="w-5 h-5 text-[#25D366]" />
              {t('home.shareWhatsApp')}
            </Button>
          </div>
        </div>

        <NextActionBanner />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
          <ChallengesCard />
          <RankingCard />
          <MatchesCard />
        </div>
      </div>
    </Layout>
  );
}
