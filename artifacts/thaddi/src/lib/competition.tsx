import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useGetCompetitions } from '@workspace/api-client-react';
import type { Competition, CompetitionSeason } from '@workspace/api-client-react';
import type { Lang } from './matchUtils';

// Persisted selection keys. Bumped (v1) so a future shape change can invalidate
// cleanly. Season is stored per-competition because each competition resolves to
// its own current/historical season.
const COMP_KEY = 'thaddi:competition:v1';
const SEASON_MAP_KEY = 'thaddi:seasonByCompetition:v1';

function readSlug(): string | null {
  try {
    return localStorage.getItem(COMP_KEY);
  } catch {
    return null;
  }
}

function writeSlug(slug: string | null) {
  try {
    if (slug) localStorage.setItem(COMP_KEY, slug);
    else localStorage.removeItem(COMP_KEY);
  } catch {
    /* storage unavailable */
  }
}

function readSeasonMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SEASON_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeSeasonMap(map: Record<string, string>) {
  try {
    localStorage.setItem(SEASON_MAP_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
}

// A competition is "actionable" when it has a published, non-coming-soon season
// the user can predict on right now. The smart default prefers these.
function isActionable(c: Competition): boolean {
  return !!c.currentSeason && c.currentSeason.hasPublishedFixtures && !c.currentSeason.comingSoon;
}

function byDisplayOrder(a: Competition, b: Competition): number {
  return a.displayOrder - b.displayOrder;
}

// Resolve the default competition once the list loads: an actionable competition
// (lowest displayOrder) first, otherwise the lowest-displayOrder competition.
function pickDefault(competitions: Competition[]): string | null {
  const active = competitions.filter((c) => c.isActive);
  const pool = active.length ? active : competitions;
  if (pool.length === 0) return null;
  const actionable = pool.filter(isActionable).sort(byDisplayOrder);
  if (actionable.length) return actionable[0].competitionSlug;
  return [...pool].sort(byDisplayOrder)[0].competitionSlug;
}

export function labelCompetition(c: Competition, lang: Lang): string {
  return lang === 'ar' ? c.nameAr : c.nameEn;
}

type CompetitionContextValue = {
  competitions: Competition[];
  selectedCompetition: Competition | null;
  /** Effective competition slug, or null when no competitions exist (legacy default). */
  selectedSlug: string | null;
  /** Effective season key for the selected competition, or null. */
  selectedSeason: string | null;
  /** Selectable seasons (published fixtures) for the selected competition, most recent first. */
  availableSeasons: CompetitionSeason[];
  /** True when the effective selected season has no published board yet. */
  comingSoon: boolean;
  isLoading: boolean;
  /** The competitions query has settled (success or error). */
  isReady: boolean;
  setCompetition: (slug: string) => void;
  setSeason: (season: string | null) => void;
  labelCompetition: (c: Competition, lang: Lang) => string;
};

const CompetitionContext = createContext<CompetitionContextValue | undefined>(undefined);

export function CompetitionProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useGetCompetitions();
  const competitions = useMemo(() => {
    const list = data?.competitions ?? [];
    return [...list].sort(byDisplayOrder);
  }, [data]);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => readSlug());
  const [seasonBySlug, setSeasonBySlug] = useState<Record<string, string>>(() => readSeasonMap());

  // Effective competition is derived (not stored) so there is never a render
  // where the list has loaded but no competition is selected yet — this avoids a
  // flash of wrong-competition / unscoped data on first load.
  const selectedCompetition = useMemo<Competition | null>(() => {
    if (competitions.length === 0) return null;
    if (selectedSlug) {
      const found = competitions.find((c) => c.competitionSlug === selectedSlug);
      if (found) return found;
    }
    const def = pickDefault(competitions);
    return competitions.find((c) => c.competitionSlug === def) ?? null;
  }, [competitions, selectedSlug]);

  // Once resolved, persist the effective slug so "remember last choice" holds and
  // a stale/invalid persisted slug self-heals to the default.
  useEffect(() => {
    if (selectedCompetition && selectedCompetition.competitionSlug !== selectedSlug) {
      setSelectedSlug(selectedCompetition.competitionSlug);
      writeSlug(selectedCompetition.competitionSlug);
    }
  }, [selectedCompetition, selectedSlug]);

  const availableSeasons = useMemo<CompetitionSeason[]>(
    () => selectedCompetition?.seasons ?? [],
    [selectedCompetition],
  );

  // Prefer a valid persisted override; otherwise track the current season, then
  // the most recent published one. A stale override (its season no longer
  // exists) is ignored without rewriting storage — it self-heals on next pick.
  const selectedSeason = useMemo<string | null>(() => {
    if (!selectedCompetition) return null;
    const override = seasonBySlug[selectedCompetition.competitionSlug];
    if (override && availableSeasons.some((s) => s.season === override)) return override;
    return selectedCompetition.currentSeason?.season ?? availableSeasons[0]?.season ?? null;
  }, [selectedCompetition, seasonBySlug, availableSeasons]);

  // A historical season always has a published board, so coming-soon is decided
  // by the *selected* season: only the current/no-fixtures state is coming soon.
  const selectedSeasonInfo = useMemo<CompetitionSeason | null>(
    () => availableSeasons.find((s) => s.season === selectedSeason) ?? null,
    [availableSeasons, selectedSeason],
  );

  const comingSoon = useMemo(() => {
    if (!selectedCompetition) return false;
    if (selectedSeasonInfo) return false;
    const current = selectedCompetition.currentSeason;
    if (!current) return true;

    if (current.officialStartDate) {
      const start = new Date(current.officialStartDate).getTime();
      if (Date.now() < start) return true;
    }

    return !!current.comingSoon;
  }, [selectedCompetition, selectedSeasonInfo]);

  const setCompetition = (slug: string) => {
    setSelectedSlug(slug);
    writeSlug(slug);
  };

  const setSeason = (season: string | null) => {
    if (!selectedCompetition) return;
    const slug = selectedCompetition.competitionSlug;
    // Picking the current season (or clearing) drops the override so the
    // competition keeps tracking its current season going forward; only a past
    // season is pinned.
    const isCurrent = season != null && season === selectedCompetition.currentSeason?.season;
    setSeasonBySlug((prev) => {
      const next = { ...prev };
      if (season && !isCurrent) next[slug] = season;
      else delete next[slug];
      writeSeasonMap(next);
      return next;
    });
  };

  const value: CompetitionContextValue = {
    competitions,
    selectedCompetition,
    selectedSlug: selectedCompetition?.competitionSlug ?? null,
    selectedSeason,
    availableSeasons,
    comingSoon,
    isLoading,
    isReady: !isLoading,
    setCompetition,
    setSeason,
    labelCompetition,
  };

  return <CompetitionContext.Provider value={value}>{children}</CompetitionContext.Provider>;
}

export function useCompetition() {
  const context = useContext(CompetitionContext);
  if (!context) throw new Error('useCompetition must be used within CompetitionProvider');
  return context;
}
