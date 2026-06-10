// Unit test for the ESPN friendlies provider status mapping (mapStatus in
// src/services/football/espnFriendliesProvider.ts).
//
// This is the layer that decides whether a friendly match card shows a live
// indicator at all. ESPN reports a coarse `state` ("pre" / "in" / "post") plus a
// specific `status.type.name` (STATUS_FIRST_HALF / STATUS_HALFTIME / ...). A
// regression here (e.g. dropping the "in" => live mapping, or losing the
// explicit-name precedence) silently brings back the "score with no live
// indicator" bug. These pure-function assertions lock the mapping in place.
//
// Run with: pnpm --filter @workspace/api-server exec tsx --test test/espnFriendliesStatus.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapStatus } from "../src/services/football/espnFriendliesProvider.ts";

test("in-progress period statuses map to live", () => {
  // First half — explicit name + "in" state.
  assert.equal(mapStatus("STATUS_FIRST_HALF", "in", false), "live");
  // Second half — explicit name + "in" state.
  assert.equal(mapStatus("STATUS_SECOND_HALF", "in", false), "live");
  // Generic in-progress.
  assert.equal(mapStatus("STATUS_IN_PROGRESS", "in", false), "live");
  // "in" state alone (unknown period name) is still treated as live.
  assert.equal(mapStatus("", "in", false), "live");
  // IN_PROGRESS name without the coarse state field still maps to live.
  assert.equal(mapStatus("STATUS_IN_PROGRESS", "", false), "live");
});

test("halftime maps to half_time and beats the state field", () => {
  assert.equal(mapStatus("STATUS_HALFTIME", "in", false), "half_time");
  // Underscore variant.
  assert.equal(mapStatus("STATUS_HALF_TIME", "in", false), "half_time");
  // Halftime name must win even if ESPN also flags completed/post.
  assert.equal(mapStatus("STATUS_HALFTIME", "post", true), "half_time");
});

test("completed / post state maps to finished", () => {
  // Explicit completed flag.
  assert.equal(mapStatus("STATUS_FULL_TIME", "post", true), "finished");
  // "post" state alone.
  assert.equal(mapStatus("STATUS_FINAL", "post", false), "finished");
  // completed flag alone (state missing).
  assert.equal(mapStatus("", "", true), "finished");
});

test("postponed and cancelled map to their own statuses", () => {
  assert.equal(mapStatus("STATUS_POSTPONED", "pre", false), "postponed");
  assert.equal(mapStatus("STATUS_CANCELED", "pre", false), "cancelled");
  // ESPN's British spelling variant.
  assert.equal(mapStatus("STATUS_CANCELLED", "pre", false), "cancelled");
  // Postponed/cancelled names take precedence over a completed flag.
  assert.equal(mapStatus("STATUS_POSTPONED", "post", true), "postponed");
});

test("pre-match / unknown states fall back to scheduled", () => {
  assert.equal(mapStatus("STATUS_SCHEDULED", "pre", false), "scheduled");
  assert.equal(mapStatus("", "", false), "scheduled");
  assert.equal(mapStatus("STATUS_UNKNOWN", "weird", false), "scheduled");
});
