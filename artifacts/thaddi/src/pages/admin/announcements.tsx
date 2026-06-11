import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { localeOf, type Lang } from '../../lib/matchUtils';
import {
  useAdminListAnnouncements,
  useAdminCreateAnnouncement,
  useAdminUpdateAnnouncement,
  getAdminListAnnouncementsQueryKey,
  type AdminAnnouncement,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Megaphone } from 'lucide-react';

function formatDate(value?: string | null, lang?: Lang) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(localeOf(lang ?? 'en', 'en-GB'), { dateStyle: 'medium' });
  } catch {
    return value;
  }
}

function AnnouncementForm() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useAdminCreateAnnouncement();
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const reset = () => {
    setTitleEn('');
    setTitleAr('');
    setBodyEn('');
    setBodyAr('');
    setExpiresAt('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleEn.trim() || !titleAr.trim()) {
      toast({ description: t('admin.announcements.titleRequired'), variant: 'destructive' });
      return;
    }
    create.mutate(
      {
        data: {
          titleEn: titleEn.trim(),
          titleAr: titleAr.trim(),
          bodyEn: bodyEn.trim() || null,
          bodyAr: bodyAr.trim() || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
      },
      {
        onSuccess: () => {
          toast({ description: t('admin.announcements.published') });
          reset();
          queryClient.invalidateQueries({ queryKey: getAdminListAnnouncementsQueryKey() });
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-secondary" />
          {t('admin.announcements.newTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ann-title-ar">{t('admin.announcements.titleAr')}</Label>
              <Input
                id="ann-title-ar"
                value={titleAr}
                onChange={(e) => setTitleAr(e.target.value)}
                dir="rtl"
                data-testid="input-announcement-title-ar"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-title-en">{t('admin.announcements.titleEn')}</Label>
              <Input
                id="ann-title-en"
                value={titleEn}
                onChange={(e) => setTitleEn(e.target.value)}
                dir="ltr"
                data-testid="input-announcement-title-en"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-body-ar">{t('admin.announcements.bodyAr')}</Label>
              <Textarea
                id="ann-body-ar"
                value={bodyAr}
                onChange={(e) => setBodyAr(e.target.value)}
                dir="rtl"
                rows={3}
                data-testid="input-announcement-body-ar"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ann-body-en">{t('admin.announcements.bodyEn')}</Label>
              <Textarea
                id="ann-body-en"
                value={bodyEn}
                onChange={(e) => setBodyEn(e.target.value)}
                dir="ltr"
                rows={3}
                data-testid="input-announcement-body-en"
              />
            </div>
          </div>
          <div className="space-y-1.5 max-w-xs">
            <Label htmlFor="ann-expires">{t('admin.announcements.expiresAt')}</Label>
            <Input
              id="ann-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              dir="ltr"
              data-testid="input-announcement-expires"
            />
            <p className="text-xs text-muted-foreground">{t('admin.announcements.expiresHint')}</p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending} data-testid="button-publish-announcement">
              {create.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('admin.announcements.publish')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function AdminAnnouncementsPage() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: list, isLoading } = useAdminListAnnouncements();
  const update = useAdminUpdateAnnouncement();

  const toggleActive = (a: AdminAnnouncement) => {
    update.mutate(
      { id: a.id, data: { isActive: !a.isActive } },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListAnnouncementsQueryKey() });
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-announcements-title">
        {t('admin.announcements.title')}
      </h1>

      <AnnouncementForm />

      <Card className="card-premium">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !list || list.announcements.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.announcements.titleAr')}</TableHead>
                  <TableHead>{t('admin.announcements.titleEn')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead>{t('admin.announcements.expiresAt')}</TableHead>
                  <TableHead>{t('admin.announcements.created')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.announcements.map((a) => (
                  <TableRow key={a.id} data-testid={`row-announcement-${a.id}`}>
                    <TableCell className="font-medium" dir="rtl">{a.titleAr}</TableCell>
                    <TableCell className="font-medium" dir="ltr">{a.titleEn}</TableCell>
                    <TableCell>
                      {a.isActive ? (
                        <Badge variant="outline">{t('admin.announcements.active')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('admin.announcements.inactive')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{a.expiresAt ? formatDate(a.expiresAt, lang) : '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(a.createdAt, lang)}</TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant={a.isActive ? 'outline' : 'default'}
                        size="sm"
                        onClick={() => toggleActive(a)}
                        disabled={update.isPending}
                        data-testid={`button-toggle-announcement-${a.id}`}
                      >
                        {a.isActive ? t('admin.announcements.deactivate') : t('admin.announcements.activate')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
