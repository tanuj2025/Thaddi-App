import React, { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { formatNum } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMyChallenges,
  useDiscoverChallenges,
  useGetMySubscription,
  getGetMySubscriptionQueryKey,
  useGetMe,
  useJoinChallenge,
  useRequestToJoinChallenge,
  getGetMyChallengesQueryKey,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import type { ChallengeSummary } from '@workspace/api-client-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Users, Trophy, Search, Swords, Star, Crown, ArrowUpRight, Lock, Globe, Loader2, Award, Sparkles, Send } from 'lucide-react';

function VisibilityBadge({ visibility }: { visibility: string }) {
  const { t } = useI18n();
  if (visibility === 'private') {
    return (
      <Badge variant="outline" className="shrink-0 gap-1 border-primary/30 text-primary bg-primary/5">
        <Lock className="w-3 h-3" />
        {t('visibility.private')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 gap-1 border-secondary/30 text-secondary bg-secondary/5">
      <Globe className="w-3 h-3" />
      {t('visibility.public')}
    </Badge>
  );
}

const PRESTIGE_CROWN_CLASSES: Record<1 | 2 | 3, string> = {
  1: 'bg-secondary text-secondary-foreground border-secondary/30 shadow-[0_0_8px_rgba(var(--secondary-rgb,212,175,55)/0.5)]',
  2: 'bg-muted/80 text-foreground/70 border-border/60',
  3: 'bg-amber-900/30 text-amber-400 border-amber-600/40',
};

function ChallengeCard({
  c,
  onJoinPrivate,
  onRequestJoin,
  prestigeRank,
  isPendingRequest,
}: {
  c: ChallengeSummary;
  onJoinPrivate?: (c: ChallengeSummary) => void;
  onRequestJoin?: (c: ChallengeSummary) => void;
  prestigeRank?: 1 | 2 | 3;
  isPendingRequest?: boolean;
}) {
  const { t, lang } = useI18n();
  // The invite code is only present for challenges the viewer owns or already
  // joined. A private challenge with no code means the viewer is an outsider,
  // whose only path in is the join-by-code flow (the detail page returns 403).
  const isPrivate = c.visibility === 'private';
  const isMember = Boolean(c.inviteCode);
  const codeRequired = isPrivate && !isMember;
  const badgeSpend = parseFloat(c.badgeTotalSar ?? '0');

  const body = (
    <Card
      className="card-glass cursor-pointer transition-all hover:border-secondary/50 hover:shadow-lg h-full group"
      data-testid={`card-challenge-${c.id}`}
    >
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-lg truncate group-hover:text-secondary transition-colors">{c.name}</h3>
            {c.ownerDisplayName && (
              <p className="text-xs text-muted-foreground truncate">
                {t('challenges.hostedBy')} <span className="text-foreground/80">{c.ownerDisplayName}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {prestigeRank && (
              <Badge
                className={`gap-1 text-xs font-bold border ${PRESTIGE_CROWN_CLASSES[prestigeRank]}`}
                title={t(`prestige.crown.${prestigeRank}` as 'prestige.crown.1')}
                data-testid={`badge-prestige-crown-${c.id}`}
              >
                <Crown className="w-3 h-3" />
                <span dir="ltr">#{formatNum(prestigeRank, lang)}</span>
              </Badge>
            )}
            <Badge variant="secondary" className="bg-secondary/10 text-secondary border border-secondary/20">{t(`type.${c.type}`)}</Badge>
            <VisibilityBadge visibility={c.visibility} />
          </div>
        </div>
        {c.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
        )}
        <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
          <span className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-primary/70" />
            <span dir="ltr">{formatNum(c.participantCount, lang)}</span>
          </span>
          {c.prizeCount > 0 && (
            <span className="flex items-center gap-1.5 text-secondary">
              <Trophy className="w-4 h-4" />
              {formatNum(c.prizeCount, lang)} {t('challenges.prizes')}
            </span>
          )}
        </div>
        {codeRequired && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="flex items-center gap-1.5 text-xs text-primary/80">
              <Lock className="w-3 h-3" />
              {t('challenges.codeToJoin')}
            </div>
            {isPendingRequest ? (
              <Badge
                className="h-6 px-2 text-xs gap-1.5 border-secondary/30 bg-secondary/5 text-secondary"
                variant="outline"
                data-testid={`badge-pending-request-${c.id}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse shrink-0" />
                {t('challenges.requestJoinPendingBadge')}
              </Badge>
            ) : onRequestJoin ? (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs border-secondary/40 text-secondary hover:bg-secondary/10 hover:text-secondary"
                data-testid={`button-request-join-${c.id}`}
                onClick={(e) => { e.stopPropagation(); onRequestJoin(c); }}
              >
                <Send className="w-3 h-3 me-1" />
                {t('challenges.requestJoin')}
              </Button>
            ) : null}
          </div>
        )}
        {c.badges.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {c.badges.slice(0, 6).map((b) => (
              <img
                key={b.id}
                src={`${import.meta.env.BASE_URL}${b.iconUrl}`}
                alt={lang === 'ar' ? b.nameAr : b.nameEn}
                title={lang === 'ar' ? b.nameAr : b.nameEn}
                className="w-7 h-7 object-contain drop-shadow"
                data-testid={`card-badge-${b.code}`}
              />
            ))}
            {c.badges.length > 6 && (
              <span className="text-xs text-muted-foreground" dir="ltr">
                +{formatNum(c.badges.length - 6, lang)}
              </span>
            )}
          </div>
        )}
        {badgeSpend > 0 && (
          <div className="flex items-center gap-1 text-xs text-secondary/80" data-testid={`badge-spend-${c.id}`}>
            <Sparkles className="w-3 h-3 shrink-0" />
            <span className="font-medium">{t('challenges.premiumBadges')}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (codeRequired) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onJoinPrivate?.(c)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onJoinPrivate?.(c);
          }
        }}
        data-testid={`button-join-private-${c.id}`}
      >
        {body}
      </div>
    );
  }

  return <Link href={`/challenges/${c.id}`}>{body}</Link>;
}

function JoinByCodeDialog({
  challenge,
  onClose,
}: {
  challenge: ChallengeSummary | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const { isSignedIn } = useUser();
  const { data: me } = useGetMe({
    query: { enabled: isSignedIn === true, queryKey: getGetMeQueryKey() },
  });
  const activated = me?.activated === true;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const join = useJoinChallenge();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setCode('');
    setError('');
  }, [challenge?.id]);

  const submit = () => {
    if (!challenge) return;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError(t('challenges.codeRequired'));
      return;
    }
    setError('');

    // Guests / not-yet-activated users go through the established invite flow,
    // which preserves the code and resumes the join after sign-in & activation.
    if (!isSignedIn || !activated) {
      onClose();
      setLocation(`/join/${trimmed}`);
      return;
    }

    join.mutate(
      { id: challenge.id, data: { viaCode: trimmed } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          toast({ title: t('join.joined') });
          onClose();
          setLocation(`/challenges/${challenge.id}`);
        },
        onError: (err) => {
          if (err?.status === 403) {
            setError(t('challenges.wrongCode'));
          } else if (err?.status === 409) {
            const detail = String(err?.data?.error || '');
            setError(/limit/i.test(detail) ? t('join.full') : t('join.ended'));
          } else {
            setError(t('join.error'));
          }
        },
      },
    );
  };

  return (
    <Dialog open={!!challenge} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-card border-border/50" data-testid="dialog-join-by-code">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            {t('challenges.joinPrivateTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('challenges.joinPrivateDesc')}
            {challenge?.name ? <span className="block mt-1 font-semibold text-foreground">{challenge.name}</span> : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="join-code">{t('challenges.codeLabel')}</Label>
          <Input
            id="join-code"
            value={code}
            onChange={(e) => { setCode(e.target.value); if (error) setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={t('challenges.codePlaceholder')}
            dir="ltr"
            autoComplete="off"
            className="font-mono tracking-widest text-center uppercase bg-background/50 focus-visible:ring-primary"
            data-testid="input-join-code"
          />
          {error && (
            <p className="text-sm text-destructive" data-testid="text-join-error">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border/50 hover:bg-muted/50" data-testid="button-cancel-join">
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={join.isPending} className="glow-green" data-testid="button-confirm-join">
            {join.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t('join.joinNow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestJoinDialog({
  challenge,
  onClose,
  onRequestSent,
}: {
  challenge: ChallengeSummary | null;
  onClose: () => void;
  onRequestSent?: (id: string) => void;
}) {
  const { t } = useI18n();
  const { isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const request = useRequestToJoinChallenge();

  useEffect(() => { setMessage(''); }, [challenge?.id]);

  const submit = () => {
    if (!challenge) return;
    if (!isSignedIn) {
      onClose();
      setLocation('/sign-in');
      return;
    }
    request.mutate(
      { id: challenge.id, data: { message: message.trim() || undefined } },
      {
        onSuccess: () => {
          toast({ title: t('challenges.requestJoinSuccess') });
          if (challenge) onRequestSent?.(challenge.id);
          onClose();
        },
        onError: (err) => {
          const code = String((err as { data?: { code?: string } })?.data?.code ?? '');
          if (code === 'already_requested') {
            toast({ title: t('challenges.requestJoinPending') });
            onClose();
          } else {
            toast({ title: t('common.error'), variant: 'destructive' });
          }
        },
      },
    );
  };

  return (
    <Dialog open={!!challenge} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-card border-border/50" data-testid="dialog-request-join">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-4 h-4 text-secondary" />
            {t('challenges.requestJoinTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('challenges.requestJoinDesc')}
            {challenge?.name && <span className="block mt-1 font-semibold text-foreground">{challenge.name}</span>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="request-message">{t('challenges.requestJoinMessage')}</Label>
          <textarea
            id="request-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('challenges.requestJoinMessagePlaceholder')}
            maxLength={500}
            rows={3}
            className="w-full rounded-md border border-border/50 bg-background/50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-secondary/50 placeholder:text-muted-foreground"
            data-testid="textarea-request-message"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border/50 hover:bg-muted/50" data-testid="button-cancel-request">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={submit}
            disabled={request.isPending}
            className="bg-secondary hover:bg-secondary/90 text-secondary-foreground"
            data-testid="button-send-request"
          >
            {request.isPending ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Send className="w-4 h-4 me-2" />}
            {t('challenges.requestJoinSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="card-glass border-border/50">
          <CardContent className="p-5 space-y-3">
            <Skeleton className="h-6 w-2/3 bg-muted/50" />
            <Skeleton className="h-4 w-full bg-muted/50" />
            <Skeleton className="h-4 w-1/2 bg-muted/50" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MyPlanCard() {
  const { t, lang } = useI18n();
  const { data: sub } = useGetMySubscription({
    query: {
      queryKey: getGetMySubscriptionQueryKey(),
      refetchOnWindowFocus: true,
      staleTime: 60_000,
    },
  });
  if (!sub) return null;

  const isFree = sub.planCode === 'free';
  const planName = lang === 'ar' ? sub.planNameAr : sub.planNameEn;
  const limitText =
    sub.participantLimit != null
      ? `${formatNum(sub.participantsUsed, lang)}/${formatNum(sub.participantLimit, lang)}`
      : `${formatNum(sub.participantsUsed, lang)} · ${t('myPlan.unlimited')}`;

  return (
    <Card className="card-glass border-secondary/30" data-testid="card-my-plan">
      <CardContent className="p-5 flex flex-row flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-secondary/15 text-secondary flex items-center justify-center shrink-0">
            <Crown className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('myPlan.title')}</p>
            <p className="font-bold text-lg truncate" data-testid="text-my-plan-name">{planName}</p>
            <p className="text-sm text-muted-foreground">
              {t('myPlan.participantLimit')}:{' '}
              <span className="text-foreground/90 font-medium" dir="ltr">{limitText}</span>
            </p>
          </div>
        </div>
        {isFree && (
          <Link href="/pricing">
            <Button className="glow-green shrink-0" data-testid="button-upgrade-plan">
              <ArrowUpRight className="w-4 h-4 me-2 rtl:-scale-x-100" />
              {t('myPlan.upgrade')}
            </Button>
          </Link>
        )}
        {!isFree && (
          <Link href="/pricing">
            <Button variant="outline" className="shrink-0" data-testid="button-manage-plan">
              {t('myPlan.manage')}
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

export default function ChallengesPage() {
  const { t, lang } = useI18n();
  const { isSignedIn } = useUser();
  const { data: mine, isLoading: mineLoading, isError: mineError, refetch: mineRefetch } = useGetMyChallenges({
    query: { enabled: isSignedIn === true, queryKey: getGetMyChallengesQueryKey() },
  });
  const { data: discover, isLoading: discLoading, isError: discError, refetch: discRefetch } = useDiscoverChallenges();
  const { data: featured } = useDiscoverChallenges({ featured: true });
  const [q, setQ] = useState('');
  const [joinTarget, setJoinTarget] = useState<ChallengeSummary | null>(null);
  const [requestJoinTarget, setRequestJoinTarget] = useState<ChallengeSummary | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('thaddi_pending_requests') || '[]')); }
    catch { return new Set(); }
  });

  const owned = mine?.owned || [];
  const joined = mine?.joined || [];
  const filteredDiscover = (discover || []).filter((c) =>
    c.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const featuredList = featured || [];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-gold-gradient">{t('challenges.title')}</h1>
          <Link href="/challenges/new">
            <Button className="glow-green" data-testid="button-create-challenge">
              <Plus className="w-4 h-4 me-2" />
              <span className="hidden sm:inline">{t('challenges.create')}</span>
            </Button>
          </Link>
        </div>

        <Tabs key={isSignedIn === true ? 'signed-in' : 'signed-out'} defaultValue={isSignedIn ? 'mine' : 'discover'} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <TabsList className="bg-muted/50 border border-border/70 p-1.5 rounded-xl h-auto inline-flex gap-1">
            {isSignedIn && (
              <TabsTrigger value="mine" data-testid="tab-mine" className="py-1.5 px-5 rounded-lg font-semibold text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">{t('challenges.mine')}</TabsTrigger>
            )}
            <TabsTrigger value="discover" data-testid="tab-discover" className="py-1.5 px-5 rounded-lg font-semibold text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all">{t('challenges.discover')}</TabsTrigger>
          </TabsList>

          {isSignedIn && (
          <TabsContent value="mine" className="space-y-8 mt-6">
            <MyPlanCard />
            {mineLoading ? (
              <CardGridSkeleton />
            ) : mineError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <p className="text-sm text-muted-foreground">{t('common.loadError')}</p>
                <Button variant="outline" size="sm" onClick={() => mineRefetch()} className="border-border/50 text-muted-foreground hover:text-foreground" data-testid="button-retry-mine">
                  {t('common.tryAgain')}
                </Button>
              </div>
            ) : owned.length === 0 && joined.length === 0 ? (
              <Card className="card-glass border-border/50 border-dashed">
                <CardContent className="py-16 flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center glow-green">
                    <Swords className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-muted-foreground max-w-sm">{t('challenges.emptyMine')}</p>
                  <Link href="/challenges/new">
                    <Button data-testid="button-empty-create" className="glow-green">
                      <Plus className="w-4 h-4 me-2" />
                      {t('challenges.emptyMineCta')}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <>
                {owned.length > 0 && (
                  <section className="space-y-4">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary uppercase tracking-wide">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary"></div>
                      {t('challenges.owned')}
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {owned.map((c) => <ChallengeCard key={c.id} c={c} isPendingRequest={pendingIds.has(c.id)} />)}
                    </div>
                  </section>
                )}
                {owned.length > 0 && joined.length > 0 && <div className="divider-gold h-px w-full my-6 opacity-30" />}
                {joined.length > 0 && (
                  <section className="space-y-4">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-primary uppercase tracking-wide">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                      {t('challenges.joined')}
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {joined.map((c) => <ChallengeCard key={c.id} c={c} isPendingRequest={pendingIds.has(c.id)} />)}
                    </div>
                  </section>
                )}
              </>
            )}
          </TabsContent>
          )}

          <TabsContent value="discover" className="space-y-6 mt-6">
            {!q && featuredList.length > 0 && (
              <section className="space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary uppercase tracking-wide">
                  <Star className="w-4 h-4 text-secondary fill-secondary/20" />
                  {t('challenges.featured')}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {featuredList.map((c) => <ChallengeCard key={c.id} c={c} onJoinPrivate={setJoinTarget} onRequestJoin={isSignedIn ? setRequestJoinTarget : undefined} isPendingRequest={pendingIds.has(c.id)} />)}
                </div>
              </section>
            )}
            
            {featuredList.length > 0 && !q && <div className="divider-gold h-px w-full my-6 opacity-30" />}

            <div className="relative max-w-md">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('challenges.search')}
                className="ps-9 bg-card/50 border-border/50 focus-visible:ring-secondary/50 focus-visible:border-secondary/50"
                data-testid="input-search-challenges"
              />
            </div>
            {discLoading ? (
              <CardGridSkeleton />
            ) : discError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <p className="text-sm text-muted-foreground">{t('common.loadError')}</p>
                <Button variant="outline" size="sm" onClick={() => discRefetch()} className="border-border/50 text-muted-foreground hover:text-foreground" data-testid="button-retry-discover">
                  {t('common.tryAgain')}
                </Button>
              </div>
            ) : filteredDiscover.length === 0 ? (
              <Card className="card-glass border-border/50 border-dashed">
                <CardContent className="py-16 flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                    <Search className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground">
                    {q ? t('challenges.noResults') : t('challenges.emptyDiscover')}
                  </p>
                  <Link href="/challenges/new">
                    <Button size="sm" className="glow-green">
                      <Plus className="w-4 h-4 me-2" />
                      {q ? t('challenges.noResultsCta') : t('challenges.emptyDiscoverCta')}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {filteredDiscover.map((c, idx) => (
                  <ChallengeCard
                    key={c.id}
                    c={c}
                    onJoinPrivate={setJoinTarget}
                    onRequestJoin={isSignedIn ? setRequestJoinTarget : undefined}
                    isPendingRequest={pendingIds.has(c.id)}
                    prestigeRank={
                      !q && idx < 3 && parseFloat(c.badgeTotalSar ?? '0') > 0
                        ? ((idx + 1) as 1 | 2 | 3)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <JoinByCodeDialog challenge={joinTarget} onClose={() => setJoinTarget(null)} />
      <RequestJoinDialog
        challenge={requestJoinTarget}
        onClose={() => setRequestJoinTarget(null)}
        onRequestSent={(id) => {
          setPendingIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            try { localStorage.setItem('thaddi_pending_requests', JSON.stringify([...next])); } catch { /* ignore */ }
            return next;
          });
        }}
      />
    </Layout>
  );
}
