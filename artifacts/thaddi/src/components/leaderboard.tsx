import React from 'react';
import { useI18n } from '../lib/i18n';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Crown, ChevronUp, ChevronDown, Minus } from 'lucide-react';
import { formatNum } from '../lib/matchUtils';
import type { RankingEntry } from '@workspace/api-client-react';

function Movement({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-xs font-medium tabular-nums">
        <ChevronUp className="w-3.5 h-3.5" />
        {delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="flex items-center gap-0.5 text-red-500 text-xs font-medium tabular-nums">
        <ChevronDown className="w-3.5 h-3.5" />
        {Math.abs(delta)}
      </span>
    );
  }
  return <Minus className="w-3.5 h-3.5 text-muted-foreground/50" />;
}

function rankBadge(rank: number): string {
  if (rank === 1) return 'bg-amber-400/20 text-amber-600 dark:text-amber-300 border-amber-400/40';
  if (rank === 2) return 'bg-slate-300/30 text-slate-600 dark:text-slate-300 border-slate-400/40';
  if (rank === 3) return 'bg-orange-400/20 text-orange-600 dark:text-orange-400 border-orange-400/40';
  return 'bg-muted text-muted-foreground border-border';
}

export function LeaderboardRow({ entry }: { entry: RankingEntry }) {
  const { t, lang } = useI18n();
  const accuracy =
    entry.accuracy != null
      ? `${formatNum(Math.round(entry.accuracy * 100), lang)}%`
      : '—';

  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
        entry.isCurrentUser
          ? 'bg-primary/10 ring-1 ring-primary/30'
          : 'hover:bg-accent/50'
      }`}
      data-testid={`leaderboard-row-${entry.userId}`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-bold tabular-nums ${rankBadge(
          entry.rank,
        )}`}
      >
        {entry.rank <= 3 ? <Crown className="w-4 h-4" /> : formatNum(entry.rank, lang)}
      </div>

      <Avatar className="w-9 h-9 shrink-0">
        <AvatarImage src={entry.avatarUrl || ''} />
        <AvatarFallback className="bg-primary/10 text-primary text-sm">
          {entry.displayName?.charAt(0) || 'U'}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate">{entry.displayName || '—'}</span>
          {entry.isCurrentUser && (
            <Badge variant="secondary" className="text-[10px] py-0">
              {t('rankings.you')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {t('rankings.accuracy')} {accuracy}
          </span>
          <span aria-hidden>·</span>
          <span dir="ltr">
            {formatNum(entry.exactPredictions, lang)} {t('rankings.exact')}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Movement delta={entry.rankMovement} />
        <span className="w-12 text-end text-lg font-extrabold tabular-nums text-primary">
          {formatNum(entry.points, lang)}
        </span>
      </div>
    </div>
  );
}

export function Leaderboard({
  entries,
  me,
  emptyText,
}: {
  entries: RankingEntry[];
  me?: RankingEntry | null;
  emptyText: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-10">{emptyText}</p>
    );
  }

  const meInList = me ? entries.some((e) => e.userId === me.userId) : true;

  return (
    <div className="space-y-1">
      {entries.map((e) => (
        <LeaderboardRow key={e.userId} entry={e} />
      ))}
      {me && !meInList && (
        <>
          <div className="my-1 text-center text-xs text-muted-foreground">···</div>
          <LeaderboardRow entry={me} />
        </>
      )}
    </div>
  );
}
