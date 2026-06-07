import React from 'react';
import { useI18n } from '../../lib/i18n';
import { useAdminListAuditLogs } from '@workspace/api-client-react';
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

export default function AdminAuditPage() {
  const { t, lang } = useI18n();
  const { data: list, isLoading } = useAdminListAuditLogs({ limit: 100 });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gold-gradient" data-testid="text-admin-audit-title">{t('admin.audit.title')}</h1>

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
    </div>
  );
}
