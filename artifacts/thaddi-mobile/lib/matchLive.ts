// Adaptive react-query poll interval (ms) for live match data on mobile.
//
// Polls fast while any match is in progress — or a scheduled match is at/near
// kickoff so we catch the flip to live — and returns false otherwise so a static
// finished/upcoming screen doesn't keep hitting the API. Accepts either the
// matches list (Match Center) or a single match (detail screen). Pairs with the
// server's request-driven sync so each poll also nudges fresh data on autoscale.

type MatchLike = { status?: string | null; kickoffAt?: string | null };

const SOON_MS = 5 * 60 * 1000; // start polling up to 5 min before kickoff
const OVERDUE_MS = 3 * 60 * 60 * 1000; // ...and keep polling a late-starting one

function isLiveOrStarting(m: MatchLike, now: number, liveMs: number): number | false {
  if (m.status === "live" || m.status === "half_time") return liveMs;
  if (m.status === "scheduled" && m.kickoffAt) {
    const delta = new Date(m.kickoffAt).getTime() - now;
    if (Number.isFinite(delta) && delta <= SOON_MS && delta > -OVERDUE_MS) {
      return liveMs;
    }
  }
  return false;
}

export function liveRefetchIntervalMs(
  data: MatchLike | ReadonlyArray<MatchLike> | undefined,
  liveMs = 15000,
): number | false {
  if (!data) return false;
  const list = Array.isArray(data) ? data : [data as MatchLike];
  if (list.length === 0) return false;
  const now = Date.now();
  for (const m of list) {
    if (isLiveOrStarting(m, now, liveMs) !== false) return liveMs;
  }
  return false;
}
