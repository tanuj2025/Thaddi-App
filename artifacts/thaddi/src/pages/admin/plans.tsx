import React, { useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { localeOf } from '../../lib/matchUtils';
import {
  useAdminListPlans,
  useAdminCreatePlan,
  useAdminUpdatePlan,
  useAdminDeletePlan,
  getAdminListPlansQueryKey,
  type Plan,
  type Entitlement,
  type DisplayFeature,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

// The enforced entitlement toggles the platform actually checks at runtime. Any
// other "feature" the admin wants to advertise lives in displayFeatures.
const ENFORCED_FEATURES = [
  { key: 'advanced_stats', label: 'admin.plans.feat.advancedStats' },
  { key: 'custom_prizes', label: 'admin.plans.feat.customPrizes' },
  { key: 'premium_features', label: 'admin.plans.feat.premiumFeatures' },
  { key: 'priority_support', label: 'admin.plans.feat.prioritySupport' },
] as const;

type FormState = {
  code: string;
  nameEn: string;
  nameAr: string;
  priceSar: string;
  participantLimit: string;
  isActive: boolean;
  isComingSoon: boolean;
  orderIndex: string;
  features: Record<string, boolean>;
  displayFeatures: DisplayFeature[];
};

function emptyForm(): FormState {
  return {
    code: '',
    nameEn: '',
    nameAr: '',
    priceSar: '0',
    participantLimit: '',
    isActive: true,
    isComingSoon: false,
    orderIndex: '0',
    features: {},
    displayFeatures: [],
  };
}

function planToForm(plan: Plan): FormState {
  const features: Record<string, boolean> = {};
  for (const f of ENFORCED_FEATURES) {
    features[f.key] = plan.entitlements.some((e) => e.key === f.key && e.value === 'true');
  }
  return {
    code: plan.code,
    nameEn: plan.nameEn,
    nameAr: plan.nameAr,
    priceSar: plan.priceSar,
    participantLimit: plan.participantLimit != null ? String(plan.participantLimit) : '',
    isActive: plan.isActive,
    isComingSoon: plan.isComingSoon,
    orderIndex: String(plan.orderIndex),
    features,
    displayFeatures: plan.displayFeatures.map((d) => ({ en: d.en, ar: d.ar })),
  };
}

function buildEntitlements(form: FormState): Entitlement[] {
  return ENFORCED_FEATURES.filter((f) => form.features[f.key]).map((f) => ({
    key: f.key,
    value: 'true',
  }));
}

export default function AdminPlansPage() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: list, isLoading } = useAdminListPlans();
  const create = useAdminCreatePlan();
  const update = useAdminUpdatePlan();
  const remove = useAdminDeletePlan();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deleting, setDeleting] = useState<Plan | null>(null);

  const sorted = useMemo(
    () => (list?.plans ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [list],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getAdminListPlansQueryKey() });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setForm(planToForm(plan));
    setDialogOpen(true);
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleFeature = (key: string, value: boolean) =>
    setForm((prev) => ({ ...prev, features: { ...prev.features, [key]: value } }));

  const updateDisplayFeature = (index: number, field: 'en' | 'ar', value: string) =>
    setForm((prev) => ({
      ...prev,
      displayFeatures: prev.displayFeatures.map((d, i) =>
        i === index ? { ...d, [field]: value } : d,
      ),
    }));

  const addDisplayFeature = () =>
    setForm((prev) => ({ ...prev, displayFeatures: [...prev.displayFeatures, { en: '', ar: '' }] }));

  const removeDisplayFeature = (index: number) =>
    setForm((prev) => ({
      ...prev,
      displayFeatures: prev.displayFeatures.filter((_, i) => i !== index),
    }));

  const onSave = () => {
    const participantLimit =
      form.participantLimit.trim() === '' ? null : Number(form.participantLimit);
    if (participantLimit != null && (!Number.isFinite(participantLimit) || participantLimit < 0)) {
      toast({ description: t('admin.plans.invalidLimit'), variant: 'destructive' });
      return;
    }
    const displayFeatures = form.displayFeatures
      .map((d) => ({ en: d.en.trim(), ar: d.ar.trim() }))
      .filter((d) => d.en !== '' || d.ar !== '');
    const entitlements = buildEntitlements(form);
    const orderIndex = Number(form.orderIndex) || 0;

    if (editing) {
      update.mutate(
        {
          id: editing.id,
          data: {
            nameEn: form.nameEn,
            nameAr: form.nameAr,
            priceSar: form.priceSar,
            participantLimit,
            isActive: form.isActive,
            isComingSoon: form.isComingSoon,
            orderIndex,
            entitlements,
            displayFeatures,
          },
        },
        {
          onSuccess: () => {
            toast({ description: t('admin.common.saved') });
            setDialogOpen(false);
            invalidate();
          },
          onError: (err: any) =>
            toast({ description: err?.data?.error ?? t('admin.common.error'), variant: 'destructive' }),
        },
      );
      return;
    }

    if (!form.code.trim() || !form.nameEn.trim() || !form.nameAr.trim()) {
      toast({ description: t('admin.plans.missingFields'), variant: 'destructive' });
      return;
    }

    create.mutate(
      {
        data: {
          code: form.code.trim().toLowerCase(),
          nameEn: form.nameEn,
          nameAr: form.nameAr,
          priceSar: form.priceSar,
          participantLimit,
          isActive: form.isActive,
          isComingSoon: form.isComingSoon,
          orderIndex,
          entitlements,
          displayFeatures,
        },
      },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          setDialogOpen(false);
          invalidate();
        },
        onError: (err: any) =>
          toast({ description: err?.data?.error ?? t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  const onDelete = () => {
    if (!deleting) return;
    remove.mutate(
      { id: deleting.id },
      {
        onSuccess: () => {
          toast({ description: t('admin.plans.deleted') });
          setDeleting(null);
          invalidate();
        },
        onError: (err: any) => {
          toast({ description: err?.data?.error ?? t('admin.common.error'), variant: 'destructive' });
          setDeleting(null);
        },
      },
    );
  };

  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-plans-title">
          {t('admin.plans.title')}
        </h1>
        <Button onClick={openCreate} data-testid="button-new-plan">
          <Plus className="w-4 h-4 me-2" />
          {t('admin.plans.new')}
        </Button>
      </div>

      <Card className="card-premium">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : sorted.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.plans.name')}</TableHead>
                  <TableHead>{t('admin.plans.code')}</TableHead>
                  <TableHead>{t('admin.plans.price')}</TableHead>
                  <TableHead>{t('admin.plans.limit')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((plan) => (
                  <TableRow key={plan.id} data-testid={`row-plan-${plan.code}`}>
                    <TableCell className="font-medium">{lang === 'ar' ? plan.nameAr : plan.nameEn}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">{plan.code}</TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {Number(plan.priceSar).toLocaleString(localeOf(lang))}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {plan.participantLimit != null ? plan.participantLimit : t('admin.plans.unlimited')}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {plan.isActive ? (
                          <Badge>{t('admin.plans.active')}</Badge>
                        ) : (
                          <Badge variant="secondary">{t('admin.plans.inactive')}</Badge>
                        )}
                        {plan.isComingSoon && (
                          <Badge variant="outline">{t('admin.plans.comingSoon')}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(plan)}
                          data-testid={`button-edit-plan-${plan.code}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleting(plan)}
                          disabled={plan.code === 'free'}
                          data-testid={`button-delete-plan-${plan.code}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('admin.plans.edit') : t('admin.plans.new')}</DialogTitle>
            <DialogDescription>{t('admin.plans.dialogHint')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="plan-code">{t('admin.plans.code')}</Label>
                <Input
                  id="plan-code"
                  dir="ltr"
                  value={form.code}
                  onChange={(e) => setField('code', e.target.value)}
                  placeholder={t('admin.plans.codePlaceholder')}
                  data-testid="input-plan-code"
                />
                <p className="text-xs text-muted-foreground">{t('admin.plans.codeHint')}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-name-ar">{t('admin.plans.nameAr')}</Label>
                <Input
                  id="plan-name-ar"
                  value={form.nameAr}
                  onChange={(e) => setField('nameAr', e.target.value)}
                  data-testid="input-plan-name-ar"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-name-en">{t('admin.plans.nameEn')}</Label>
                <Input
                  id="plan-name-en"
                  dir="ltr"
                  value={form.nameEn}
                  onChange={(e) => setField('nameEn', e.target.value)}
                  data-testid="input-plan-name-en"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-price">{t('admin.plans.price')}</Label>
                <Input
                  id="plan-price"
                  dir="ltr"
                  inputMode="decimal"
                  value={form.priceSar}
                  onChange={(e) => setField('priceSar', e.target.value)}
                  data-testid="input-plan-price"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-limit">{t('admin.plans.limit')}</Label>
                <Input
                  id="plan-limit"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.participantLimit}
                  onChange={(e) => setField('participantLimit', e.target.value)}
                  placeholder={t('admin.plans.unlimited')}
                  data-testid="input-plan-limit"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-order">{t('admin.plans.order')}</Label>
                <Input
                  id="plan-order"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.orderIndex}
                  onChange={(e) => setField('orderIndex', e.target.value)}
                  data-testid="input-plan-order"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label>{t('admin.plans.active')}</Label>
                <p className="text-xs text-muted-foreground">{t('admin.plans.activeHint')}</p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setField('isActive', v)}
                data-testid="switch-plan-active"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label>{t('admin.plans.comingSoon')}</Label>
                <p className="text-xs text-muted-foreground">{t('admin.plans.comingSoonHint')}</p>
              </div>
              <Switch
                checked={form.isComingSoon}
                onCheckedChange={(v) => setField('isComingSoon', v)}
                data-testid="switch-plan-coming-soon"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>{t('admin.plans.enforcedFeatures')}</Label>
              <p className="text-xs text-muted-foreground">{t('admin.plans.enforcedHint')}</p>
              <div className="space-y-2 pt-1">
                {ENFORCED_FEATURES.map((f) => (
                  <div key={f.key} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <span className="text-sm">{t(f.label)}</span>
                    <Switch
                      checked={!!form.features[f.key]}
                      onCheckedChange={(v) => toggleFeature(f.key, v)}
                      data-testid={`switch-feature-${f.key}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('admin.plans.displayFeatures')}</Label>
                <Button variant="outline" size="sm" onClick={addDisplayFeature} data-testid="button-add-display-feature">
                  <Plus className="w-4 h-4 me-1" />
                  {t('admin.plans.addFeature')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('admin.plans.displayHint')}</p>
              <div className="space-y-3 pt-1">
                {form.displayFeatures.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-3">
                    <div className="grid flex-1 grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input
                        value={d.ar}
                        onChange={(e) => updateDisplayFeature(i, 'ar', e.target.value)}
                        placeholder={t('admin.plans.featureAr')}
                        data-testid={`input-display-ar-${i}`}
                      />
                      <Input
                        dir="ltr"
                        value={d.en}
                        onChange={(e) => updateDisplayFeature(i, 'en', e.target.value)}
                        placeholder={t('admin.plans.featureEn')}
                        data-testid={`input-display-en-${i}`}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive shrink-0"
                      onClick={() => removeDisplayFeature(i)}
                      data-testid={`button-remove-display-${i}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-plan">
              {t('admin.common.cancel')}
            </Button>
            <Button onClick={onSave} disabled={saving} data-testid="button-save-plan">
              {t('admin.common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.plans.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.plans.deleteConfirm').replace(
                '{name}',
                deleting ? (lang === 'ar' ? deleting.nameAr : deleting.nameEn) : '',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-plan">{t('admin.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-plan"
            >
              {t('admin.plans.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
