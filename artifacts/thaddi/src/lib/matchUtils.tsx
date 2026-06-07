import { useEffect, useState } from 'react';

export type Lang = 'ar' | 'en';

export function localeOf(lang: Lang): string {
  return lang === 'ar' ? 'ar-SA' : 'en-US';
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

export const outcomeStyles: Record<string, string> = {
  exact: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  winner: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
  goal_difference: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30',
  submitted: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  none: 'bg-muted text-muted-foreground border-border',
  pending: 'bg-muted text-muted-foreground border-border',
};
