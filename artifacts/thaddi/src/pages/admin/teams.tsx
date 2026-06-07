import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import {
  useAdminListTeams,
  useAdminUpdateTeam,
  getAdminListTeamsQueryKey,
  type AdminTeam,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Pencil } from 'lucide-react';

function EditTeamDialog({ team, onClose }: { team: AdminTeam | null; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useAdminUpdateTeam();

  const [nameEn, setNameEn] = useState<string>(team?.nameEn ?? '');
  const [nameAr, setNameAr] = useState<string>(team?.nameAr ?? '');
  const [code, setCode] = useState<string>(team?.code ?? '');
  const [flagUrl, setFlagUrl] = useState<string>(team?.flagUrl ?? '');
  const [countryCode, setCountryCode] = useState<string>(team?.countryCode ?? '');

  React.useEffect(() => {
    if (team) {
      setNameEn(team.nameEn);
      setNameAr(team.nameAr);
      setCode(team.code ?? '');
      setFlagUrl(team.flagUrl ?? '');
      setCountryCode(team.countryCode ?? '');
    }
  }, [team]);

  if (!team) return null;

  const onSave = () => {
    update.mutate(
      {
        id: team.id,
        data: {
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          code: code.trim() || null,
          flagUrl: flagUrl.trim() || null,
          countryCode: countryCode.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListTeamsQueryKey() });
          onClose();
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{team.nameEn}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('admin.teams.nameEn')}</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" data-testid="input-team-name-en" />
          </div>
          <div className="space-y-2">
            <Label>{t('admin.teams.nameAr')}</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" data-testid="input-team-name-ar" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('admin.teams.code')}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" data-testid="input-team-code" />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.teams.countryCode')}</Label>
              <Input value={countryCode} onChange={(e) => setCountryCode(e.target.value)} dir="ltr" data-testid="input-team-country-code" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('admin.teams.flagUrl')}</Label>
            <Input value={flagUrl} onChange={(e) => setFlagUrl(e.target.value)} dir="ltr" data-testid="input-team-flag-url" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-team">{t('admin.common.cancel')}</Button>
          <Button onClick={onSave} disabled={update.isPending} data-testid="button-save-team">
            {update.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t('admin.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminTeamsPage() {
  const { t, lang } = useI18n();
  const { data: teams, isLoading } = useAdminListTeams();
  const [editing, setEditing] = useState<AdminTeam | null>(null);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold" data-testid="text-admin-teams-title">{t('admin.teams.title')}</h1>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !teams || teams.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.teams.name')}</TableHead>
                  <TableHead>{t('admin.teams.code')}</TableHead>
                  <TableHead>{t('admin.teams.countryCode')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((team) => (
                  <TableRow key={team.id} data-testid={`row-team-${team.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        {team.flagUrl && (
                          <img src={team.flagUrl} alt="" className="w-6 h-4 object-cover rounded-sm" />
                        )}
                        <span>{lang === 'ar' ? team.nameAr : team.nameEn}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">{team.code ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">{team.countryCode ?? '—'}</TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(team)} data-testid={`button-edit-team-${team.id}`}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EditTeamDialog team={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
