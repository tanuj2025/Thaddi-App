import React, { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { useLocation, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetChallenge,
  useGetChallengeParticipants,
  useGetMySubscription,
  useUpdateChallenge,
  useRegenerateInvite,
  useRemoveParticipant,
  useDeleteChallenge,
  useLeaveChallenge,
  usePromoteAssistant,
  useDemoteAssistant,
  getGetChallengeQueryKey,
  getGetChallengeParticipantsQueryKey,
  getGetMySubscriptionQueryKey,
  getGetMyChallengesQueryKey,
  UpdateChallengeVisibility,
  UpdateChallengePredictionVisibility,
} from '@workspace/api-client-react';
import type {
  ChallengePrizeInput,
  UpdateChallengeVisibility as TVisibility,
  UpdateChallengePredictionVisibility as TPredVis,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, Users, Trophy, Copy, RefreshCw, MessageCircle, Crown,
  Loader2, Plus, Trash2, Settings, Lock, Swords, LogOut, Shield, ShieldPlus, ShieldMinus,
} from 'lucide-react';
import { ChallengeLeaderboard, WinningProbabilityCard, RankingImpactCard } from '../components/challenge-stats';
import { formatNum } from '../lib/matchUtils';

function inviteLinkFor(code: string): string {
  const base = import.meta.env.BASE_URL; // ends with '/'
  return `${window.location.origin}${base}join/${code}`;
}

export default function ChallengeDetailPage() {
  const { t, lang } = useI18n();
  const [, setLocation] = useLocation();
  const params = useParams();
  const id = params.id as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { isSignedIn } = useUser();
  const { data: ch, isLoading } = useGetChallenge(id);
  const { data: participants } = useGetChallengeParticipants(id);
  const { data: sub } = useGetMySubscription({
    query: { enabled: isSignedIn === true, queryKey: getGetMySubscriptionQueryKey() },
  });
  const update = useUpdateChallenge();
  const regenerate = useRegenerateInvite();
  const removeParticipant = useRemoveParticipant();
  const deleteChallenge = useDeleteChallenge();
  const leaveChallenge = useLeaveChallenge();
  const promoteAssistant = usePromoteAssistant();
  const demoteAssistant = useDemoteAssistant();

  const canCustomPrizes =
    sub?.entitlements?.find((e) => e.key === 'custom_prizes')?.value === 'true';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<TVisibility>(UpdateChallengeVisibility.private);
  const [predictionVisibility, setPredictionVisibility] = useState<TPredVis>(
    UpdateChallengePredictionVisibility.reveal_after_kickoff,
  );
  const [prizes, setPrizes] = useState<ChallengePrizeInput[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    if (ch) {
      setName(ch.name);
      setDescription(ch.description || '');
      setVisibility(ch.visibility as TVisibility);
      setPredictionVisibility(ch.predictionVisibility as TPredVis);
      setPrizes(
        (ch.prizes || []).map((p) => ({
          place: p.place,
          titleAr: p.titleAr || '',
          titleEn: p.titleEn || '',
          value: p.value || '',
        })),
      );
    }
  }, [ch]);

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-8 w-1/2 bg-muted/50" />
          <Skeleton className="h-40 w-full bg-muted/50" />
          <Skeleton className="h-40 w-full bg-muted/50" />
        </div>
      </Layout>
    );
  }

  if (!ch) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto text-center py-20 space-y-4">
          <p className="text-muted-foreground">{t('detail.notFound')}</p>
          <Button variant="outline" onClick={() => setLocation('/challenges')} className="border-secondary/30 hover:bg-secondary/10 hover:text-secondary">
            {t('common.back')}
          </Button>
        </div>
      </Layout>
    );
  }

  const inviteCode = ch.inviteCode || '';
  const link = inviteCode ? inviteLinkFor(inviteCode) : '';

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: t('detail.copied') });
    } catch {
      toast({ title: link });
    }
  };

  const shareWhatsApp = () => {
    if (!link) return;
    const text = `${t('detail.shareMessage')} ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const doRegenerate = () => {
    regenerate.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetChallengeQueryKey(id) });
          toast({ title: t('detail.regenerated') });
        },
        onError: (err) => toast({ title: err.data?.error || t('detail.saveError'), variant: 'destructive' }),
      },
    );
  };

  const addPrize = () =>
    setPrizes((p) => [...p, { place: p.length + 1, titleAr: '', titleEn: '', value: '' }]);
  const removePrize = (idx: number) =>
    setPrizes((p) => p.filter((_, i) => i !== idx).map((pr, i) => ({ ...pr, place: i + 1 })));
  const updatePrize = (idx: number, patch: Partial<ChallengePrizeInput>) =>
    setPrizes((p) => p.map((pr, i) => (i === idx ? { ...pr, ...patch } : pr)));

  const saveSettings = () => {
    const cleanPrizes = canCustomPrizes
      ? prizes
          .filter((p) => (p.titleAr || p.titleEn || p.value)?.toString().trim())
          .map((p) => ({
            place: p.place,
            titleAr: p.titleAr?.trim() || undefined,
            titleEn: p.titleEn?.trim() || undefined,
            value: p.value?.toString().trim() || undefined,
            currency: p.value?.toString().trim() ? 'SAR' : undefined,
          }))
      : undefined;

    update.mutate(
      {
        id,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          visibility,
          predictionVisibility,
          ...(cleanPrizes ? { prizes: cleanPrizes } : {}),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetChallengeQueryKey(id) });
          toast({ title: t('detail.saved') });
        },
        onError: (err) => toast({ title: err.data?.error || t('detail.saveError'), variant: 'destructive' }),
      },
    );
  };

  const doRemove = (userId: string) => {
    removeParticipant.mutate(
      { id, data: { userId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetChallengeParticipantsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetChallengeQueryKey(id) });
          toast({ title: t('detail.removed') });
        },
        onError: (err) => toast({ title: err.data?.error || t('detail.saveError'), variant: 'destructive' }),
      },
    );
  };

  const doDelete = () => {
    deleteChallenge.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          toast({ title: t('detail.deleted') });
          setDeleteOpen(false);
          setDeleteConfirmText('');
          setLocation('/challenges');
        },
        onError: (err) => toast({ title: err.data?.error || t('detail.deleteError'), variant: 'destructive' }),
      },
    );
  };

  const doLeave = () => {
    leaveChallenge.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          toast({ title: t('detail.left') });
          setLocation('/challenges');
        },
        onError: (err) => toast({ title: err.data?.error || t('detail.leaveError'), variant: 'destructive' }),
      },
    );
  };

  const doPromote = (userId: string) => {
    promoteAssistant.mutate(
      { id, data: { userId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetChallengeParticipantsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetChallengeQueryKey(id) });
          toast({ title: t('detail.promoted') });
        },
        onError: (err) => toast({ title: err.data?.error || t('detail.saveError'), variant: 'destructive' }),
      },
    );
  };

  const doDemote = (userId: string) => {
    demoteAssistant.mutate(
      { id, data: { userId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetChallengeParticipantsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetChallengeQueryKey(id) });
          toast({ title: t('detail.demoted') });
        },
        onError: (err) => toast({ title: err.data?.error || t('detail.saveError'), variant: 'destructive' }),
      },
    );
  };

  const sortedPrizes = [...(ch.prizes || [])].sort((a, b) => a.place - b.place);

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/challenges')}
            data-testid="button-back"
            className="hover:bg-primary/10 hover:text-primary transition-colors mt-1"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight text-gold-gradient">{ch.name}</h1>
              <Badge variant="secondary" className="bg-secondary/10 text-secondary border border-secondary/20">{t(`type.${ch.type}`)}</Badge>
              <Badge variant="outline" className="border-primary/30 text-primary">{t(`visibility.${ch.visibility}`)}</Badge>
            </div>
            {ch.description && <p className="text-muted-foreground mt-2">{ch.description}</p>}
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-3">
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-primary/70" />
                <span dir="ltr">{ch.participantCount}{ch.participantLimit ? `/${ch.participantLimit}` : ''}</span>{' '}
                {t('challenges.participants')}
              </span>
            </div>
          </div>
        </div>

        {/* Join CTA (signed-in non-participants & guests) */}
        {!ch.isOwner && !ch.isParticipant && inviteCode && (
          <Card className="card-premium border-primary/30 bg-primary/5 glow-green">
            <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="font-medium text-primary">{t('detail.joinPrompt')}</p>
              <Button
                onClick={() => setLocation(`/join/${inviteCode}`)}
                data-testid="button-join-challenge"
                className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_rgba(var(--primary)/0.5)]"
              >
                <Swords className="w-4 h-4 me-2" />
                {t('detail.joinNow')}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Live ranking impact for the in-play / locked match (participants only) */}
        {ch.isParticipant && <RankingImpactCard challengeId={id} />}

        {/* Winning probability (gated; participants only) */}
        {ch.isParticipant && <WinningProbabilityCard challengeId={id} />}

        {/* Challenge standings */}
        <ChallengeLeaderboard challengeId={id} />

        {/* Invite & Share (visible to anyone who can view) */}
        {inviteCode && (
          <Card className="card-premium">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-secondary"></div>
                {t('detail.invite')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ch.isOwner && (
                <div className="space-y-2">
                  <Label>{t('detail.inviteCode')}</Label>
                  <div className="flex items-center gap-2">
                    <code
                      className="flex-1 rounded-lg bg-background/50 border border-border/50 px-4 py-2.5 font-mono text-lg font-bold tracking-widest text-center text-secondary"
                      dir="ltr"
                      data-testid="text-invite-code"
                    >
                      {inviteCode}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={doRegenerate}
                      disabled={regenerate.isPending}
                      title={t('detail.regenerate')}
                      data-testid="button-regenerate"
                      className="border-secondary/30 text-secondary hover:bg-secondary/10 hover:text-secondary"
                    >
                      {regenerate.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" className="flex-1 border-primary/30 hover:bg-primary/10 hover:text-primary transition-colors" onClick={copyLink} data-testid="button-copy-link">
                  <Copy className="w-4 h-4 me-2" />
                  {t('detail.copyLink')}
                </Button>
                <Button
                  className="flex-1 bg-[#25D366] hover:bg-[#1da851] text-white shadow-lg shadow-[#25D366]/20"
                  onClick={shareWhatsApp}
                  data-testid="button-share-whatsapp"
                >
                  <MessageCircle className="w-4 h-4 me-2" />
                  {t('detail.shareWhatsApp')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Prizes display */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-secondary" />
              {t('detail.prizes')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sortedPrizes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('detail.noPrizes')}</p>
            ) : (
              <ul className="space-y-2">
                {sortedPrizes.map((p) => (
                  <li
                    key={p.place}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                      p.place === 1 
                        ? 'border-secondary/40 bg-secondary/5 glow-gold'
                        : 'border-border/50 bg-background/30'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <Badge variant="secondary" className={p.place === 1 ? 'bg-secondary text-secondary-foreground' : 'bg-secondary/10 text-secondary border border-secondary/20'}>{t('detail.place')} {p.place}</Badge>
                      <span className={`font-medium ${p.place === 1 ? 'text-gold-gradient' : ''}`}>
                        {(lang === 'ar' ? p.titleAr : p.titleEn) || p.titleEn || p.titleAr || '—'}
                      </span>
                    </span>
                    {p.value && (
                      <span className="text-secondary font-bold font-mono" dir="ltr">
                        {p.value} <span className="text-sm font-normal text-secondary/70">{p.currency || 'SAR'}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Participants */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              {t('detail.participants')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(participants || []).map((p) => (
              <div
                key={p.userId}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5 transition-colors border border-transparent hover:border-border/50"
                data-testid={`participant-${p.userId}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="w-10 h-10 border border-primary/20">
                    <AvatarImage src={p.avatarUrl || ''} />
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                      {p.displayName?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{p.displayName || '—'}</span>
                      {p.isOwner && (
                        <Badge variant="secondary" className="gap-1 bg-secondary/10 text-secondary border border-secondary/20 h-5 px-1.5">
                          <Crown className="w-3 h-3" />
                          <span className="text-[10px]">{t('detail.ownerBadge')}</span>
                        </Badge>
                      )}
                      {!p.isOwner && p.isAssistant && (
                        <Badge variant="outline" className="gap-1 border-primary/30 text-primary h-5 px-1.5">
                          <Shield className="w-3 h-3" />
                          <span className="text-[10px]">{t('detail.assistantBadge')}</span>
                        </Badge>
                      )}
                    </div>
                    {p.username && (
                      <span className="text-xs text-muted-foreground truncate" dir="ltr">
                        @{p.username}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-sm font-mono text-primary font-bold bg-primary/10 px-2.5 py-1 rounded-md border border-primary/20">
                    {p.points} <span className="font-sans font-medium text-xs text-primary/70">{t('detail.points')}</span>
                  </span>
                  {ch.canManageMembers && !p.isOwner && !p.isAssistant && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-remove-${p.userId}`}
                          className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-card border-border/50">
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('detail.remove')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {p.displayName}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="border-border/50 hover:bg-muted/50">{t('common.cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => doRemove(p.userId)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t('detail.remove')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Leave challenge (non-owner participants only) */}
        {!ch.isOwner && ch.isParticipant && (
          <Card className="card-premium border-destructive/30">
            <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="font-semibold text-destructive flex items-center gap-2">
                  <LogOut className="w-4 h-4 rtl:rotate-180" />
                  {t('detail.leave')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('detail.leaveConfirmBody')}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    data-testid="button-leave-challenge"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                  >
                    <LogOut className="w-4 h-4 me-2 rtl:rotate-180" />
                    {t('detail.leave')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card border-border/50">
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('detail.leaveConfirmTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('detail.leaveConfirmBody')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-border/50 hover:bg-muted/50">{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={doLeave}
                      disabled={leaveChallenge.isPending}
                      data-testid="button-confirm-leave"
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {leaveChallenge.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                      {t('detail.leave')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        )}

        {/* Assistants management (owner only) */}
        {ch.isOwner && (
          <Card className="card-premium border-primary/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-primary">
                <Shield className="w-5 h-5" />
                {t('detail.assistants')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t('detail.assistantsDescription')}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {(participants || []).filter((p) => !p.isOwner).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('detail.noAssistantsHint')}</p>
              ) : (
                (participants || [])
                  .filter((p) => !p.isOwner)
                  .map((p) => (
                    <div
                      key={p.userId}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5 transition-colors border border-transparent hover:border-border/50"
                      data-testid={`assistant-row-${p.userId}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="w-9 h-9 border border-primary/20">
                          <AvatarImage src={p.avatarUrl || ''} />
                          <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                            {p.displayName?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate">{p.displayName || '—'}</span>
                            {p.isAssistant && (
                              <Badge variant="outline" className="gap-1 border-primary/30 text-primary h-5 px-1.5">
                                <Shield className="w-3 h-3" />
                                <span className="text-[10px]">{t('detail.assistantBadge')}</span>
                              </Badge>
                            )}
                          </div>
                          {p.username && (
                            <span className="text-xs text-muted-foreground truncate" dir="ltr">
                              @{p.username}
                            </span>
                          )}
                        </div>
                      </div>
                      {p.isAssistant ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => doDemote(p.userId)}
                          disabled={demoteAssistant.isPending}
                          data-testid={`button-demote-${p.userId}`}
                          className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <ShieldMinus className="w-4 h-4 me-2" />
                          {t('detail.demote')}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => doPromote(p.userId)}
                          disabled={promoteAssistant.isPending}
                          data-testid={`button-promote-${p.userId}`}
                          className="shrink-0 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
                        >
                          <ShieldPlus className="w-4 h-4 me-2" />
                          {t('detail.promote')}
                        </Button>
                      )}
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        )}

        {/* Owner settings */}
        {ch.isOwner && (
          <Card className="card-premium border-secondary/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-secondary">
                <Settings className="w-5 h-5" />
                {t('detail.settings')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="edit-name">{t('create.name')}</Label>
                <Input
                  id="edit-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="input-edit-name"
                  className="bg-background/50 focus-visible:ring-secondary"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-desc">{t('create.description')}</Label>
                <Textarea
                  id="edit-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  data-testid="input-edit-description"
                  className="bg-background/50 focus-visible:ring-secondary"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('create.visibility')}</Label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as TVisibility)}>
                    <SelectTrigger data-testid="select-edit-visibility" className="bg-background/50 focus:ring-secondary"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(UpdateChallengeVisibility).map((v) => (
                        <SelectItem key={v} value={v}>{t(`visibility.${v}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('create.predictionVisibility')}</Label>
                  <Select
                    value={predictionVisibility}
                    onValueChange={(v) => setPredictionVisibility(v as TPredVis)}
                  >
                    <SelectTrigger data-testid="select-edit-prediction-visibility" className="bg-background/50 focus:ring-secondary"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(UpdateChallengePredictionVisibility).map((v) => (
                        <SelectItem key={v} value={v}>{t(`pv.${v}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Prize editor */}
              <div className="space-y-3 pt-2">
                <div className="divider-gold h-px w-full mb-4 opacity-30" />
                <Label className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-secondary" />
                  {t('create.prizes')}
                </Label>
                {!canCustomPrizes ? (
                  <div className="flex items-start gap-3 rounded-xl border border-dashed border-border/50 bg-background/30 p-4 text-sm text-muted-foreground">
                    <Lock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/60" />
                    <span>{t('create.prizesLocked')}</span>
                  </div>
                ) : (
                  <>
                    {prizes.map((p, idx) => (
                      <div key={idx} className="rounded-xl border border-border/50 bg-background/30 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary" className="bg-secondary/10 text-secondary border border-secondary/20">{t('create.place')} {p.place}</Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removePrize(idx)}
                            className="text-destructive/70 hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            value={p.titleAr || ''}
                            onChange={(e) => updatePrize(idx, { titleAr: e.target.value })}
                            placeholder={t('create.prizeTitleAr')}
                            dir="rtl"
                            className="bg-card focus-visible:ring-secondary"
                          />
                          <Input
                            value={p.titleEn || ''}
                            onChange={(e) => updatePrize(idx, { titleEn: e.target.value })}
                            placeholder={t('create.prizeTitleEn')}
                            dir="ltr"
                            className="bg-card focus-visible:ring-secondary"
                          />
                        </div>
                        <Input
                          value={p.value || ''}
                          onChange={(e) => updatePrize(idx, { value: e.target.value })}
                          placeholder={t('create.prizeValue')}
                          inputMode="numeric"
                          dir="ltr"
                          className="bg-card focus-visible:ring-secondary font-mono"
                        />
                      </div>
                    ))}
                    <Button type="button" variant="outline" onClick={addPrize} className="w-full border-dashed border-secondary/40 text-secondary hover:bg-secondary/10 hover:text-secondary">
                      <Plus className="w-4 h-4 me-2" />
                      {t('create.addPrize')}
                    </Button>
                  </>
                )}
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={saveSettings} disabled={update.isPending} data-testid="button-save-settings" className="bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-[0_0_15px_rgba(var(--secondary)/0.3)]">
                  {update.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('detail.save')}
                </Button>
              </div>

              <div className="divider-gold h-px w-full my-2 opacity-30" />

              <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div>
                  <p className="font-semibold text-destructive flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    {t('detail.dangerZone')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t('detail.deleteHint')}
                  </p>
                </div>
                <AlertDialog
                  open={deleteOpen}
                  onOpenChange={(open) => {
                    setDeleteOpen(open);
                    if (!open) setDeleteConfirmText('');
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      data-testid="button-delete-challenge"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 me-2" />
                      {t('detail.deleteChallenge')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border/50">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('detail.deleteConfirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('detail.deleteConfirmBody')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-4">
                      <ul className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        <li className="flex items-start gap-2">
                          <Users className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>
                            {t('detail.deleteImpactParticipants').replace(
                              '{count}',
                              formatNum(ch.participantCount, lang),
                            )}
                          </span>
                        </li>
                        <li className="flex items-start gap-2">
                          <Trophy className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>{t('detail.deleteImpactPoints')}</span>
                        </li>
                      </ul>
                      <div className="space-y-2">
                        <Label htmlFor="delete-confirm-input" className="text-sm text-muted-foreground">
                          {t('detail.deleteConfirmInstruction').replace('{name}', ch.name)}
                        </Label>
                        <Input
                          id="delete-confirm-input"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder={t('detail.deleteConfirmPlaceholder')}
                          autoComplete="off"
                          data-testid="input-delete-confirm"
                          className="border-destructive/40 focus-visible:ring-destructive/40"
                        />
                      </div>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="border-border/50 hover:bg-muted/50">{t('common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          doDelete();
                        }}
                        disabled={deleteChallenge.isPending || deleteConfirmText.trim() !== ch.name.trim()}
                        data-testid="button-confirm-delete"
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deleteChallenge.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                        {t('detail.deleteChallenge')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
