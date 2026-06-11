// Active football data provider selection. An explicit FOOTBALL_PROVIDER value
// forces a specific source (mock | espn | football-data | sportmonks); for the
// key-requiring sources, an unconfigured override falls through to the auto
// chain rather than crashing. With no override, football-data.org is preferred
// when its API key is set, then SportMonks; when neither key is configured the
// keyless ESPN World Cup provider takes over so the app shows real WC26 data
// without any API key. The deterministic mock provider is reserved for offline
// development and tests. Callers depend only on the FootballProvider interface.
//
// NOTE: football-data.org's free tier does not serve live/in-play WC2026 data
// (every fixture stays TIMED with null scores), so production runs with
// FOOTBALL_PROVIDER=espn to read live scores from the keyless ESPN feed.

import type { FootballProvider } from "./types";
import { tryCreateFootballDataProvider } from "./footballDataProvider";
import { tryCreateSportMonksProvider } from "./sportmonksProvider";
import { createEspnWorldCupProvider } from "./espnWorldCupProvider";
import { createMockFootballProvider } from "./mockProvider";

export * from "./types";
export { syncTournament } from "./sync";

let cached: FootballProvider | null = null;

// Normalized FOOTBALL_PROVIDER override, or "" when unset/blank.
function providerOverride(): string {
  return (process.env.FOOTBALL_PROVIDER || "").trim().toLowerCase();
}

// The keyless auto-selection chain used when no override applies.
function autoSelect(): FootballProvider {
  return (
    tryCreateFootballDataProvider() ??
    tryCreateSportMonksProvider() ??
    createEspnWorldCupProvider()
  );
}

// Pure selection (uncached) — exported so provider-selection behavior can be
// unit-tested across env combinations without touching the module cache.
export function resolveFootballProvider(): FootballProvider {
  switch (providerOverride()) {
    case "mock":
      // Offline dev + the e2e suites that must not hit a live API.
      return createMockFootballProvider();
    case "espn":
    case "espn-wc":
      // Force the keyless ESPN World Cup feed even when a key is configured.
      return createEspnWorldCupProvider();
    case "football-data":
    case "footballdata": {
      const p = tryCreateFootballDataProvider();
      if (p) return p; // else fall through to auto chain (key not configured)
      break;
    }
    case "sportmonks": {
      const p = tryCreateSportMonksProvider();
      if (p) return p;
      break;
    }
  }
  return autoSelect();
}

export function getFootballProvider(): FootballProvider {
  if (cached) return cached;
  cached = resolveFootballProvider();
  return cached;
}

// True when a real (non-mock) provider is active.
export function isLiveProviderConfigured(): boolean {
  return getFootballProvider().name !== "mock";
}
