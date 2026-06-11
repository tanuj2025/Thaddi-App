import React from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetMe,
  useGetMyGamification,
  useTrackAnalyticsEvent,
  useDiscoverChallenges,
  useGetMyChallenges,
  useGetGlobalRanking,
  getGetGlobalRankingQueryKey,
  useGetMatches,
  GetMatchesScope,
  useListActiveAnnouncements,
} from '@workspace/api-client-react';
import { Zap, Swords, Clock, X, Megaphone } from 'lucide-react';
import type {
  ChallengeSummary,
  RankingEntry,
  MatchSummary,
} from '@workspace/api-client-react';
import { SiWhatsapp } from 'react-icons/si';
import {
  Users,
  Trophy,
  Crown,
  Medal,
  Star,
} from 'lucide-react';

import { formatNum, useCountdown, formatCountdown } from '../lib/matchUtils';
import { MatchCard } from '@/components/match-card';

const LEVEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bronze: Medal,
  silver: Medal,
  gold: Trophy,
  elite: Star,
  legend: Crown,
};

const FIRST_RUN_KEY = 'thaddi_first_run_dismissed';
const ANNOUNCEMENT_DISMISS_PREFIX = 'thaddi_announcement_dismissed_';

function AnnouncementBanner() {
  const { t, lang } = useI18n();
  const { data } = useListActiveAnnouncements();
  const [dismissed, setDismissed] = React.useState<Set<string>>(() => new Set());

  const dismiss = (id: string) => {
    try { localStorage.setItem(`${ANNOUNCEMENT_DISMISS_PREFIX}${id}`, '1'); } catch { /* ignore */ }
    setDismissed((prev) => new Set(prev).add(id));
  };

  const visible = (data?.announcements ?? []).filter((a) => {
    if (dismissed.has(a.id)) return false;
    try { return localStorage.getItem(`${ANNOUNCEMENT_DISMISS_PREFIX}${a.id}`) !== '1'; } catch { return true; }
  });

  if (visible.length === 0) return null;

  return (
    <div className="space-y-3">
      {visible.map((a) => {
        const title = lang === 'ar' ? a.titleAr : a.titleEn;
        const body = lang === 'ar' ? a.bodyAr : a.bodyEn;
        return (
          <Card
            key={a.id}
            className="card-premium border-secondary/40 relative overflow-hidden"
            data-testid={`card-announcement-${a.id}`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-secondary/10 to-transparent pointer-events-none" />
            <CardContent className="relative z-10 flex items-start gap-3 p-4">
              <div className="w-9 h-9 rounded-full bg-secondary/15 border border-secondary/30 flex items-center justify-center shrink-0">
                <Megaphone className="w-4 h-4 text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{title}</p>
                {body && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{body}</p>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => dismiss(a.id)}
                className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 -mt-1 -me-2"
                aria-label={t('home.announcement.dismiss')}
                data-testid={`button-dismiss-announcement-${a.id}`}
              >
                <X className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function FirstRunChecklist() {
  const { t } = useI18n();
  const { data: me } = useGetMe();
  const { data: mine } = useGetMyChallenges();
  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    try { return localStorage.getItem(FIRST_RUN_KEY) === '1'; } catch { return false; }
  });

  const totalPoints = me?.totalPoints ?? 0;
  const challengeCount = (mine?.owned?.length ?? 0) + (mine?.joined?.length ?? 0);

  if (dismissed || totalPoints > 0 || challengeCount > 0 || !me) return null;

  const dismiss = () => {
    try { localStorage.setItem(FIRST_RUN_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  const shareApp = () => {
    const base = import.meta.env.BASE_URL;
    const url = `${window.location.origin}${base}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(t('home.shareMessage') + ' ' + url)}`, '_blank');
  };

  const steps = [
    { num: 1, title: t('home.firstRun.step1.title'), desc: t('home.firstRun.step1.desc'), cta: t('home.firstRun.step1.cta'), href: '/matches' },
    { num: 2, title: t('home.firstRun.step2.title'), desc: t('home.firstRun.step2.desc'), cta: t('home.firstRun.step2.cta'), href: '/challenges' },
    { num: 3, title: t('home.firstRun.step3.title'), desc: t('home.firstRun.step3.desc'), cta: t('home.firstRun.step3.cta'), href: '' },
  ];

  return (
    <Card className="card-premium border-secondary/30 relative overflow-hidden" data-testid="card-first-run">
      <div className="absolute inset-0 bg-gradient-to-br from-secondary/5 to-transparent pointer-events-none" />
      <CardHeader className="relative z-10 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-xl font-black text-gold-gradient">{t('home.firstRun.title')}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{t('home.firstRun.subtitle')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={dismiss}
            className="shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 -mt-1 -me-2"
            data-testid="button-dismiss-first-run"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="relative z-10 space-y-3">
        {steps.map((step) => (
          <div key={step.num} className="flex items-center gap-4 rounded-xl border border-border/40 bg-background/40 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-secondary/15 border border-secondary/30 flex items-center justify-center shrink-0">
              <span className="text-sm font-black text-secondary" dir="ltr">{step.num}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{step.title}</p>
              <p className="text-xs text-muted-foreground">{step.desc}</p>
            </div>
            {step.href ? (
              <Link href={step.href}>
                <Button size="sm" variant="outline" className="shrink-0 border-secondary/30 text-secondary hover:bg-secondary/10 hover:text-secondary text-xs h-7 px-2">
                  {step.cta}
                </Button>
              </Link>
            ) : (
              <Button size="sm" variant="outline" onClick={shareApp} className="shrink-0 border-secondary/30 text-secondary hover:bg-secondary/10 hover:text-secondary text-xs h-7 px-2">
                {step.cta}
              </Button>
            )}
          </div>
        ))}
        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={dismiss} className="text-muted-foreground hover:text-foreground text-xs" data-testid="button-dismiss-first-run-footer">
            {t('home.firstRun.dismiss')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NextActionBanner() {
  const { t } = useI18n();
  const { data: matchData, isLoading: matchLoading } = useGetMatches({ scope: GetMatchesScope.upcoming });
  const { data: mineData, isLoading: mineLoading } = useGetMyChallenges();

  const upcoming = matchData ?? [];
  const pending = [...upcoming]
    .filter((m) => !m.myPrediction && !m.isLocked)
    .sort((a, b) => {
      const aMs = (a as { predictionLockAt?: string }).predictionLockAt
        ? new Date((a as { predictionLockAt?: string }).predictionLockAt!).getTime()
        : Infinity;
      const bMs = (b as { predictionLockAt?: string }).predictionLockAt
        ? new Date((b as { predictionLockAt?: string }).predictionLockAt!).getTime()
        : Infinity;
      return aMs - bMs;
    });
  const urgentLockAt = (pending[0] as { predictionLockAt?: string } | undefined)?.predictionLockAt;
  const cd = useCountdown(urgentLockAt);

  if (matchLoading || mineLoading) return null;

  const pendingCount = pending.length;
  const inAnyChallenges = ((mineData?.owned?.length ?? 0) + (mineData?.joined?.length ?? 0)) > 0;

  if (!inAnyChallenges) {
    return (
      <Link href="/challenges">
        <div
          className="flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 cursor-pointer hover:bg-primary/8 transition-colors group"
          data-testid="banner-next-action-join"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Swords className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-semibold text-foreground truncate">{t('home.nextAction.noChallenges')}</span>
          </div>
          <span className="text-xs font-bold text-primary shrink-0 group-hover:underline underline-offset-2">
            {t('home.nextAction.joinCta')} →
          </span>
        </div>
      </Link>
    );
  }

  if (pendingCount === 0) return null;

  const URGENCY_MS = 24 * 60 * 60 * 1000;
  const isUrgent = urgentLockAt != null && new Date(urgentLockAt).getTime() - Date.now() < URGENCY_MS;

  if (isUrgent && pending[0]) {
    const urgentMatch = pending[0];
    const cdStr = formatCountdown(cd);
    return (
      <Link href={`/matches/${urgentMatch.id}`}>
        <div
          className="rounded-xl border border-destructive/40 bg-gradient-to-br from-destructive/5 to-secondary/5 px-4 py-3 cursor-pointer hover:border-destructive/60 transition-all"
          data-testid="banner-urgent-match"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-destructive/15 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4 text-destructive animate-pulse" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-destructive uppercase tracking-wide mb-0.5">
                  {t('home.nextAction.pendingPredictions').replace('{count}', String(pendingCount))}
                </p>
                <p className="font-semibold text-sm">{t('home.nextAction.predictCta')}</p>
              </div>
            </div>
            <div className="shrink-0 text-end">
              <p className="font-black tabular-nums text-destructive leading-tight text-lg" dir="ltr">{cdStr}</p>
              <p className="text-[10px] text-muted-foreground">{t('matches.locksIn')}</p>
            </div>
          </div>
        </div>
      </Link>
    );
  }

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

function EmptyState({ text, cta, href }: { text: string; cta?: string; href?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-28 gap-3 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta && href && (
        <Link href={href}>
          <Button variant="outline" size="sm" className="border-primary/30 text-primary hover:bg-primary/10 hover:text-primary">
            {cta}
          </Button>
        </Link>
      )}
    </div>
  );
}

function ErrorRetry({ onRetry, label }: { onRetry: () => void; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-28 gap-3">
      <Button variant="outline" size="sm" onClick={onRetry} className="border-border/50 text-muted-foreground hover:text-foreground">
        {label}
      </Button>
    </div>
  );
}

function ChallengesCard() {
  const { t, lang } = useI18n();
  const { data, isLoading, isError, refetch } = useDiscoverChallenges();
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
      ) : isError ? (
        <ErrorRetry onRetry={() => refetch()} label={t('common.tryAgain')} />
      ) : items.length === 0 ? (
        <EmptyState text={t('challenges.emptyDiscover')} cta={t('home.emptyChallengesCta')} href="/challenges" />
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
  const { data, isLoading, isError, refetch } = useGetGlobalRanking(
    { limit: 5 },
    { query: { queryKey: getGetGlobalRankingQueryKey({ limit: 5 }) } },
  );
  const me = data?.me ?? null;
  const entries: RankingEntry[] = data?.entries ?? [];

  return (
    <CardShell title={t('nav.rankings')} href="/rankings">
      {isLoading ? (
        <RowSkeleton />
      ) : isError ? (
        <ErrorRetry onRetry={() => refetch()} label={t('common.tryAgain')} />
      ) : entries.length === 0 && !me ? (
        <EmptyState text={t('rankings.empty')} cta={t('home.emptyRankingCta')} href="/matches" />
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

function MatchesCard() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useGetMatches({ scope: GetMatchesScope.upcoming });
  const items: MatchSummary[] = (data || []).slice(0, 2);

  return (
    <CardShell title={t('nav.matches')} href="/matches">
      {isLoading ? (
        <RowSkeleton count={2} />
      ) : isError ? (
        <ErrorRetry onRetry={() => refetch()} label={t('common.tryAgain')} />
      ) : items.length === 0 ? (
        <EmptyState text={t('matches.empty')} cta={t('home.emptyMatchesCta')} href="/matches" />
      ) : (
        <div className="space-y-3" data-testid="list-home-matches">
          {items.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </CardShell>
  );
}

export default function HomePage() {
  const { t, lang } = useI18n();
  const { data: me } = useGetMe();
  const { data: gam } = useGetMyGamification();
  const trackEvent = useTrackAnalyticsEvent();
  const lp = gam?.levelProgress;
  const LevelIcon = lp ? (LEVEL_ICONS[lp.level] ?? Trophy) : Medal;

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
        <AnnouncementBanner />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gold-gradient">
              {t('home.welcome')}, {me?.displayName || me?.realName || '@' + me?.username}!
            </h1>
            <div className="mt-3 space-y-1.5 max-w-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-secondary capitalize">
                  <LevelIcon className="w-4 h-4 shrink-0" />
                  {lp ? (lang === 'ar' ? lp.nameAr : lp.nameEn) : me?.level}
                </span>
                <span className="text-sm font-bold text-primary tabular-nums">
                  {formatNum(gam?.stats?.totalPoints ?? me?.totalPoints ?? 0, lang)} {t('home.points')}
                </span>
              </div>
              {lp && (
                <>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted/60">
                    <div
                      className="h-full rounded-full bg-secondary transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, lp.progressPercent))}%` }}
                      data-testid="bar-home-level-progress"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {lp.nextLevel
                      ? t('gam.pointsToNext')
                          .replace('{points}', formatNum(lp.pointsToNextLevel ?? 0, lang))
                          .replace('{level}', lang === 'ar' ? (lp.nextLevelNameAr ?? '') : (lp.nextLevelNameEn ?? ''))
                      : t('gam.maxLevel')}
                  </p>
                </>
              )}
            </div>
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

        <FirstRunChecklist />
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
