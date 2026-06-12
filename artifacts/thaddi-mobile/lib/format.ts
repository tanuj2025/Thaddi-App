import { useEffect, useState } from "react";

import type { Language } from "./translations";

/**
 * Date / time / countdown helpers.
 *
 * We format manually rather than relying on Intl.DateTimeFormat: Hermes ships a
 * limited Intl and we want guaranteed western digits (matching formatNum) plus a
 * tiny, predictable footprint. All times render in the device's local timezone.
 */

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDate(iso: string, lang: Language): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = lang === "ar" ? MONTHS_AR : MONTHS_EN;
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export function formatTime(iso: string, lang: Language): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hours = d.getHours();
  const mins = d.getMinutes();
  const h12 = ((hours + 11) % 12) + 1;
  const meridiem =
    hours < 12 ? (lang === "ar" ? "ص" : "AM") : (lang === "ar" ? "م" : "PM");
  return `${h12}:${pad2(mins)} ${meridiem}`;
}

export function formatDateTime(iso: string, lang: Language): string {
  const date = formatDate(iso, lang);
  const time = formatTime(iso, lang);
  if (!date) return "";
  return `${date} · ${time}`;
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

export function countdown(targetIso: string): CountdownParts {
  const diff = new Date(targetIso).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  }
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    done: false,
  };
}

/**
 * A compact, non-ticking "time until" label suited for list rows, e.g.
 * "2 يوم", "5 س", "30 د". Falls back to minutes for sub-hour windows.
 */
export function compactCountdown(
  targetIso: string,
  t: (key: string) => string,
): string | null {
  const { days, hours, minutes, done } = countdown(targetIso);
  if (done) return null;
  if (days >= 1) return `${days} ${t("match.days")}`;
  if (hours >= 1) return `${hours} ${t("match.hours")}`;
  return `${Math.max(1, minutes)} ${t("match.minutes")}`;
}

/**
 * Live, ticking countdown for single-match surfaces (detail screen). Re-renders
 * once per second. Avoid using this inside long lists.
 */
export function useCountdown(targetIso: string | null | undefined): CountdownParts | null {
  const [parts, setParts] = useState<CountdownParts | null>(() =>
    targetIso ? countdown(targetIso) : null,
  );

  useEffect(() => {
    if (!targetIso) {
      setParts(null);
      return;
    }
    setParts(countdown(targetIso));
    const id = setInterval(() => {
      const next = countdown(targetIso);
      setParts(next);
      if (next.done) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  return parts;
}
