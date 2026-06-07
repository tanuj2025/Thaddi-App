import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isProseWord,
  untranslatedWords,
  looksLikeEnglish,
  containsArabic,
  longestEnglishRun,
  isNonProseSample,
  classifyArabicValue,
  MIXED_RUN_THRESHOLD,
} from "@workspace/scripts/i18n-guard.mjs";

// These tests lock in the subtle heuristics inside check-i18n.mjs so a future
// edit cannot silently weaken detection (letting English slip through to Arabic
// users) or introduce false positives (flagging legitimate mixed values). They
// exercise the exported detection helpers directly, plus the per-value
// classifier that the guardrail uses to decide whether an `ar` value is a
// forgotten translation.

// --------------------------------------------------------------------------
// classifyArabicValue — the end-to-end per-value verdict ("ok"/"english"/"mixed")
// --------------------------------------------------------------------------
test("classifyArabicValue flags a fully-English ar value as 'english'", () => {
  assert.equal(classifyArabicValue("Match predictions are now open"), "english");
  assert.equal(classifyArabicValue("Save changes"), "english");
});

test("classifyArabicValue flags a half-translated value with an English clause inside Arabic as 'mixed'", () => {
  // Arabic is present, but a forgotten English clause (>= MIXED_RUN_THRESHOLD
  // consecutive prose words) remains visible to Arabic users.
  assert.equal(
    classifyArabicValue("توقّعاتك now open for predictions اليوم"),
    "mixed",
  );
  assert.equal(
    classifyArabicValue("مرحباً please save your changes الآن"),
    "mixed",
  );
});

test("classifyArabicValue leaves a genuinely-translated Arabic value clean", () => {
  assert.equal(
    classifyArabicValue("توقّعات المباريات مفتوحة الآن"),
    "ok",
  );
});

test("classifyArabicValue treats null (computed values) as 'ok'", () => {
  assert.equal(classifyArabicValue(null), "ok");
});

// Legitimate mixed values from the real dictionary — these MUST stay clean,
// otherwise the guardrail produces false positives and blocks valid copy.
test("classifyArabicValue keeps legitimate mixed dictionary values clean", () => {
  const legitimate = [
    // terms.intro — Arabic prose with the brand name in parentheses.
    "مرحباً بك في تحدّي (THADDI). تحكم هذه الشروط استخدامك لمنصّة توقّعات كرة القدم الخاصة بنا.",
    // admin.tournaments.slug — Arabic label with a one-off technical term.
    "المعرّف (slug)",
    // admin.audit.ip — Arabic label with the acronym "IP".
    "عنوان IP",
    // admin.audit.actionPlaceholder — Arabic with a dotted identifier sample.
    "الإجراء (مثال: user.update)",
    // admin.audit.showing — Arabic with placeholder tokens.
    "عرض {from}–{to} من {total}",
    // nameEn / nameAr style labels — single parenthesised English word.
    "الاسم (إنجليزي)",
  ];
  for (const value of legitimate) {
    assert.equal(classifyArabicValue(value), "ok", `expected "${value}" to be clean`);
  }
});

test("classifyArabicValue keeps non-prose samples (email/url/identifier/mask) clean", () => {
  for (const value of [
    "hello@thaddi.app", // email sample
    "https://thaddi.app", // url sample
    "user.update", // dotted identifier sample
    "ali_q", // snake_case identifier sample
    "05XXXXXXXX", // phone input mask
    "THADDI", // brand name only
  ]) {
    assert.equal(classifyArabicValue(value), "ok", `expected "${value}" to be clean`);
  }
});

// --------------------------------------------------------------------------
// untranslatedWords / looksLikeEnglish / isProseWord — pure-English detection
// --------------------------------------------------------------------------
test("untranslatedWords returns the genuine English prose words", () => {
  assert.deepEqual(untranslatedWords("Save changes"), ["Save", "changes"]);
  assert.deepEqual(untranslatedWords("Match predictions"), ["Match", "predictions"]);
});

test("untranslatedWords ignores brand names and input masks", () => {
  assert.deepEqual(untranslatedWords("THADDI"), []);
  assert.deepEqual(untranslatedWords("05XXXXXXXX"), []);
  assert.deepEqual(untranslatedWords("Instagram TikTok WhatsApp"), []);
});

test("untranslatedWords ignores numeric/punctuation-only values", () => {
  assert.deepEqual(untranslatedWords("123 - 456"), []);
  assert.deepEqual(untranslatedWords("—"), []);
});

test("looksLikeEnglish is true for prose and false for brand/mask-only", () => {
  assert.equal(looksLikeEnglish("Save changes"), true);
  assert.equal(looksLikeEnglish("THADDI"), false);
  assert.equal(looksLikeEnglish("05XXXXXXXX"), false);
});

test("isProseWord excludes brand names and masks but keeps real words", () => {
  assert.equal(isProseWord("Save"), true);
  assert.equal(isProseWord("THADDI"), false);
  assert.equal(isProseWord("thaddi"), false); // case-insensitive
  assert.equal(isProseWord("XXXX"), false);
});

// --------------------------------------------------------------------------
// containsArabic
// --------------------------------------------------------------------------
test("containsArabic detects Arabic script and Arabic-Indic digits", () => {
  assert.equal(containsArabic("مرحباً"), true);
  assert.equal(containsArabic("١٢٣"), true); // Arabic-Indic digits
  assert.equal(containsArabic("Hello"), false);
  assert.equal(containsArabic("123"), false);
});

// --------------------------------------------------------------------------
// longestEnglishRun — measures the longest forgotten English clause
// --------------------------------------------------------------------------
test("longestEnglishRun counts a forgotten clause but not isolated terms", () => {
  // One-off technical terms inside Arabic stay at a run of 1 (below threshold).
  assert.ok(longestEnglishRun("المعرّف (slug)") < MIXED_RUN_THRESHOLD);
  assert.ok(longestEnglishRun("عنوان IP") < MIXED_RUN_THRESHOLD);
  // A forgotten clause reaches the threshold.
  assert.ok(longestEnglishRun("توقّعاتك now open for predictions") >= MIXED_RUN_THRESHOLD);
});

test("longestEnglishRun treats placeholders, identifiers, urls and emails as transparent breaks", () => {
  // Placeholder tokens are removed and do not count as prose.
  assert.equal(longestEnglishRun("عرض {from}–{to} من {total}"), 0);
  // Dotted identifiers / emails / urls never contribute prose words.
  assert.ok(longestEnglishRun("الإجراء (مثال: user.update)") < MIXED_RUN_THRESHOLD);
  assert.ok(longestEnglishRun("راسلنا hello@thaddi.app") < MIXED_RUN_THRESHOLD);
  assert.ok(longestEnglishRun("الموقع https://thaddi.app") < MIXED_RUN_THRESHOLD);
});

test("longestEnglishRun is broken by Arabic characters between English words", () => {
  // "save" then Arabic then "changes" → two runs of 1, not a run of 2.
  assert.ok(longestEnglishRun("save مرحباً changes") < 2);
});

test("longestEnglishRun ignores brand names without breaking the run", () => {
  // THADDI is transparent: "open for THADDI predictions" is still a run of 3.
  assert.ok(longestEnglishRun("افتح open for THADDI predictions الآن") >= MIXED_RUN_THRESHOLD);
});

// --------------------------------------------------------------------------
// isNonProseSample — identifier/email/url shaped values that are NOT prose
// --------------------------------------------------------------------------
test("isNonProseSample is true for single-token identifier/email/url samples", () => {
  assert.equal(isNonProseSample("hello@thaddi.app"), true);
  assert.equal(isNonProseSample("https://thaddi.app"), true);
  assert.equal(isNonProseSample("www.thaddi.app"), true);
  assert.equal(isNonProseSample("user.update"), true);
  assert.equal(isNonProseSample("ali_q"), true);
  assert.equal(isNonProseSample(""), true);
});

test("isNonProseSample is false for multi-word prose", () => {
  assert.equal(isNonProseSample("Save changes"), false);
  assert.equal(isNonProseSample("Match predictions are open"), false);
});
