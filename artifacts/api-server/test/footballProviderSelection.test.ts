// Unit tests for football provider selection (resolveFootballProvider in
// src/services/football/index.ts).
//
// This is the logic that decides which data source backs the WC26 Match Center.
// The contract: football-data.org is primary when its key is set; with no
// provider keys the KEYLESS ESPN World Cup provider takes over (real WC26 data
// without any API key); and the deterministic mock is selected ONLY when
// explicitly forced via FOOTBALL_PROVIDER=mock. A regression here either hides
// real data behind the mock or makes offline/tests hit a live API.
//
// resolveFootballProvider() is the uncached selector, so we can flip env vars
// and re-resolve in-process without touching the module cache.
//
// Run with: pnpm --filter @workspace/api-server exec tsx --test test/footballProviderSelection.test.ts

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveFootballProvider } from "../src/services/football/index.ts";

const PROVIDER_ENV = [
  "FOOTBALL_PROVIDER",
  "FOOTBALL_DATA_API_KEY",
  "SPORTMONKS_API_KEY",
  "SPORTMONKS_API_TOKEN",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of PROVIDER_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of PROVIDER_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("football-data.org is primary when its API key is set", () => {
  process.env.FOOTBALL_DATA_API_KEY = "test-key";
  assert.equal(resolveFootballProvider().name, "football-data");
});

test("SportMonks is selected when only its key is set", () => {
  process.env.SPORTMONKS_API_KEY = "test-key";
  assert.equal(resolveFootballProvider().name, "sportmonks");
});

test("ESPN World Cup is the keyless fallback when no provider key is set", () => {
  // No FOOTBALL_DATA_API_KEY / SPORTMONKS_API_KEY → keyless ESPN, NOT mock.
  assert.equal(resolveFootballProvider().name, "espn-wc");
});

test("FOOTBALL_PROVIDER=mock forces the mock provider regardless of keys", () => {
  process.env.FOOTBALL_PROVIDER = "mock";
  // Even with a live key present, the explicit override wins.
  process.env.FOOTBALL_DATA_API_KEY = "test-key";
  assert.equal(resolveFootballProvider().name, "mock");
});

test("FOOTBALL_PROVIDER with any other value does not force mock", () => {
  process.env.FOOTBALL_PROVIDER = "espn";
  // Not the magic "mock" value → normal selection (keyless ESPN here).
  assert.equal(resolveFootballProvider().name, "espn-wc");
});
