import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
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
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Trash2, Trophy, Lock, Check } from 'lucide-react';

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
          setLocation(`/challenges/${res.id}`);
        },
        onError: (err) => {
          toast({
            title: t('create.error'),
            description: err.data?.error,
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
          >
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{t('create.title')}</h1>
        </div>

        {/* Templates */}
        <Card className="border-border">
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
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary/40'
                  }`}
                  data-testid={`template-${tpl.slug}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{lang === 'ar' ? tpl.nameAr : tpl.nameEn}</span>
                    {active && <Check className="w-4 h-4 text-primary shrink-0" />}
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
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-primary/40'
              }`}
              data-testid="template-scratch"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{t('create.fromScratch')}</span>
                {templateId === undefined && <Check className="w-4 h-4 text-primary shrink-0" />}
              </div>
            </button>
          </CardContent>
        </Card>

        {/* Details */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg">{t('create.details')}</CardTitle>
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
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('create.type')}</Label>
                <Select value={type} onValueChange={(v) => setType(v as TChallengeType)}>
                  <SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger data-testid="select-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(CreateChallengeScope).map((v) => (
                      <SelectItem key={v} value={v}>{t(`scope.${v}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {scope !== CreateChallengeScope.entire_tournament && (
              <p className="text-xs text-muted-foreground -mt-2">{t('create.scopeHint')}</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('create.endCondition')}</Label>
                <Select
                  value={endCondition}
                  onValueChange={(v) => setEndCondition(v as TEndCondition)}
                >
                  <SelectTrigger data-testid="select-end-condition"><SelectValue /></SelectTrigger>
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
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('create.visibility')}</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as TVisibility)}>
                <SelectTrigger data-testid="select-visibility"><SelectValue /></SelectTrigger>
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
                <SelectTrigger data-testid="select-prediction-visibility"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(CreateChallengePredictionVisibility).map((v) => (
                    <SelectItem key={v} value={v}>{t(`pv.${v}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {sub?.participantLimit != null && (
              <p className="text-xs text-muted-foreground">
                {t('create.limitNote')}: <span className="font-semibold">{sub.participantLimit}</span>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Prizes */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              {t('create.prizes')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canCustomPrizes ? (
              <div className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{t('create.prizesLocked')}</span>
              </div>
            ) : (
              <>
                {prizes.map((p, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-border p-3 space-y-3"
                    data-testid={`prize-row-${idx}`}
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary">{t('create.place')} {p.place}</Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePrize(idx)}
                        data-testid={`button-remove-prize-${idx}`}
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
                <Button type="button" variant="outline" onClick={addPrize} data-testid="button-add-prize">
                  <Plus className="w-4 h-4 me-2" />
                  {t('create.addPrize')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pb-4">
          <Button variant="outline" onClick={() => setLocation('/challenges')}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={create.isPending} data-testid="button-submit-challenge">
            {create.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t('create.submit')}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
