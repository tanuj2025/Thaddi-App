import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { formatNum } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetChallengeTemplates,
  useGetMySubscription,
  useCreateChallenge,
  getGetMyChallengesQueryKey,
  CreateChallengeType,
  CreateChallengeVisibility,
  CreateChallengeScope,
  CreateChallengePredictionVisibility,
  CreateChallengeEndCondition,
} from '@workspace/api-client-react';
import type {
  ChallengePrizeInput,
  CreateChallengeType as TChallengeType,
  CreateChallengeVisibility as TVisibility,
  CreateChallengeScope as TScope,
  CreateChallengePredictionVisibility as TPredVis,
  CreateChallengeEndCondition as TEndCondition,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Trash2, Trophy, Lock, Check, Copy, MessageCircle } from 'lucide-react';

export default function ChallengeNewPage() {
  const { t, lang } = useI18n();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates } = useGetChallengeTemplates();
  const { data: sub } = useGetMySubscription();
  const create = useCreateChallenge();

  const canCustomPrizes =
    sub?.entitlements?.find((e) => e.key === 'custom_prizes')?.value === 'true';

  const [createdChallenge, setCreatedChallenge] = useState<{ id: string; inviteCode: string } | null>(null);

  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TChallengeType>(CreateChallengeType.friends);
  const [visibility, setVisibility] = useState<TVisibility>(CreateChallengeVisibility.private);
  const [scope, setScope] = useState<TScope>(CreateChallengeScope.entire_tournament);
  const [endCondition, setEndCondition] = useState<TEndCondition>(
    CreateChallengeEndCondition.tournament_ends,
  );
  const [endDate, setEndDate] = useState('');
  const [predictionVisibility, setPredictionVisibility] = useState<TPredVis>(
    CreateChallengePredictionVisibility.reveal_after_kickoff,
  );
  const [prizes, setPrizes] = useState<ChallengePrizeInput[]>([]);

  const selectTemplate = (id: string | undefined, tplScope?: TScope) => {
    setTemplateId(id);
    if (tplScope) setScope(tplScope);
  };

  const addPrize = () =>
    setPrizes((p) => [...p, { place: p.length + 1, titleAr: '', titleEn: '', value: '' }]);
  const removePrize = (idx: number) =>
    setPrizes((p) => p.filter((_, i) => i !== idx).map((pr, i) => ({ ...pr, place: i + 1 })));
  const updatePrize = (idx: number, patch: Partial<ChallengePrizeInput>) =>
    setPrizes((p) => p.map((pr, i) => (i === idx ? { ...pr, ...patch } : pr)));

  const onSubmit = () => {
    if (name.trim().length < 2) {
      toast({ title: t('create.error'), description: t('create.name'), variant: 'destructive' });
      return;
    }
    const cleanPrizes =
      canCustomPrizes
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

    create.mutate(
      {
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          type,
          visibility,
          scope,
          templateId,
          endCondition,
          endDate:
            endCondition === CreateChallengeEndCondition.specific_date && endDate
              ? new Date(endDate).toISOString()
              : undefined,
          predictionVisibility,
          prizes: cleanPrizes && cleanPrizes.length > 0 ? cleanPrizes : undefined,
        },
      },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          toast({ title: t('create.created') });
          setCreatedChallenge({ id: res.id, inviteCode: (res as { inviteCode?: string }).inviteCode ?? '' });
        },
        onError: (err) => {
          const poolFull = err.data?.code === 'owner_pool_full';
          toast({
            title: t('create.error'),
            description: poolFull ? t('create.poolFull') : err.data?.error,
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/challenges')}
            data-testid="button-back"
            className="hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-gold-gradient">{t('create.title')}</h1>
        </div>

        {/* Templates */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="text-lg">{t('create.chooseTemplate')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {(templates || []).map((tpl) => {
              const active = templateId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => selectTemplate(tpl.id, tpl.scope as TScope)}
                  className={`text-start rounded-xl border p-4 transition-all ${
                    active
                      ? 'border-secondary bg-secondary/5 ring-1 ring-secondary glow-gold'
                      : 'border-border/50 bg-card/50 hover:border-secondary/40 hover:bg-secondary/5'
                  }`}
                  data-testid={`template-${tpl.slug}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{lang === 'ar' ? tpl.nameAr : tpl.nameEn}</span>
                    {active && <Check className="w-4 h-4 text-secondary shrink-0" />}
                  </div>
                  <span className="text-xs text-muted-foreground">{t(`scope.${tpl.scope}`)}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => selectTemplate(undefined)}
              className={`text-start rounded-xl border p-4 transition-all ${
                templateId === undefined
                  ? 'border-secondary bg-secondary/5 ring-1 ring-secondary glow-gold'
                  : 'border-border/50 bg-card/50 hover:border-secondary/40 hover:bg-secondary/5'
              }`}
              data-testid="template-scratch"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{t('create.fromScratch')}</span>
                {templateId === undefined && <Check className="w-4 h-4 text-secondary shrink-0" />}
              </div>
            </button>
          </CardContent>
        </Card>

        {/* Details */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="text-lg text-secondary flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-secondary"></div>
              {t('create.details')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="ch-name">{t('create.name')}</Label>
              <Input
                id="ch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('create.namePlaceholder')}
                data-testid="input-challenge-name"
                className="bg-background/50 focus-visible:ring-secondary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ch-desc">
                {t('create.description')}{' '}
                <span className="text-muted-foreground font-normal">({t('common.optional')})</span>
              </Label>
              <Textarea
                id="ch-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('create.descriptionPlaceholder')}
                rows={3}
                data-testid="input-challenge-description"
                className="bg-background/50 focus-visible:ring-secondary"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('create.type')}</Label>
                <Select value={type} onValueChange={(v) => setType(v as TChallengeType)}>
                  <SelectTrigger data-testid="select-type" className="bg-background/50 focus:ring-secondary"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(CreateChallengeType).map((v) => (
                      <SelectItem key={v} value={v}>{t(`type.${v}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('create.scope')}</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as TScope)}>
                  <SelectTrigger data-testid="select-scope" className="bg-background/50 focus:ring-secondary"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(CreateChallengeScope).map((v) => (
                      <SelectItem key={v} value={v}>{t(`scope.${v}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {scope !== CreateChallengeScope.entire_tournament && (
              <p className="text-xs text-secondary/80 -mt-2 bg-secondary/10 p-2 rounded-md border border-secondary/20">{t('create.scopeHint')}</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('create.endCondition')}</Label>
                <Select
                  value={endCondition}
                  onValueChange={(v) => setEndCondition(v as TEndCondition)}
                >
                  <SelectTrigger data-testid="select-end-condition" className="bg-background/50 focus:ring-secondary"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(CreateChallengeEndCondition).map((v) => (
                      <SelectItem key={v} value={v}>{t(`ec.${v}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {endCondition === CreateChallengeEndCondition.specific_date && (
                <div className="space-y-2">
                  <Label htmlFor="ch-enddate">{t('create.endDate')}</Label>
                  <Input
                    id="ch-enddate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="input-end-date"
                    className="bg-background/50 focus-visible:ring-secondary"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('create.visibility')}</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as TVisibility)}>
                <SelectTrigger data-testid="select-visibility" className="bg-background/50 focus:ring-secondary"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(CreateChallengeVisibility).map((v) => (
                    <SelectItem key={v} value={v}>{t(`visibility.${v}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t(`visibility.${visibility}.desc`)}</p>
            </div>

            <div className="space-y-2">
              <Label>{t('create.predictionVisibility')}</Label>
              <Select
                value={predictionVisibility}
                onValueChange={(v) => setPredictionVisibility(v as TPredVis)}
              >
                <SelectTrigger data-testid="select-prediction-visibility" className="bg-background/50 focus:ring-secondary"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(CreateChallengePredictionVisibility).map((v) => (
                    <SelectItem key={v} value={v}>{t(`pv.${v}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sub?.participantLimit != null && (
              <p className="text-xs text-secondary/80 bg-secondary/10 p-2 rounded-md border border-secondary/20">
                {t('create.limitNote')}:{' '}
                <span className="font-semibold text-secondary" dir="ltr">
                  {formatNum(sub.participantsUsed, lang)}/{formatNum(sub.participantLimit, lang)}
                </span>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Prizes */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-secondary" />
              {t('create.prizes')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canCustomPrizes ? (
              <div className="flex items-start gap-3 rounded-xl border border-dashed border-border/50 bg-background/30 p-4 text-sm text-muted-foreground">
                <Lock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/60" />
                <span>{t('create.prizesLocked')}</span>
              </div>
            ) : (
              <>
                {prizes.map((p, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-border/50 bg-background/30 p-3 space-y-3"
                    data-testid={`prize-row-${idx}`}
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="bg-secondary/10 text-secondary border border-secondary/20">{t('create.place')} {p.place}</Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePrize(idx)}
                        data-testid={`button-remove-prize-${idx}`}
                        className="text-destructive/80 hover:text-destructive hover:bg-destructive/10"
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
                <Button type="button" variant="outline" onClick={addPrize} data-testid="button-add-prize" className="w-full border-dashed border-secondary/40 text-secondary hover:bg-secondary/10 hover:text-secondary">
                  <Plus className="w-4 h-4 me-2" />
                  {t('create.addPrize')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pb-4">
          <Button variant="ghost" onClick={() => setLocation('/challenges')} className="hover:bg-muted/50">
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={create.isPending} data-testid="button-submit-challenge" className="glow-green">
            {create.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t('create.submit')}
          </Button>
        </div>
      </div>

      {createdChallenge && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setLocation(`/challenges/${createdChallenge.id}?new=1`);
          }}
        >
          <DialogContent className="bg-card border-border/50 sm:max-w-md" data-testid="dialog-challenge-created">
            <DialogHeader>
              <DialogTitle className="text-xl font-black text-gold-gradient">{t('create.liveTitle')}</DialogTitle>
              <DialogDescription>{t('create.liveSubtitle')}</DialogDescription>
            </DialogHeader>
            {createdChallenge.inviteCode && (
              <code
                className="block w-full rounded-lg bg-background/50 border border-border/50 px-4 py-3 font-mono text-xl font-bold tracking-widest text-center text-secondary"
                dir="ltr"
                data-testid="text-created-invite-code"
              >
                {createdChallenge.inviteCode}
              </code>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="border-secondary/30 text-secondary hover:bg-secondary/10 hover:text-secondary"
                data-testid="button-copy-created-link"
                onClick={async () => {
                  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
                  const link = `${window.location.origin}${base}/join/${createdChallenge.inviteCode}`;
                  try {
                    await navigator.clipboard.writeText(link);
                    toast({ title: t('create.liveCopied') });
                  } catch {
                    toast({ title: link });
                  }
                }}
              >
                <Copy className="w-4 h-4 me-2" />
                {t('create.liveCopyLink')}
              </Button>
              <Button
                className="bg-[#25D366] hover:bg-[#1da851] text-white shadow-lg shadow-[#25D366]/20"
                data-testid="button-whatsapp-created"
                onClick={() => {
                  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
                  const link = `${window.location.origin}${base}/join/${createdChallenge.inviteCode}`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(t('detail.shareMessage') + ' ' + link)}`, '_blank');
                }}
              >
                <MessageCircle className="w-4 h-4 me-2" />
                {t('create.liveWhatsApp')}
              </Button>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setLocation(`/challenges/${createdChallenge.id}?new=1`)}
                className="w-full glow-green"
                data-testid="button-go-challenge"
              >
                {t('create.liveGoChallenge')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Layout>
  );
}
