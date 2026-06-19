import React from 'react';
import { useI18n } from '../lib/i18n';
import { useCompetition, labelCompetition } from '../lib/competition';
import type { Competition } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Check, Trophy } from 'lucide-react';

function CompetitionCrest({ competition, size = 'md' }: { competition: Competition; size?: 'sm' | 'md' }) {
  const { lang } = useI18n();
  const dim = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  if (competition.logoUrl) {
    return (
      <img
        src={competition.logoUrl}
        alt={labelCompetition(competition, lang)}
        className={`${dim} object-contain shrink-0`}
      />
    );
  }
  return <Trophy className={`${dim} text-secondary shrink-0`} />;
}

export function CompetitionSwitcher({ className }: { className?: string }) {
  const { t, lang } = useI18n();
  const {
    competitions,
    selectedCompetition,
    selectedSeason,
    availableSeasons,
    isLoading,
    setCompetition,
    setSeason,
  } = useCompetition();

  if (isLoading) {
    return <Skeleton className={`h-10 w-44 rounded-xl ${className ?? ''}`} />;
  }

  if (competitions.length === 0 || !selectedCompetition) {
    return null;
  }

  // Show the season list only when there's a real choice: more than one
  // published season, or the effective season isn't the sole published one
  // (e.g. a coming-soon current season with one past board to browse).
  const showSeasonPicker =
    availableSeasons.length > 1 ||
    (availableSeasons.length === 1 && !availableSeasons.some((s) => s.season === selectedSeason));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`flex items-center gap-2 h-auto py-2 px-3 border-border/60 bg-card/60 ${className ?? ''}`}
          data-testid="button-competition-switcher"
        >
          <CompetitionCrest competition={selectedCompetition} size="sm" />
          <span className="flex flex-col items-start leading-tight min-w-0">
            <span className="text-sm font-bold truncate max-w-[10rem]">
              {labelCompetition(selectedCompetition, lang)}
            </span>
            {selectedSeason && (
              <span className="text-[11px] text-muted-foreground" dir="ltr">
                {selectedSeason}
              </span>
            )}
          </span>
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ms-auto" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('competition.select')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {competitions.map((c) => {
          const isSelected = c.competitionSlug === selectedCompetition.competitionSlug;
          const isComingSoon = !!c.currentSeason?.comingSoon;
          return (
            <DropdownMenuItem
              key={c.competitionSlug}
              className="cursor-pointer gap-2"
              onClick={() => setCompetition(c.competitionSlug)}
              data-testid={`competition-option-${c.competitionSlug}`}
            >
              <CompetitionCrest competition={c} size="sm" />
              <span className="flex flex-col leading-tight min-w-0 flex-1">
                <span className="text-sm font-semibold truncate">{labelCompetition(c, lang)}</span>
                {isComingSoon ? (
                  <span className="text-[11px] text-muted-foreground">{t('competition.comingSoon')}</span>
                ) : (
                  c.currentSeason?.season && (
                    <span className="text-[11px] text-muted-foreground" dir="ltr">
                      {c.currentSeason.season}
                    </span>
                  )
                )}
              </span>
              {isSelected && <Check className="w-4 h-4 text-secondary shrink-0" />}
            </DropdownMenuItem>
          );
        })}
        {showSeasonPicker && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('competition.season')}</DropdownMenuLabel>
            {availableSeasons.map((s) => {
              const isCurrent = s.season === selectedCompetition.currentSeason?.season;
              const isSelected = s.season === selectedSeason;
              return (
                <DropdownMenuItem
                  key={s.season ?? 'null'}
                  className="cursor-pointer gap-2"
                  onClick={() => setSeason(s.season ?? null)}
                  data-testid={`season-option-${s.season}`}
                >
                  <span className="text-sm flex-1" dir="ltr">
                    {s.season}
                  </span>
                  {isCurrent && (
                    <span className="text-[11px] text-muted-foreground">
                      {t('competition.currentSeasonBadge')}
                    </span>
                  )}
                  {isSelected && <Check className="w-4 h-4 text-secondary shrink-0" />}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
