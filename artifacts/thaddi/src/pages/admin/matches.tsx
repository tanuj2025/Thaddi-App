import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import {
  useAdminGetSyncStatus,
  useAdminListMatches,
  useAdminTriggerSync,
  useAdminUpdateMatch,
  getAdminGetSyncStatusQueryKey,
  getAdminListMatchesQueryKey,
  type AdminMatch,
} from '@workspace/api-client-react';
import { AdminMatchUpdateStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Loader2, Pencil } from 'lucide-react';

const matchStatuses = Object.values(AdminMatchUpdateStatus);

function formatDate(value?: string | null, lang?: string) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}

function EditMatchDialog({ match, onClose }: { match: AdminMatch | null; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useAdminUpdateMatch();

  const [status, setStatus] = useState<string>(match?.status ?? 'scheduled');
  const [homeScore, setHomeScore] = useState<string>(match?.homeScore?.toString() ?? '');
  const [awayScore, setAwayScore] = useState<string>(match?.awayScore?.toString() ?? '');
  const [venue, setVenue] = useState<string>(match?.venue ?? '');

  React.useEffect(() => {
    if (match) {
      setStatus(match.status);
      setHomeScore(match.homeScore?.toString() ?? '');
      setAwayScore(match.awayScore?.toString() ?? '');
      setVenue(match.venue ?? '');
    }
  }, [match]);

  if (!match) return null;

  const onSave = () => {
    update.mutate(
      {
        id: match.id,
        data: {
          status: status as (typeof AdminMatchUpdateStatus)[keyof typeof AdminMatchUpdateStatus],
          homeScore: homeScore === '' ? null : Number(homeScore),
          awayScore: awayScore === '' ? null : Number(awayScore),
          venue: venue || null,
        },
      },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListMatchesQueryKey() });
          onClose();
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={!!match} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {match.homeTeam?.nameEn ?? '?'} {t('match.vs')} {match.awayTeam?.nameEn ?? '?'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('admin.common.status')}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-match-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {matchStatuses.map((st) => (
                  <SelectItem key={st} value={st}>{st}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('admin.matches.home')}</Label>
              <Input type="number" min={0} value={homeScore} onChange={(e) => setHomeScore(e.target.value)} dir="ltr" data-testid="input-home-score" />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.matches.away')}</Label>
              <Input type="number" min={0} value={awayScore} onChange={(e) => setAwayScore(e.target.value)} dir="ltr" data-testid="input-away-score" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('admin.matches.venue')}</Label>
            <Input value={venue} onChange={(e) => setVenue(e.target.value)} data-testid="input-venue" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-match">{t('admin.common.cancel')}</Button>
          <Button onClick={onSave} disabled={update.isPending} data-testid="button-save-match">
            {update.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t('admin.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminMatchesPage() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: syncStatus } = useAdminGetSyncStatus();
  const { data: matchList, isLoading } = useAdminListMatches({ limit: 200 });
  const triggerSync = useAdminTriggerSync();
  const [editing, setEditing] = useState<AdminMatch | null>(null);

  const onSync = () => {
    triggerSync.mutate(undefined, {
      onSuccess: (res) => {
        toast({
          description: t('admin.matches.synced')
            .replace('{teams}', String(res.teamsUpserted))
            .replace('{matches}', String(res.matchesUpserted)),
        });
        queryClient.invalidateQueries({ queryKey: getAdminGetSyncStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminListMatchesQueryKey() });
      },
      onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-matches-title">{t('admin.matches.title')}</h1>

      <Card className="card-premium">
        <CardHeader>
          <CardTitle className="text-base">{t('admin.matches.sync')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('admin.matches.provider')}:</span>
            <Badge variant={syncStatus?.liveProviderConfigured ? 'default' : 'secondary'} data-testid="badge-sync-provider">
              {syncStatus?.provider ?? '—'}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            {t('admin.matches.lastUpdate')}: {formatDate(syncStatus?.lastMatchUpdatedAt, lang)}
          </div>
          <Button onClick={onSync} disabled={triggerSync.isPending} className="ms-auto" data-testid="button-sync-now">
            {triggerSync.isPending ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <RefreshCw className="w-4 h-4 me-2" />}
            {triggerSync.isPending ? t('admin.matches.syncing') : t('admin.matches.syncNow')}
          </Button>
        </CardContent>
      </Card>

      <Card className="card-premium">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !matchList || matchList.matches.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.matches.home')}</TableHead>
                  <TableHead>{t('admin.matches.score')}</TableHead>
                  <TableHead>{t('admin.matches.away')}</TableHead>
                  <TableHead>{t('admin.matches.kickoff')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchList.matches.map((m) => (
                  <TableRow key={m.id} data-testid={`row-match-${m.id}`}>
                    <TableCell className="font-medium">{m.homeTeam?.nameEn ?? '—'}</TableCell>
                    <TableCell className="tabular-nums text-center">
                      {m.homeScore ?? '-'} : {m.awayScore ?? '-'}
                    </TableCell>
                    <TableCell className="font-medium">{m.awayTeam?.nameEn ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(m.kickoffAt, lang)}</TableCell>
                    <TableCell><Badge variant="outline">{m.status}</Badge></TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(m)} data-testid={`button-edit-match-${m.id}`}>
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

      <EditMatchDialog match={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
