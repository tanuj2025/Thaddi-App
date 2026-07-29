import React from 'react';
import { useI18n } from '../lib/i18n';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Crown, ChevronUp, ChevronDown, Minus, Trophy } from 'lucide-react';
import { formatNum } from '../lib/matchUtils';
import type { RankingEntry } from '@workspace/api-client-react';
import { FavoriteTeamFlag } from './favorite-team-flag';
import { PlayerLink } from './social/player-link';

function Movement({ delta }: { delta: number }) {
  const { lang } = useI18n();
  if (delta > 0) {
    return (
      <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-xs font-medium tabular-nums">
        <ChevronUp className="w-3.5 h-3.5" />
        {formatNum(delta, lang)}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="flex items-center gap-0.5 text-red-500 text-xs font-medium tabular-nums">
        <ChevronDown className="w-3.5 h-3.5" />
        {formatNum(Math.abs(delta), lang)}
      </span>
    );
  }
  return <Minus className="w-3.5 h-3.5 text-muted-foreground/50" />;
}

function rankBadge(rank: number): string {
  if (rank === 1) return 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-white shadow-[0_0_15px_rgba(234,179,8,0.4)] border-none ring-1 ring-yellow-400/50';
  if (rank === 2) return 'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-[0_0_10px_rgba(148,163,184,0.3)] border-none';
  if (rank === 3) return 'bg-gradient-to-br from-orange-400 to-orange-700 text-white shadow-[0_0_10px_rgba(249,115,22,0.3)] border-none';
  return 'bg-muted/50 text-muted-foreground border-border/50';
}

export function LeaderboardRow({ entry }: { entry: RankingEntry }) {
  const { t, lang } = useI18n();
  const accuracy =
    entry.accuracy != null
      ? `${formatNum(Math.round(entry.accuracy * 100), lang)}%`
      : '—';
      
  const isFirst = entry.rank === 1;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-all border-b border-white/[0.05] last:border-0 press-scale ${
        entry.isCurrentUser
          ? 'bg-primary/8 ring-1 ring-primary/25 relative z-10'
          : isFirst
            ? 'bg-gradient-to-r from-secondary/8 to-transparent hover:bg-secondary/10'
            : 'hover:bg-white/[0.03]'
      }`}
      data-testid={`leaderboard-row-${entry.userId}`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black tabular-nums ${rankBadge(
          entry.rank,
        )}`}
      >
        {entry.rank <= 3 ? <Crown className="w-5 h-5 drop-shadow-sm" /> : formatNum(entry.rank, lang)}
      </div>

      <PlayerLink userId={entry.userId} className="relative shrink-0">
        <Avatar className={`w-11 h-11 ${isFirst ? 'ring-2 ring-secondary ring-offset-1 ring-offset-background' : 'ring-1 ring-border'}`}>
          <AvatarImage src={entry.avatarUrl || ''} />
          <AvatarFallback className="bg-muted text-foreground text-sm font-bold">
            {entry.displayName?.charAt(0) || 'U'}
          </AvatarFallback>
        </Avatar>
        {entry.favoriteTeam && (
          <span className="absolute -bottom-1 -end-1">
            <FavoriteTeamFlag team={entry.favoriteTeam} size="sm" className="ring-1 ring-background rounded-sm" />
          </span>
        )}
      </PlayerLink>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PlayerLink userId={entry.userId} className={`font-bold truncate hover:underline underline-offset-2 ${isFirst ? 'text-secondary text-base' : 'text-foreground'}`}>
            {entry.displayName || '—'}
          </PlayerLink>
          {entry.isCurrentUser && (
            <Badge variant="outline" className="text-[10px] py-0 border-primary/30 text-primary bg-primary/10">
              {t('rankings.you')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span className="font-medium">
            {t('rankings.accuracy')} <span dir="ltr">{accuracy}</span>
          </span>
          <span aria-hidden className="opacity-50">·</span>
          <span dir="ltr" className="font-medium">
            <span className="text-foreground">{formatNum(entry.exactPredictions, lang)}</span> {t('rankings.exact')}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <Movement delta={entry.rankMovement} />
        <span className={`w-16 text-end text-xl font-black tabular-nums ${isFirst ? 'text-secondary drop-shadow-sm' : 'text-primary'}`}>
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
      <div className="py-16 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mb-4 ring-1 ring-border/50">
          <Trophy className="w-8 h-8 text-muted-foreground/50" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">{emptyText}</p>
      </div>
    );
  }

  const meInList = me ? entries.some((e) => e.userId === me.userId) : true;

  return (
    <div className="flex flex-col">
      {entries.map((e) => (
        <LeaderboardRow key={e.userId} entry={e} />
      ))}
      {me && !meInList && (
        <>
          <div className="divider-gold h-px w-full my-2 opacity-50" />
          <LeaderboardRow entry={me} />
        </>
      )}
    </div>
  );
}
