import React, { useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import {
  useAdminListChallengeBadges,
  useAdminCreateChallengeBadge,
  useAdminUpdateChallengeBadge,
  useAdminDeleteChallengeBadge,
  getAdminListChallengeBadgesQueryKey,
  type AdminChallengeBadge,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { Plus, Pencil, Trash2 } from 'lucide-react';

const ICON_BASE = import.meta.env.BASE_URL;

type FormState = {
  code: string;
  nameEn: string;
  nameAr: string;
  iconUrl: string;
  priceSar: string;
  isActive: boolean;
  orderIndex: string;
};

function emptyForm(): FormState {
  return {
    code: '',
    nameEn: '',
    nameAr: '',
    iconUrl: '',
    priceSar: '10',
    isActive: true,
    orderIndex: '0',
  };
}

function badgeToForm(badge: AdminChallengeBadge): FormState {
  return {
    code: badge.code,
    nameEn: badge.nameEn,
    nameAr: badge.nameAr,
    iconUrl: badge.iconUrl,
    priceSar: badge.priceSar,
    isActive: badge.isActive,
    orderIndex: String(badge.orderIndex),
  };
}

export default function AdminBadgesPage() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: list, isLoading } = useAdminListChallengeBadges();
  const create = useAdminCreateChallengeBadge();
  const update = useAdminUpdateChallengeBadge();
  const remove = useAdminDeleteChallengeBadge();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminChallengeBadge | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deleting, setDeleting] = useState<AdminChallengeBadge | null>(null);

  const sorted = useMemo(
    () => (list?.badges ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex),
    [list],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getAdminListChallengeBadgesQueryKey() });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (badge: AdminChallengeBadge) => {
    setEditing(badge);
    setForm(badgeToForm(badge));
    setDialogOpen(true);
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSave = () => {
    const orderIndex = Number(form.orderIndex) || 0;

    if (editing) {
      update.mutate(
        {
          id: editing.id,
          data: {
            nameEn: form.nameEn,
            nameAr: form.nameAr,
            iconUrl: form.iconUrl.trim(),
            priceSar: form.priceSar,
            isActive: form.isActive,
            orderIndex,
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

    if (!form.code.trim() || !form.nameEn.trim() || !form.nameAr.trim() || !form.iconUrl.trim()) {
      toast({ description: t('admin.badges.missingFields'), variant: 'destructive' });
      return;
    }

    create.mutate(
      {
        data: {
          code: form.code.trim().toLowerCase(),
          nameEn: form.nameEn,
          nameAr: form.nameAr,
          iconUrl: form.iconUrl.trim(),
          priceSar: form.priceSar,
          isActive: form.isActive,
          orderIndex,
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
          toast({ description: t('admin.badges.deleted') });
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
        <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-badges-title">
          {t('admin.badges.title')}
        </h1>
        <Button onClick={openCreate} data-testid="button-new-badge">
          <Plus className="w-4 h-4 me-2" />
          {t('admin.badges.new')}
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
                  <TableHead>{t('admin.badges.icon')}</TableHead>
                  <TableHead>{t('admin.badges.nameEn')}</TableHead>
                  <TableHead>{t('admin.badges.code')}</TableHead>
                  <TableHead>{t('admin.badges.price')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((badge) => (
                  <TableRow key={badge.id} data-testid={`row-badge-${badge.code}`}>
                    <TableCell>
                      <img
                        src={`${ICON_BASE}${badge.iconUrl}`}
                        alt={lang === 'ar' ? badge.nameAr : badge.nameEn}
                        className="w-10 h-10 object-contain"
                      />
                    </TableCell>
                    <TableCell className="font-medium">{lang === 'ar' ? badge.nameAr : badge.nameEn}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">{badge.code}</TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {Number(badge.priceSar).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}
                    </TableCell>
                    <TableCell>
                      {badge.isActive ? (
                        <Badge>{t('admin.badges.active')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('admin.badges.inactive')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(badge)}
                          data-testid={`button-edit-badge-${badge.code}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleting(badge)}
                          data-testid={`button-delete-badge-${badge.code}`}
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
            <DialogTitle>{editing ? t('admin.badges.edit') : t('admin.badges.new')}</DialogTitle>
            <DialogDescription>{t('admin.badges.dialogHint')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="badge-code">{t('admin.badges.code')}</Label>
                <Input
                  id="badge-code"
                  dir="ltr"
                  value={form.code}
                  onChange={(e) => setField('code', e.target.value)}
                  placeholder={t('admin.badges.codePlaceholder')}
                  data-testid="input-badge-code"
                />
                <p className="text-xs text-muted-foreground">{t('admin.badges.codeHint')}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="badge-name-ar">{t('admin.badges.nameAr')}</Label>
                <Input
                  id="badge-name-ar"
                  value={form.nameAr}
                  onChange={(e) => setField('nameAr', e.target.value)}
                  data-testid="input-badge-name-ar"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="badge-name-en">{t('admin.badges.nameEn')}</Label>
                <Input
                  id="badge-name-en"
                  dir="ltr"
                  value={form.nameEn}
                  onChange={(e) => setField('nameEn', e.target.value)}
                  data-testid="input-badge-name-en"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="badge-icon">{t('admin.badges.iconUrl')}</Label>
              <div className="flex items-center gap-3">
                {form.iconUrl.trim() && (
                  <img
                    src={`${ICON_BASE}${form.iconUrl.trim()}`}
                    alt=""
                    className="w-12 h-12 object-contain shrink-0"
                  />
                )}
                <Input
                  id="badge-icon"
                  dir="ltr"
                  value={form.iconUrl}
                  onChange={(e) => setField('iconUrl', e.target.value)}
                  placeholder={t('admin.badges.iconPlaceholder')}
                  data-testid="input-badge-icon"
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('admin.badges.iconHint')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="badge-price">{t('admin.badges.price')}</Label>
                <Input
                  id="badge-price"
                  dir="ltr"
                  inputMode="decimal"
                  value={form.priceSar}
                  onChange={(e) => setField('priceSar', e.target.value)}
                  data-testid="input-badge-price"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="badge-order">{t('admin.badges.order')}</Label>
                <Input
                  id="badge-order"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.orderIndex}
                  onChange={(e) => setField('orderIndex', e.target.value)}
                  data-testid="input-badge-order"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label>{t('admin.badges.active')}</Label>
                <p className="text-xs text-muted-foreground">{t('admin.badges.activeHint')}</p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(v) => setField('isActive', v)}
                data-testid="switch-badge-active"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-badge">
              {t('admin.common.cancel')}
            </Button>
            <Button onClick={onSave} disabled={saving} data-testid="button-save-badge">
              {t('admin.common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.badges.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.badges.deleteConfirm').replace(
                '{name}',
                deleting ? (lang === 'ar' ? deleting.nameAr : deleting.nameEn) : '',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-badge">{t('admin.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-badge"
            >
              {t('admin.badges.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
