// Active football data provider selection. SportMonks is used when configured;
// otherwise the deterministic mock provider keeps the app fully functional in
// development. Callers depend only on the FootballProvider interface.

import type { FootballProvider } from "./types";
import { tryCreateSportMonksProvider } from "./sportmonksProvider";
import { createMockFootballProvider } from "./mockProvider";

export * from "./types";
export { syncTournament } from "./sync";

let cached: FootballProvider | null = null;

export function getFootballProvider(): FootballProvider {
  if (cached) return cached;
  cached = tryCreateSportMonksProvider() ?? createMockFootballProvider();
  return cached;
}

// True when a real (non-mock) provider is active.
export function isLiveProviderConfigured(): boolean {
  return getFootballProvider().name !== "mock";
}
