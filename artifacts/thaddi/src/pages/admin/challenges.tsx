import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import {
  useAdminListChallenges,
  useAdminUpdateChallenge,
  getAdminListChallengesQueryKey,
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
import { useToast } from '@/hooks/use-toast';
import { Search } from 'lucide-react';

const challengeStatuses = Object.values(AdminChallengeUpdateStatus);
const challengeVisibilities = Object.values(AdminChallengeUpdateVisibility);

function formatDate(value?: string | null, lang?: string) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium' });
  } catch {
    return value;
  }
}

export default function AdminChallengesPage() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
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
      <h1 className="text-2xl font-bold" data-testid="text-admin-challenges-title">{t('admin.challenges.title')}</h1>

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

      <Card>
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
