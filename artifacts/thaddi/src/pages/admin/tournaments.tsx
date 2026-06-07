import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import {
  useAdminListTournaments,
  useAdminCreateTournament,
  useAdminUpdateTournament,
  useAdminListStages,
  useAdminCreateStage,
  getAdminListTournamentsQueryKey,
  getAdminListStagesQueryKey,
  type AdminTournament,
} from '@workspace/api-client-react';
import {
  AdminTournamentCreateType,
  AdminTournamentCreateStatus,
  AdminStageCreateType,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Layers, Loader2 } from 'lucide-react';

const tournamentTypes = Object.values(AdminTournamentCreateType);
const tournamentStatuses = Object.values(AdminTournamentCreateStatus);
const stageTypes = Object.values(AdminStageCreateType);

function CreateTournamentDialog() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [type, setType] = useState<string>('world_cup');
  const [season, setSeason] = useState('');
  const [status, setStatus] = useState<string>('upcoming');

  const create = useAdminCreateTournament();

  const reset = () => {
    setSlug('');
    setNameEn('');
    setNameAr('');
    setType('world_cup');
    setSeason('');
    setStatus('upcoming');
  };

  const onSubmit = () => {
    create.mutate(
      {
        data: {
          slug,
          nameEn,
          nameAr,
          type: type as (typeof AdminTournamentCreateType)[keyof typeof AdminTournamentCreateType],
          season: season || undefined,
          status: status as (typeof AdminTournamentCreateStatus)[keyof typeof AdminTournamentCreateStatus],
        },
      },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListTournamentsQueryKey() });
          setOpen(false);
          reset();
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  const canSubmit = slug.trim() && nameEn.trim() && nameAr.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-new-tournament">
          <Plus className="w-4 h-4 me-2" />
          {t('admin.tournaments.new')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.tournaments.new')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('admin.tournaments.slug')}</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} dir="ltr" data-testid="input-tournament-slug" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('admin.tournaments.nameEn')}</Label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" data-testid="input-tournament-name-en" />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.tournaments.nameAr')}</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" data-testid="input-tournament-name-ar" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('admin.tournaments.type')}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-tournament-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {tournamentTypes.map((tp) => (
                    <SelectItem key={tp} value={tp}>{tp}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('admin.tournaments.status')}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-tournament-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {tournamentStatuses.map((st) => (
                    <SelectItem key={st} value={st}>{st}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('admin.tournaments.season')} <span className="text-muted-foreground text-xs">({t('admin.common.optional')})</span></Label>
            <Input value={season} onChange={(e) => setSeason(e.target.value)} dir="ltr" data-testid="input-tournament-season" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-tournament">{t('admin.common.cancel')}</Button>
          <Button onClick={onSubmit} disabled={!canSubmit || create.isPending} data-testid="button-save-tournament">
            {create.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t('admin.common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StagesDialog({ tournament }: { tournament: AdminTournament }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: stages, isLoading } = useAdminListStages(tournament.id, {
    query: { enabled: open, queryKey: getAdminListStagesQueryKey(tournament.id) },
  });

  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [type, setType] = useState<string>('group');

  const create = useAdminCreateStage();

  const onAdd = () => {
    create.mutate(
      {
        id: tournament.id,
        data: {
          nameEn,
          nameAr,
          type: type as (typeof AdminStageCreateType)[keyof typeof AdminStageCreateType],
        },
      },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListStagesQueryKey(tournament.id) });
          queryClient.invalidateQueries({ queryKey: getAdminListTournamentsQueryKey() });
          setNameEn('');
          setNameAr('');
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`button-stages-${tournament.id}`}>
          <Layers className="w-4 h-4 me-2" />
          {t('admin.tournaments.manageStages')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.tournaments.stages')} — {tournament.nameEn}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-muted-foreground text-sm">{t('admin.common.loading')}</div>
          ) : stages && stages.length > 0 ? (
            <div className="space-y-1">
              {stages.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm" data-testid={`stage-${s.id}`}>
                  <span className="font-medium">{s.nameEn} <span className="text-muted-foreground">/ {s.nameAr}</span></span>
                  <Badge variant="secondary">{s.type}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">{t('admin.tournaments.noStages')}</div>
          )}

          <div className="border-t border-border pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder={t('admin.tournaments.nameEn')} value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" data-testid="input-stage-name-en" />
              <Input placeholder={t('admin.tournaments.nameAr')} value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" data-testid="input-stage-name-ar" />
            </div>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-stage-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {stageTypes.map((st) => (
                  <SelectItem key={st} value={st}>{st}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={onAdd} disabled={!nameEn.trim() || !nameAr.trim() || create.isPending} className="w-full" data-testid="button-add-stage">
              {create.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {t('admin.tournaments.addStage')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminTournamentsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: tournaments, isLoading } = useAdminListTournaments();
  const update = useAdminUpdateTournament();

  const toggleActive = (tournament: AdminTournament) => {
    update.mutate(
      { id: tournament.id, data: { isActive: !tournament.isActive } },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListTournamentsQueryKey() });
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold" data-testid="text-admin-tournaments-title">{t('admin.tournaments.title')}</h1>
        <CreateTournamentDialog />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !tournaments || tournaments.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.tournaments.nameEn')}</TableHead>
                  <TableHead>{t('admin.tournaments.type')}</TableHead>
                  <TableHead>{t('admin.tournaments.status')}</TableHead>
                  <TableHead>{t('admin.tournaments.stages')}</TableHead>
                  <TableHead>{t('admin.tournaments.matches')}</TableHead>
                  <TableHead>{t('admin.tournaments.active')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tournaments.map((tr) => (
                  <TableRow key={tr.id} data-testid={`row-tournament-${tr.id}`}>
                    <TableCell className="font-medium">
                      {tr.nameEn}
                      <div className="text-xs text-muted-foreground" dir="rtl">{tr.nameAr}</div>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{tr.type}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{tr.status}</Badge></TableCell>
                    <TableCell className="tabular-nums">{tr.stageCount}</TableCell>
                    <TableCell className="tabular-nums">{tr.matchCount}</TableCell>
                    <TableCell>
                      {tr.isActive ? <Badge>{t('admin.tournaments.active')}</Badge> : <Badge variant="secondary">—</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(tr)}
                          disabled={update.isPending}
                          data-testid={`button-toggle-active-${tr.id}`}
                        >
                          {tr.isActive ? '✓' : '○'}
                        </Button>
                        <StagesDialog tournament={tr} />
                      </div>
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
