import React from 'react';
import { Shield } from 'lucide-react';
import type { FavoriteTeamRef } from '@workspace/api-client-react';
import { useI18n } from '../lib/i18n';

interface FavoriteTeamFlagProps {
  team: FavoriteTeamRef | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

export function FavoriteTeamFlag({ team, size = 'sm', className = '' }: FavoriteTeamFlagProps) {
  const { lang, t } = useI18n();
  if (!team) return null;
  const name = lang === 'ar' ? team.nameAr : team.nameEn;
  const w = size === 'sm' ? 20 : 28;
  const h = size === 'sm' ? 14 : 20;
  if (team.flagUrl) {
    return (
      <img
        src={team.flagUrl}
        alt={`${t('pickTeam.flagOf')} ${name}`}
        title={name}
        width={w}
        height={h}
        className={`inline-block rounded-sm object-cover shrink-0 ${className}`}
      />
    );
  }
  return (
    <Shield
      aria-label={name}
      className={`inline-block shrink-0 text-muted-foreground/60 ${size === 'sm' ? 'w-4 h-4' : 'w-6 h-5'} ${className}`}
    />
  );
}
