import React, { useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { localeOf, type Lang } from '../../lib/matchUtils';
import { useAdminListAuditLogs, useAdminListUsers } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 50;
const ANY = '__any__';
const ENTITY_TYPES = [
  'tournament',
  'stage',
  'match',
  'team',
  'user',
  'challenge',
  'subscription',
] as const;

function formatDate(value?: string | null, lang?: Lang) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(localeOf(lang ?? 'en', 'en-GB'), {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return value;
  }
}

// Convert a YYYY-MM-DD date input into an ISO timestamp at the start/end of
// that local day so range filters are inclusive of the whole day.
function toIso(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function AdminAuditPage() {
  const { t, lang } = useI18n();

  const [actorUserId, setActorUserId] = useState<string>(ANY);
  const [entityType, setEntityType] = useState<string>(ANY);
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);

  const { data: adminUsers } = useAdminListUsers({ role: 'admin', limit: 200 });

  const params = useMemo(
    () => ({
      actorUserId: actorUserId === ANY ? undefined : actorUserId,
      entityType: entityType === ANY ? undefined : entityType,
      action: action.trim() || undefined,
      from: toIso(from, false),
      to: toIso(to, true),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [actorUserId, entityType, action, from, to, page],
  );

  const { data: list, isLoading } = useAdminListAuditLogs(params);

  const total = list?.total ?? 0;
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, page * PAGE_SIZE + (list?.logs.length ?? 0));
  const hasNext = (page + 1) * PAGE_SIZE < total;

  const resetPage = () => setPage(0);

  const reset = () => {
    setActorUserId(ANY);
    setEntityType(ANY);
    setActionInput('');
    setAction('');
    setFrom('');
    setTo('');
    setPage(0);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-audit-title">{t('admin.audit.title')}</h1>

      <Card className="card-premium">
        <CardContent className="p-4">
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              setAction(actionInput.trim());
              resetPage();
            }}
          >
            <div className="space-y-1.5">
              <Label>{t('admin.audit.actor')}</Label>
              <Select
                value={actorUserId}
                onValueChange={(v) => {
                  setActorUserId(v);
                  resetPage();
                }}
              >
                <SelectTrigger data-testid="select-audit-actor"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('admin.audit.allActors')}</SelectItem>
                  {(adminUsers?.users ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName ?? u.username ?? u.email ?? u.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t('admin.audit.entity')}</Label>
              <Select
                value={entityType}
                onValueChange={(v) => {
                  setEntityType(v);
                  resetPage();
                }}
              >
                <SelectTrigger data-testid="select-audit-entity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('admin.audit.allEntities')}</SelectItem>
                  {ENTITY_TYPES.map((et) => (
                    <SelectItem key={et} value={et}>{t(`admin.audit.entity.${et}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t('admin.audit.action')}</Label>
              <Input
                placeholder={t('admin.audit.actionPlaceholder')}
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                data-testid="input-audit-action"
                dir="ltr"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('admin.audit.from')}</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetPage();
                }}
                data-testid="input-audit-from"
                dir="ltr"
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t('admin.audit.to')}</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetPage();
                }}
                data-testid="input-audit-to"
                dir="ltr"
              />
            </div>

            <div className="flex items-end gap-2">
              <Button type="submit" variant="outline" data-testid="button-audit-apply">
                {t('admin.audit.filters')}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} data-testid="button-audit-reset">
                {t('admin.audit.reset')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="card-premium">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.loading')}</div>
          ) : !list || list.logs.length === 0 ? (
            <div className="p-6 text-muted-foreground">{t('admin.common.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.audit.when')}</TableHead>
                  <TableHead>{t('admin.audit.actor')}</TableHead>
                  <TableHead>{t('admin.audit.action')}</TableHead>
                  <TableHead>{t('admin.audit.entity')}</TableHead>
                  <TableHead>{t('admin.audit.ip')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.logs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(log.createdAt, lang)}</TableCell>
                    <TableCell className="text-sm">{log.actorName ?? '—'}</TableCell>
                    <TableCell><Badge variant="secondary" className="font-mono text-xs">{log.action}</Badge></TableCell>
                    <TableCell className="text-sm">
                      {log.entityType ? (
                        <span>
                          {log.entityType}
                          {log.entityId && <span className="text-muted-foreground" dir="ltr"> #{log.entityId.slice(0, 8)}</span>}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">{log.ip ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground" data-testid="text-audit-showing">
            {t('admin.audit.showing')
              .replace('{from}', String(showingFrom))
              .replace('{to}', String(showingTo))
              .replace('{total}', String(total))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              data-testid="button-audit-prev"
            >
              {t('admin.audit.prev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              data-testid="button-audit-next"
            >
              {t('admin.audit.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
