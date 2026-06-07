// Shared configuration, tagging conventions, and the pure progression model for
// the live demo-data testing harness. Everything here is deterministic so the
// stateless progression engine can recompute a demo match's current state (and
// its predetermined final score) purely from the match index + elapsed time —
// no extra columns or state are stored.

import type { Match } from "@workspace/db";

// ---- Tagging conventions -------------------------------------------------
// Every demo row carries an unambiguous marker so teardown is an exact sweep
// and the real provider sync never clobbers it.
export const DEMO_EXTERNAL_PREFIX = "demo:";
export const DEMO_TOURNAMENT_SLUG = "demo-tournament";
export const DEMO_TOURNAMENT_EXTERNAL = "demo:tournament";
export const DEMO_STAGE_EXTERNAL = "demo:stage";
// Demo matches are tagged `demo:m:<index>`; teams `demo:t:<index>`.
export const DEMO_MATCH_EXTERNAL_PREFIX = "demo:m:";
export const DEMO_TEAM_EXTERNAL_PREFIX = "demo:t:";
// Demo challenges are tagged on createdViaCode (challenges have no external_id).
export const DEMO_CHALLENGE_MARKER = "demo:harness";
// Demo users are tagged on their (never-real) Clerk id.
export const DEMO_USER_CLERK_PREFIX = "demo:user:";

// ---- Timeline / engine configuration (env-overridable) -------------------
function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// How long a demo match takes to go kickoff -> finished (the compressed clock).
export const DEMO_LIFECYCLE_MS = numFromEnv("DEMO_LIFECYCLE_MS", 30 * 60 * 1000);
// Spacing between consecutive demo kickoffs.
export const DEMO_SPACING_MS = numFromEnv("DEMO_SPACING_MS", 4 * 60 * 1000);
// How many of the seeded matches start out already finished (anchors the mix).
export const DEMO_FINISHED_COUNT = Math.floor(
  numFromEnv("DEMO_FINISHED_COUNT", 12),
);
// Total demo matches to seed.
export const DEMO_MATCH_COUNT = Math.floor(numFromEnv("DEMO_MATCH_COUNT", 50));
// Number of dummy users seeded (each pre-fills predictions on every match).
export const DEMO_USER_COUNT = Math.floor(numFromEnv("DEMO_USER_COUNT", 8));
// Progression engine tick cadence.
export const DEMO_TICK_MS = numFromEnv("DEMO_TICK_MS", 15 * 1000);

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

// Whether the demo-data harness is available. It is always on outside
// production; in production it is OFF by default and only enabled when
// DEMO_HARNESS_PROD_ENABLED is explicitly set to a truthy value. This lets the
// owner test on the live site for now, and cleanly turn it off later (e.g. once
// real users arrive) without a code change.
export function isDemoHarnessEnabled(): boolean {
  if (!isProductionEnv()) return true;
  const raw = (process.env.DEMO_HARNESS_PROD_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

// ---- Deterministic helpers ----------------------------------------------
// Small seeded PRNG (mulberry32) so scores/predictions are reproducible across
// seed time and every later engine tick (and across server restarts).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Scoreline {
  home: number;
  away: number;
}

// Predetermined final score for a demo match, derived purely from its index.
export function demoFinalScore(index: number): Scoreline {
  const r = mulberry32(1000 + index);
  return { home: Math.floor(r() * 4), away: Math.floor(r() * 4) };
}

// Deterministic prediction a seeded demo user makes for a given match. Varied
// per (user, match) so scoring produces a realistic spread of outcomes.
export function demoPrediction(userIndex: number, matchIndex: number): Scoreline {
  const r = mulberry32(7000 + userIndex * 131 + matchIndex * 17);
  return { home: Math.floor(r() * 4), away: Math.floor(r() * 4) };
}

// Parse the numeric index out of a demo match external_id (`demo:m:<i>`).
export function demoMatchIndex(externalId: string | null): number | null {
  if (!externalId || !externalId.startsWith(DEMO_MATCH_EXTERNAL_PREFIX)) {
    return null;
  }
  const n = Number(externalId.slice(DEMO_MATCH_EXTERNAL_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

// Kickoff time for demo match `index`, anchored around `seededAt` so the first
// DEMO_FINISHED_COUNT matches are already finished, a handful are live, and the
// rest are upcoming.
export function demoKickoffAt(index: number, seededAt: number): Date {
  const base = seededAt - DEMO_LIFECYCLE_MS - DEMO_FINISHED_COUNT * DEMO_SPACING_MS;
  return new Date(base + index * DEMO_SPACING_MS);
}

export interface DesiredMatchState {
  status: Match["status"];
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
}

// Pure model of where a demo match should be RIGHT NOW given its kickoff and
// predetermined final score: scheduled before kickoff, live (with a rising
// minute and partial score, briefly half_time at the midpoint) during the
// lifecycle window, then finished with the final score.
export function computeDesiredState(
  kickoffAt: Date,
  final: Scoreline,
  now: Date,
): DesiredMatchState {
  const elapsed = now.getTime() - kickoffAt.getTime();
  if (elapsed < 0) {
    return { status: "scheduled", homeScore: null, awayScore: null, minute: null };
  }
  if (elapsed >= DEMO_LIFECYCLE_MS) {
    return { status: "finished", homeScore: final.home, awayScore: final.away, minute: 90 };
  }
  const progress = elapsed / DEMO_LIFECYCLE_MS; // 0..1
  // Ramp the partial score so it reaches the final slightly before full time.
  const partial = (f: number) => Math.min(f, Math.round(f * Math.min(progress * 1.15, 1)));
  if (progress >= 0.5 && progress < 0.56) {
    return { status: "half_time", homeScore: partial(final.home), awayScore: partial(final.away), minute: 45 };
  }
  const minute = Math.max(1, Math.min(90, Math.round(progress * 90)));
  return { status: "live", homeScore: partial(final.home), awayScore: partial(final.away), minute };
}
