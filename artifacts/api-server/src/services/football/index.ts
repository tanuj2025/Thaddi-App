// Active football data provider selection. A real provider is used when
// configured (football-data.org preferred, then SportMonks); otherwise the
// deterministic mock provider keeps the app fully functional in development.
// Callers depend only on the FootballProvider interface.

import type { FootballProvider } from "./types";
import { tryCreateFootballDataProvider } from "./footballDataProvider";
import { tryCreateSportMonksProvider } from "./sportmonksProvider";
import { createMockFootballProvider } from "./mockProvider";

export * from "./types";
export { syncTournament } from "./sync";

let cached: FootballProvider | null = null;

export function getFootballProvider(): FootballProvider {
  if (cached) return cached;
  cached =
    tryCreateFootballDataProvider() ??
    tryCreateSportMonksProvider() ??
    createMockFootballProvider();
  return cached;
}

// True when a real (non-mock) provider is active.
export function isLiveProviderConfigured(): boolean {
  return getFootballProvider().name !== "mock";
}
