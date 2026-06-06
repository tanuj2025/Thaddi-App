import React, { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetChallenge,
  useGetChallengeParticipants,
  useGetMySubscription,
  useUpdateChallenge,
  useRegenerateInvite,
  useRemoveParticipant,
  getGetChallengeQueryKey,
  getGetChallengeParticipantsQueryKey,
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
  Loader2, Plus, Trash2, Settings, Lock,
} from 'lucide-react';

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

  const { data: ch, isLoading } = useGetChallenge(id);
  const { data: participants } = useGetChallengeParticipants(id);
  const { data: sub } = useGetMySubscription();
  const update = useUpdateChallenge();
  const regenerate = useRegenerateInvite();
  const removeParticipant = useRemoveParticipant();

  const canCustomPrizes =
    sub?.entitlements?.find((e) => e.key === 'custom_prizes')?.value === 'true';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<TVisibility>(UpdateChallengeVisibility.private);
  const [predictionVisibility, setPredictionVisibility] = useState<TPredVis>(
    UpdateChallengePredictionVisibility.reveal_after_kickoff,
  );
  const [prizes, setPrizes] = useState<ChallengePrizeInput[]>([]);

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
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Layout>
    );
  }

  if (!ch) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto text-center py-20 space-y-4">
          <p className="text-muted-foreground">{t('detail.notFound')}</p>
          <Button variant="outline" onClick={() => setLocation('/challenges')}>
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
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{ch.name}</h1>
              <Badge variant="secondary">{t(`type.${ch.type}`)}</Badge>
              <Badge variant="outline">{t(`visibility.${ch.visibility}`)}</Badge>
            </div>
            {ch.description && <p className="text-muted-foreground mt-1">{ch.description}</p>}
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                {ch.participantCount}{ch.participantLimit ? `/${ch.participantLimit}` : ''}{' '}
                {t('challenges.participants')}
              </span>
            </div>
          </div>
        </div>

        {/* Invite & Share (owner) */}
        {ch.isOwner && inviteCode && (
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg">{t('detail.invite')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('detail.inviteCode')}</Label>
                <div className="flex items-center gap-2">
                  <code
                    className="flex-1 rounded-lg bg-muted px-4 py-2.5 font-mono text-lg font-bold tracking-widest text-center"
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
                  >
                    {regenerate.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" className="flex-1" onClick={copyLink} data-testid="button-copy-link">
                  <Copy className="w-4 h-4 me-2" />
                  {t('detail.copyLink')}
                </Button>
                <Button
                  className="flex-1 bg-[#25D366] hover:bg-[#1da851] text-white"
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
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
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
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                  >
                    <span className="flex items-center gap-3">
                      <Badge variant="secondary">{t('detail.place')} {p.place}</Badge>
                      <span className="font-medium">
                        {(lang === 'ar' ? p.titleAr : p.titleEn) || p.titleEn || p.titleAr || '—'}
                      </span>
                    </span>
                    {p.value && (
                      <span className="text-amber-600 font-semibold">
                        {p.value} {p.currency || 'SAR'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Participants */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg">{t('detail.participants')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(participants || []).map((p) => (
              <div
                key={p.userId}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent/50"
                data-testid={`participant-${p.userId}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="w-9 h-9">
                    <AvatarImage src={p.avatarUrl || ''} />
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {p.displayName?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{p.displayName || '—'}</span>
                      {p.isOwner && (
                        <Badge variant="secondary" className="gap-1">
                          <Crown className="w-3 h-3" />
                          {t('detail.ownerBadge')}
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
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm text-muted-foreground">
                    {p.points} {t('detail.points')}
                  </span>
                  {ch.isOwner && !p.isOwner && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-remove-${p.userId}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('detail.remove')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {p.displayName}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
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

        {/* Owner settings */}
        {ch.isOwner && (
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
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
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('create.visibility')}</Label>
                  <Select value={visibility} onValueChange={(v) => setVisibility(v as TVisibility)}>
                    <SelectTrigger data-testid="select-edit-visibility"><SelectValue /></SelectTrigger>
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
                    <SelectTrigger data-testid="select-edit-prediction-visibility"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.values(UpdateChallengePredictionVisibility).map((v) => (
                        <SelectItem key={v} value={v}>{t(`pv.${v}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Prize editor */}
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500" />
                  {t('create.prizes')}
                </Label>
                {!canCustomPrizes ? (
                  <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{t('create.prizesLocked')}</span>
                  </div>
                ) : (
                  <>
                    {prizes.map((p, idx) => (
                      <div key={idx} className="rounded-xl border border-border p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary">{t('create.place')} {p.place}</Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removePrize(idx)}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            value={p.titleAr || ''}
                            onChange={(e) => updatePrize(idx, { titleAr: e.target.value })}
                            placeholder={t('create.prizeTitleAr')}
                            dir="rtl"
                          />
                          <Input
                            value={p.titleEn || ''}
                            onChange={(e) => updatePrize(idx, { titleEn: e.target.value })}
                            placeholder={t('create.prizeTitleEn')}
                            dir="ltr"
                          />
                        </div>
                        <Input
                          value={p.value || ''}
                          onChange={(e) => updatePrize(idx, { value: e.target.value })}
                          placeholder={t('create.prizeValue')}
                          inputMode="numeric"
                        />
                      </div>
                    ))}
                    <Button type="button" variant="outline" onClick={addPrize}>
                      <Plus className="w-4 h-4 me-2" />
                      {t('create.addPrize')}
                    </Button>
                  </>
                )}
              </div>

              <div className="flex justify-end">
                <Button onClick={saveSettings} disabled={update.isPending} data-testid="button-save-settings">
                  {update.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('detail.save')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
