import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { localeOf, type Lang } from '../../lib/matchUtils';
import {
  useAdminListChallenges,
  useAdminUpdateChallenge,
  useAdminListChallengeMembers,
  getAdminListChallengesQueryKey,
  getAdminListChallengeMembersQueryKey,
  type AdminChallenge,
} from '@workspace/api-client-react';
import {
  AdminChallengeUpdateStatus,
  AdminChallengeUpdateVisibility,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Search, Users } from 'lucide-react';

const challengeStatuses = Object.values(AdminChallengeUpdateStatus);
const challengeVisibilities = Object.values(AdminChallengeUpdateVisibility);

function formatDate(value?: string | null, lang?: Lang) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(localeOf(lang ?? 'en', 'en-GB'), { dateStyle: 'medium' });
  } catch {
    return value;
  }
}

function roleBadge(role: string, label: string) {
  if (role === 'owner') return <Badge data-testid={`badge-member-${role}`}>{label}</Badge>;
  if (role === 'assistant') return <Badge variant="secondary">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

function MembersDialog({ challengeId, onClose }: { challengeId: string | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { data, isLoading } = useAdminListChallengeMembers(challengeId ?? '', {
    query: { enabled: !!challengeId, queryKey: getAdminListChallengeMembersQueryKey(challengeId ?? '') },
  });

  return (
    <Dialog open={!!challengeId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t('admin.challenges.membersTitle')}
            {data ? <span className="text-muted-foreground font-normal"> — {data.challengeName}</span> : null}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="text-muted-foreground py-6">{t('admin.common.loading')}</div>
        ) : data.members.length === 0 ? (
          <div className="text-muted-foreground py-6">{t('admin.common.empty')}</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.challenges.member')}</TableHead>
                  <TableHead>{t('admin.challenges.role')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead className="text-end">{t('admin.users.points')}</TableHead>
                  <TableHead>{t('admin.challenges.joined')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map((m) => (
                  <TableRow key={m.userId} data-testid={`row-member-${m.userId}`}>
                    <TableCell className="font-medium">
                      {m.displayName ?? '—'}
                      {m.username && <div className="text-xs text-muted-foreground" dir="ltr">@{m.username}</div>}
                    </TableCell>
                    <TableCell>{roleBadge(m.role, t(`admin.challenges.role.${m.role}`))}</TableCell>
                    <TableCell className="text-sm">{m.status}</TableCell>
                    <TableCell className="text-end tabular-nums">{m.points}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(m.joinedAt, lang)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminChallengesPage() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [membersOf, setMembersOf] = useState<string | null>(null);
  const { data: list, isLoading } = useAdminListChallenges({ q: query || undefined, limit: 100 });
  const update = useAdminUpdateChallenge();

  const onUpdate = (
    challenge: AdminChallenge,
    data: {
      status?: (typeof AdminChallengeUpdateStatus)[keyof typeof AdminChallengeUpdateStatus];
      visibility?: (typeof AdminChallengeUpdateVisibility)[keyof typeof AdminChallengeUpdateVisibility];
    },
  ) => {
    update.mutate(
      { id: challenge.id, data },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListChallengesQueryKey() });
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-challenges-title">{t('admin.challenges.title')}</h1>

      <form
        className="flex gap-2 max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
        }}
      >
        <Input
          placeholder={t('admin.common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-challenge-search"
        />
        <Button type="submit" variant="outline" data-testid="button-challenge-search">
          <Search className="w-4 h-4" />
        </Button>
      </form>

      <Card className="card-premium">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !list || list.challenges.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.challenges.name')}</TableHead>
                  <TableHead>{t('admin.challenges.owner')}</TableHead>
                  <TableHead>{t('admin.challenges.participants')}</TableHead>
                  <TableHead>{t('admin.challenges.created')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead>{t('admin.challenges.visibility')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.challenges.map((c) => (
                  <TableRow key={c.id} data-testid={`row-challenge-${c.id}`}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-sm">{c.ownerName ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">{c.participantCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(c.createdAt, lang)}</TableCell>
                    <TableCell>
                      <Select value={c.status} onValueChange={(v) => onUpdate(c, { status: v as (typeof AdminChallengeUpdateStatus)[keyof typeof AdminChallengeUpdateStatus] })}>
                        <SelectTrigger className="w-[130px]" data-testid={`select-challenge-status-${c.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {challengeStatuses.map((st) => (
                            <SelectItem key={st} value={st}>{st}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={c.visibility} onValueChange={(v) => onUpdate(c, { visibility: v as (typeof AdminChallengeUpdateVisibility)[keyof typeof AdminChallengeUpdateVisibility] })}>
                        <SelectTrigger className="w-[130px]" data-testid={`select-challenge-visibility-${c.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {challengeVisibilities.map((v) => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMembersOf(c.id)}
                        data-testid={`button-view-members-${c.id}`}
                      >
                        <Users className="w-4 h-4 me-1" />
                        {t('admin.challenges.viewMembers')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <MembersDialog challengeId={membersOf} onClose={() => setMembersOf(null)} />
    </div>
  );
}
