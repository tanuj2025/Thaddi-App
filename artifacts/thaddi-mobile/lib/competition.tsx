import AsyncStorage from "@react-native-async-storage/async-storage";
import { useGetCompetitions } from "@workspace/api-client-react";
import type { Competition } from "@workspace/api-client-react";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { Language } from "./translations";

// Persisted selection keys. Bumped (v1) so a future shape change can invalidate
// cleanly. Season is stored per-competition because each competition resolves to
// its own current/historical season.
const COMP_KEY = "thaddi.competition.v1";
const SEASON_MAP_KEY = "thaddi.seasonByCompetition.v1";

async function readSlug(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(COMP_KEY);
  } catch {
    return null;
  }
}

function writeSlug(slug: string | null) {
  void (async () => {
    try {
      if (slug) await AsyncStorage.setItem(COMP_KEY, slug);
      else await AsyncStorage.removeItem(COMP_KEY);
    } catch {
      /* storage unavailable */
    }
  })();
}

async function readSeasonMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(SEASON_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeSeasonMap(map: Record<string, string>) {
  void (async () => {
    try {
      await AsyncStorage.setItem(SEASON_MAP_KEY, JSON.stringify(map));
    } catch {
      /* storage unavailable */
    }
  })();
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

export function labelCompetition(c: Competition, lang: Language): string {
  return lang === "ar" ? c.nameAr : c.nameEn;
}

type CompetitionContextValue = {
  competitions: Competition[];
  selectedCompetition: Competition | null;
  /** Effective competition slug, or null when no competitions exist (legacy default). */
  selectedSlug: string | null;
  /** Effective season key for the selected competition, or null. */
  selectedSeason: string | null;
  /** True when the selected competition's current season has no published fixtures yet. */
  comingSoon: boolean;
  isLoading: boolean;
  /** Competitions query settled AND persisted selection has been read. */
  isReady: boolean;
  setCompetition: (slug: string) => void;
  setSeason: (season: string | null) => void;
  labelCompetition: (c: Competition, lang: Language) => string;
};

const CompetitionContext = createContext<CompetitionContextValue | undefined>(undefined);

export function CompetitionProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useGetCompetitions();
  const competitions = useMemo(() => {
    const list = data?.competitions ?? [];
    return [...list].sort(byDisplayOrder);
  }, [data]);

  // AsyncStorage is async, so the persisted choice is hydrated after first
  // render. `hydrated` gates isReady so no scoped query fires (or fires twice)
  // before we know the remembered competition/season — mirrors intro.tsx.
  const [hydrated, setHydrated] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [seasonBySlug, setSeasonBySlug] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      const [slug, map] = await Promise.all([readSlug(), readSeasonMap()]);
      if (!active) return;
      if (slug) setSelectedSlug(slug);
      setSeasonBySlug(map);
      setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, []);

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
  // a stale/invalid persisted slug self-heals to the default. Gated on hydration
  // so we never overwrite the stored choice with the default before reading it.
  useEffect(() => {
    if (!hydrated) return;
    if (selectedCompetition && selectedCompetition.competitionSlug !== selectedSlug) {
      setSelectedSlug(selectedCompetition.competitionSlug);
      writeSlug(selectedCompetition.competitionSlug);
    }
  }, [hydrated, selectedCompetition, selectedSlug]);

  const selectedSeason = useMemo<string | null>(() => {
    if (!selectedCompetition) return null;
    const override = seasonBySlug[selectedCompetition.competitionSlug];
    if (override) return override;
    return selectedCompetition.currentSeason?.season ?? null;
  }, [selectedCompetition, seasonBySlug]);

  const comingSoon =
    !!selectedCompetition &&
    (!selectedCompetition.currentSeason || !!selectedCompetition.currentSeason.comingSoon);

  const setCompetition = (slug: string) => {
    setSelectedSlug(slug);
    writeSlug(slug);
  };

  const setSeason = (season: string | null) => {
    if (!selectedCompetition) return;
    const slug = selectedCompetition.competitionSlug;
    setSeasonBySlug((prev) => {
      const next = { ...prev };
      if (season) next[slug] = season;
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
    comingSoon,
    isLoading,
    isReady: !isLoading && hydrated,
    setCompetition,
    setSeason,
    labelCompetition,
  };

  return <CompetitionContext.Provider value={value}>{children}</CompetitionContext.Provider>;
}

export function useCompetition() {
  const context = useContext(CompetitionContext);
  if (!context) throw new Error("useCompetition must be used within CompetitionProvider");
  return context;
}
