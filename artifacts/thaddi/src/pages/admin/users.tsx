import React, { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import {
  useAdminListUsers,
  useAdminGetUser,
  useAdminUpdateUser,
  getAdminListUsersQueryKey,
  getAdminGetUserQueryKey,
  type AdminUser,
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Search, Loader2 } from 'lucide-react';

function formatDate(value?: string | null, lang?: string) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { dateStyle: 'medium' });
  } catch {
    return value;
  }
}

function roleBadge(role: string) {
  return role === 'admin' ? <Badge data-testid={`badge-role-${role}`}>{role}</Badge> : <Badge variant="secondary">{role}</Badge>;
}

function statusBadge(status: string) {
  if (status === 'active') return <Badge variant="outline">{status}</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}

function UserDetailDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useAdminGetUser(userId ?? '', {
    query: { enabled: !!userId, queryKey: getAdminGetUserQueryKey(userId ?? '') },
  });
  const update = useAdminUpdateUser();

  const mutate = (data: { role?: 'user' | 'admin'; status?: 'active' | 'suspended' | 'deleted' }) => {
    if (!userId) return;
    update.mutate(
      { id: userId, data },
      {
        onSuccess: () => {
          toast({ description: t('admin.common.saved') });
          queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getAdminGetUserQueryKey(userId) });
        },
        onError: () => toast({ description: t('admin.common.error'), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.users.detail')}</DialogTitle>
        </DialogHeader>
        {isLoading || !user ? (
          <div className="text-muted-foreground py-6">{t('admin.common.loading')}</div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-lg font-bold">{user.displayName ?? '—'}</div>
              {user.username && <div className="text-sm text-muted-foreground" dir="ltr">@{user.username}</div>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">{t('admin.users.email')}: </span><span dir="ltr">{user.email ?? '—'}</span></div>
              <div><span className="text-muted-foreground">{t('admin.users.mobile')}: </span><span dir="ltr">{user.mobileNumber ?? '—'}</span></div>
              <div><span className="text-muted-foreground">{t('admin.users.role')}: </span>{user.role}</div>
              <div><span className="text-muted-foreground">{t('admin.common.status')}: </span>{user.status}</div>
              <div><span className="text-muted-foreground">{t('admin.users.points')}: </span><span className="tabular-nums">{user.totalPoints}</span></div>
              <div><span className="text-muted-foreground">{t('admin.users.joined')}: </span>{formatDate(user.createdAt, lang)}</div>
              <div><span className="text-muted-foreground">{t('admin.users.challengesOwned')}: </span><span className="tabular-nums">{user.challengesOwned}</span></div>
              <div><span className="text-muted-foreground">{t('admin.users.challengesJoined')}: </span><span className="tabular-nums">{user.challengesJoined}</span></div>
              <div><span className="text-muted-foreground">{t('admin.users.predictions')}: </span><span className="tabular-nums">{user.predictionsCount}</span></div>
              <div>{user.mobileVerified ? <Badge variant="outline">{t('admin.users.verified')}</Badge> : <Badge variant="secondary">{t('admin.users.notVerified')}</Badge>}</div>
            </div>
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          {user && (
            <>
              {user.role === 'admin' ? (
                <Button variant="outline" onClick={() => mutate({ role: 'user' })} disabled={update.isPending} data-testid="button-remove-admin">
                  {t('admin.users.removeAdmin')}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => mutate({ role: 'admin' })} disabled={update.isPending} data-testid="button-make-admin">
                  {t('admin.users.makeAdmin')}
                </Button>
              )}
              {user.status === 'active' ? (
                <Button variant="destructive" onClick={() => mutate({ status: 'suspended' })} disabled={update.isPending} data-testid="button-suspend">
                  {update.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('admin.users.suspend')}
                </Button>
              ) : (
                <Button onClick={() => mutate({ status: 'active' })} disabled={update.isPending} data-testid="button-activate">
                  {update.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                  {t('admin.users.activate')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminUsersPage() {
  const { t, lang } = useI18n();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data: userList, isLoading } = useAdminListUsers({ q: query || undefined, limit: 100 });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-users-title">{t('admin.users.title')}</h1>

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
          data-testid="input-user-search"
        />
        <Button type="submit" variant="outline" data-testid="button-user-search">
          <Search className="w-4 h-4" />
        </Button>
      </form>

      <Card className="card-premium">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !userList || userList.users.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.challenges.name')}</TableHead>
                  <TableHead>{t('admin.users.role')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead>{t('admin.users.points')}</TableHead>
                  <TableHead>{t('admin.users.joined')}</TableHead>
                  <TableHead className="text-end">{t('admin.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userList.users.map((u: AdminUser) => (
                  <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                    <TableCell className="font-medium">
                      {u.displayName ?? '—'}
                      {u.username && <div className="text-xs text-muted-foreground" dir="ltr">@{u.username}</div>}
                    </TableCell>
                    <TableCell>{roleBadge(u.role)}</TableCell>
                    <TableCell>{statusBadge(u.status)}</TableCell>
                    <TableCell className="tabular-nums">{u.totalPoints}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(u.createdAt, lang)}</TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(u.id)} data-testid={`button-view-user-${u.id}`}>
                        {t('admin.common.edit')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UserDetailDialog userId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
