// Active football data provider selection. football-data.org is preferred when
// its API key is set, then SportMonks; when neither key is configured the
// keyless ESPN World Cup provider takes over so the app shows real WC26 data
// without any API key. The deterministic mock provider is reserved for offline
// development and tests, selected only when explicitly forced via
// FOOTBALL_PROVIDER=mock. Callers depend only on the FootballProvider interface.

import type { FootballProvider } from "./types";
import { tryCreateFootballDataProvider } from "./footballDataProvider";
import { tryCreateSportMonksProvider } from "./sportmonksProvider";
import { createEspnWorldCupProvider } from "./espnWorldCupProvider";
import { createMockFootballProvider } from "./mockProvider";

export * from "./types";
export { syncTournament } from "./sync";

let cached: FootballProvider | null = null;

// Explicit escape hatch to force the offline mock provider (offline dev + the
// e2e suites that must not hit a live API). Any other value is ignored.
function mockForced(): boolean {
  return (process.env.FOOTBALL_PROVIDER || "").trim().toLowerCase() === "mock";
}

// Pure selection (uncached) — exported so provider-selection behavior can be
// unit-tested across env combinations without touching the module cache.
export function resolveFootballProvider(): FootballProvider {
  if (mockForced()) return createMockFootballProvider();
  return (
    tryCreateFootballDataProvider() ??
    tryCreateSportMonksProvider() ??
    createEspnWorldCupProvider()
  );
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
