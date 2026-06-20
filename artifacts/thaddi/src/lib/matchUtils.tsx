import { useEffect, useState } from 'react';

export type Lang = 'ar' | 'en';

// Arabic locale pinned to the Gregorian calendar and Western (Latin) digits via
// Unicode locale extensions. Without `-u-ca-gregory-nu-latn`, `ar-SA` renders
// Arabic-Indic numerals (٠١٢٣) and can fall back to the Hijri/Islamic calendar.
// We keep Arabic month/day *names* (the rest of the `ar-SA` locale) intact.
const AR_LOCALE = 'ar-SA-u-ca-gregory-nu-latn';

export function localeOf(lang: Lang, enLocale: string = 'en-US'): string {
  return lang === 'ar' ? AR_LOCALE : enLocale;
}

export function formatKickoff(iso: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(localeOf(lang), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatNum(n: number, lang: Lang): string {
  try {
    return new Intl.NumberFormat(localeOf(lang)).format(n);
  } catch {
    return String(n);
  }
}

export type Countdown = {
  total: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
};

function diff(target: number): Countdown {
  const total = Math.max(0, target - Date.now());
  const seconds = Math.floor((total / 1000) % 60);
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  return { total, days, hours, minutes, seconds, done: total <= 0 };
}

export function useCountdown(targetIso?: string | null): Countdown | null {
  const target = targetIso ? new Date(targetIso).getTime() : null;
  const [cd, setCd] = useState<Countdown | null>(target ? diff(target) : null);

  useEffect(() => {
    if (!target) {
      setCd(null);
      return;
    }
    setCd(diff(target));
    const id = setInterval(() => setCd(diff(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  return cd;
}

type CountdownLabels = {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
};

export function formatCountdown(cd: Countdown, lang: Lang, labels: CountdownLabels): string {
  const n = (v: number) => formatNum(v, lang);
  // Wrap each "number + label" unit in a Unicode first-strong isolate (FSI…PDI)
  // so a unit like "٤يوم" renders self-contained and never reorders against its
  // neighbours or the container's direction. Without this, an LTR container around
  // Arabic-digit + Arabic-label runs scrambles the bidi order (e.g. "٤يوم اس ٥ا د").
  const unit = (value: string, label: string) => `\u2068${value}${label}\u2069`;
  const parts: string[] = [];
  if (cd.days > 0) parts.push(unit(n(cd.days), labels.days));
  if (cd.days > 0 || cd.hours > 0) parts.push(unit(n(cd.hours), labels.hours));
  parts.push(unit(n(cd.minutes), labels.minutes));
  if (cd.days === 0) parts.push(unit(n(cd.seconds), labels.seconds));
  return parts.join(' ');
}

// Live phase of a match, derived from the API status + minute. The API status
// enum is scheduled/live/half_time/full_time/finished/postponed/cancelled and
// does NOT distinguish 1st vs 2nd half, so we infer the half from the minute.
export type MatchPhase =
  | 'scheduled'
  | 'first_half'
  | 'halftime'
  | 'second_half'
  | 'live'
  | 'ended';

export function matchPhase(
  status: string | null | undefined,
  minute: number | null | undefined,
): MatchPhase {
  if (status === 'finished' || status === 'full_time') return 'ended';
  if (status === 'half_time') return 'halftime';
  if (status === 'live') {
    if (minute != null) return minute > 45 ? 'second_half' : 'first_half';
    return 'live';
  }
  return 'scheduled';
}

// i18n key for each phase (empty for scheduled, which has no live label).
export const matchPhaseLabelKey: Record<MatchPhase, string> = {
  scheduled: '',
  first_half: 'matches.firstHalf',
  halftime: 'matches.halftime',
  second_half: 'matches.secondHalf',
  live: 'matches.live',
  ended: 'matches.ended',
};

// Phases that should render with the pulsing red "live" treatment.
export function isLivePhase(phase: MatchPhase): boolean {
  return (
    phase === 'first_half' ||
    phase === 'halftime' ||
    phase === 'second_half' ||
    phase === 'live'
  );
}

// Phases where the running minute is meaningful and should be shown.
export function phaseShowsMinute(phase: MatchPhase): boolean {
  return phase === 'first_half' || phase === 'second_half';
}

// Adaptive react-query refetch interval (ms) for live match data. Polls fast
// while any match is in progress — or a scheduled match is at/near kickoff so we
// catch the flip to live — and returns false otherwise so a static
// finished/upcoming list doesn't keep hitting the API. Pair with the server's
// request-driven sync so each poll also nudges fresh data on autoscale.
export function liveRefetchIntervalMs(
  matches:
    | ReadonlyArray<{
        status?: string | null;
        minute?: number | null;
        kickoffAt?: string | null;
      }>
    | undefined,
  liveMs = 15000,
): number | false {
  if (!matches || matches.length === 0) return false;
  const now = Date.now();
  const SOON_MS = 5 * 60 * 1000; // start polling up to 5 min before kickoff
  const OVERDUE_MS = 3 * 60 * 60 * 1000; // ...and keep polling a late-starting one
  for (const m of matches) {
    const phase = matchPhase(m.status ?? undefined, m.minute ?? undefined);
    if (isLivePhase(phase)) return liveMs;
    if (phase === 'scheduled' && m.kickoffAt) {
      const delta = new Date(m.kickoffAt).getTime() - now;
      if (Number.isFinite(delta) && delta <= SOON_MS && delta > -OVERDUE_MS) {
        return liveMs;
      }
    }
  }
  return false;
}

export const outcomeStyles: Record<string, string> = {
  exact: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  winner: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
  goal_difference: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30',
  submitted: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  none: 'bg-muted text-muted-foreground border-border',
  pending: 'bg-muted text-muted-foreground border-border',
};

// Per-match outcome presentation under the 3 / 1 / 0 scoring model. Only `exact`
// (+3) and `winner` (+1) are scoring tiers; anything that earned nothing
// (`submitted`, the legacy `goal_difference`, `none`) reads as a neutral "no
// points" state. Point values themselves come from the API (`pointsAwarded`),
// which the backend derives from the central scoring rules — the UI never
// hardcodes tier values.
export function outcomeBadgeStyle(outcome: string): string {
  if (outcome === 'exact' || outcome === 'winner' || outcome === 'pending') {
    return outcomeStyles[outcome] || '';
  }
  return outcomeStyles.none;
}

export function outcomeLabelKey(outcome: string): string {
  if (outcome === 'exact' || outcome === 'winner' || outcome === 'pending') {
    return `outcome.${outcome}`;
  }
  return 'outcome.none';
}
