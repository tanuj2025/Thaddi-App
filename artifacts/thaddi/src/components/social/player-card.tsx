import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { FavoriteTeamFlag } from '../favorite-team-flag';
import { PlayerLink } from './player-link';
import type { PlayerSummary } from '@workspace/api-client-react';

export function PlayerCard({
  player,
  actions,
}: {
  player: PlayerSummary;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card p-3"
      data-testid={`player-card-${player.userId}`}
    >
      <PlayerLink
        userId={player.userId}
        className="flex items-center gap-3 min-w-0 group"
      >
        <div className="relative shrink-0">
          <Avatar className="w-11 h-11 ring-1 ring-border">
            <AvatarImage src={player.avatarUrl || ''} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
              {player.displayName?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          {player.favoriteTeam && (
            <span className="absolute -bottom-1 -end-1">
              <FavoriteTeamFlag
                team={player.favoriteTeam}
                size="sm"
                className="ring-1 ring-background rounded-sm"
              />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate group-hover:text-primary transition-colors">
            {player.displayName || (player.username ? '@' + player.username : '—')}
          </p>
          {player.username && (
            <p className="text-xs text-muted-foreground truncate" dir="ltr">
              @{player.username}
            </p>
          )}
        </div>
      </PlayerLink>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
