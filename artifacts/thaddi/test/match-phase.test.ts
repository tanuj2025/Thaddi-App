// Unit test for the live-match phase helpers (src/lib/matchUtils.tsx):
//   - matchPhase: derives scheduled/first_half/halftime/second_half/live/ended
//     from the API status + running minute. The API status enum does NOT
//     distinguish 1st vs 2nd half, so the half is inferred from the minute
//     threshold (<=45 first half, >45 second half).
//   - phaseShowsMinute: only the two running-clock halves show a minute.
//   - isLivePhase: which phases get the pulsing live treatment.
//
// These pure functions back the "score with no live indicator" fix. A change to
// the status mapping or the minute threshold could silently regress the live
// indicator, so this locks the behaviour in.
//
// Run with: tsx --test test/match-phase.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchPhase,
  phaseShowsMinute,
  isLivePhase,
} from "../src/lib/matchUtils.tsx";

test("matchPhase derives the half from the minute threshold", () => {
  // First half: minute <= 45.
  assert.equal(matchPhase("live", 1), "first_half");
  assert.equal(matchPhase("live", 45), "first_half");
  // Second half: minute > 45.
  assert.equal(matchPhase("live", 46), "second_half");
  assert.equal(matchPhase("live", 90), "second_half");
  // Live with no minute yet => generic live (no half inferred).
  assert.equal(matchPhase("live", null), "live");
  assert.equal(matchPhase("live", undefined), "live");
});

test("matchPhase maps halftime and ignores any minute for it", () => {
  assert.equal(matchPhase("half_time", null), "halftime");
  // A stale minute must not flip halftime into a running half.
  assert.equal(matchPhase("half_time", 45), "halftime");
  assert.equal(matchPhase("half_time", 60), "halftime");
});

test("matchPhase maps finished / full_time to ended", () => {
  assert.equal(matchPhase("finished", 90), "ended");
  assert.equal(matchPhase("full_time", 90), "ended");
  // Ended even without a minute.
  assert.equal(matchPhase("finished", null), "ended");
});

test("matchPhase falls back to scheduled for pre-match / unknown statuses", () => {
  assert.equal(matchPhase("scheduled", null), "scheduled");
  assert.equal(matchPhase("postponed", null), "scheduled");
  assert.equal(matchPhase("cancelled", null), "scheduled");
  assert.equal(matchPhase(null, null), "scheduled");
  assert.equal(matchPhase(undefined, undefined), "scheduled");
});

test("phaseShowsMinute is true only for the running halves", () => {
  assert.equal(phaseShowsMinute("first_half"), true);
  assert.equal(phaseShowsMinute("second_half"), true);
  // Halftime has no running clock, so no minute shown.
  assert.equal(phaseShowsMinute("halftime"), false);
  assert.equal(phaseShowsMinute("live"), false);
  assert.equal(phaseShowsMinute("ended"), false);
  assert.equal(phaseShowsMinute("scheduled"), false);
});

test("isLivePhase covers every in-play phase and excludes the rest", () => {
  assert.equal(isLivePhase("first_half"), true);
  assert.equal(isLivePhase("halftime"), true);
  assert.equal(isLivePhase("second_half"), true);
  assert.equal(isLivePhase("live"), true);
  assert.equal(isLivePhase("ended"), false);
  assert.equal(isLivePhase("scheduled"), false);
});
