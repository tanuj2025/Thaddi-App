/**
 * Unit coverage for the chat profanity filter (App Store Guideline 1.2).
 *
 * Verifies that masking is token-based with word boundaries (no Scunthorpe
 * problem), survives common evasion (casing, Arabic diacritics/tatweel,
 * repeated characters), masks Arabic words + multi-word phrases, and leaves
 * clean text untouched. Pure-function tests, so they run under `tsx --test`
 * without any DB or network.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  containsProfanity,
  maskProfanity,
  normalizeForProfanity,
  PROFANITY_WORD_COUNT,
} from "../src/lib/profanity";

test("masks a standalone English profanity, preserving length", () => {
  assert.equal(maskProfanity("you are a shit"), "you are a ****");
  assert.equal(containsProfanity("you are a shit"), true);
});

test("masks regardless of case", () => {
  assert.equal(maskProfanity("FUCK this"), "**** this");
  assert.equal(containsProfanity("Fuck"), true);
});

test("collapses 3+ repeated characters before matching", () => {
  // "fuuuck" normalizes to "fuck" but is masked at its ORIGINAL length.
  assert.equal(maskProfanity("fuuuck"), "******");
  assert.equal(containsProfanity("shiiiit"), true);
});

test("does NOT mask legitimate words that merely contain a profanity substring", () => {
  // word-boundary matching: "assassin"/"Scunthorpe" must pass through intact.
  assert.equal(maskProfanity("the assassin ran"), "the assassin ran");
  assert.equal(maskProfanity("I live in Scunthorpe"), "I live in Scunthorpe");
  assert.equal(containsProfanity("assassin Scunthorpe classic"), false);
});

test("leaves clean text untouched", () => {
  const clean = "great prediction, good luck everyone!";
  assert.equal(maskProfanity(clean), clean);
  assert.equal(containsProfanity(clean), false);
});

test("masks an Arabic profanity token", () => {
  const masked = maskProfanity("انت نيك");
  assert.notEqual(masked, "انت نيك");
  assert.equal(masked.includes("نيك"), false);
  assert.equal(containsProfanity("انت نيك"), true);
});

test("masks Arabic profanity even with diacritics/tatweel", () => {
  // tatweel + a harakat inside the word must still be detected.
  const evasive = "نـيـكَ";
  assert.equal(containsProfanity(evasive), true);
  assert.equal(maskProfanity(evasive).includes("ن"), false);
});

test("masks a multi-word Arabic phrase as a unit", () => {
  const masked = maskProfanity("هو ابن المتناكة فعلا");
  assert.notEqual(masked, "هو ابن المتناكة فعلا");
  assert.equal(masked.includes("المتناكة"), false);
  // surrounding clean words survive.
  assert.equal(masked.startsWith("هو "), true);
  assert.equal(masked.endsWith(" فعلا"), true);
});

test("normalizeForProfanity folds case, tatweel, and Arabic marks", () => {
  assert.equal(normalizeForProfanity("FuCk"), "fuck");
  assert.equal(normalizeForProfanity("نـيك"), "نيك");
});

test("wordlist is non-empty", () => {
  assert.ok(PROFANITY_WORD_COUNT > 0, "expected a populated wordlist");
});
