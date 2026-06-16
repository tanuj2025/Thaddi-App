// Lightweight chat profanity filter (Apple App Store Guideline 1.2: a method
// for filtering objectionable content). Matching is token-based with word
// boundaries so legitimate words that merely contain a short profanity as a
// substring (e.g. "assassin", "Scunthorpe") are NOT masked. Detection is
// resilient to common evasion: Unicode NFKC folding, Arabic diacritics/tatweel
// removal, case folding, and collapsing 3+ repeated characters ("fuuuck").

// Curated, intentionally small base lists. Kept deliberately conservative to
// avoid false positives; extend cautiously.
const EN_WORDS = [
  "fuck",
  "fucker",
  "fucking",
  "motherfucker",
  "shit",
  "bullshit",
  "bitch",
  "bastard",
  "asshole",
  "dickhead",
  "cunt",
  "whore",
  "slut",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "wanker",
  "pussy",
];

// Common Arabic insults/obscenities (and a couple of frequent transliterations).
const AR_WORDS = [
  "كس",
  "كسم",
  "كسمك",
  "طيز",
  "زب",
  "زبي",
  "خرا",
  "خره",
  "عرص",
  "عرصة",
  "شرموط",
  "شرموطة",
  "قحبة",
  "قحبه",
  "منيك",
  "منيوك",
  "متناك",
  "نيك",
  "نيكك",
  "كلب",
  "حقير",
  "وسخ",
  "خول",
  "لوطي",
  "زاني",
  "زانية",
  "عاهرة",
  "عاهره",
  "ابن المتناكة",
  "kos",
  "kosomak",
  "sharmota",
];

// Strip Arabic short vowels (harakat), maddah/superscript marks, and tatweel,
// then NFKC-fold and lowercase. Used for BOTH the wordlist and each input token
// so comparisons happen in the same normalized space.
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;

export function normalizeForProfanity(input: string): string {
  return input
    .normalize("NFKC")
    .replace(TATWEEL, "")
    .replace(ARABIC_MARKS, "")
    .toLowerCase();
}

// Collapse runs of 3+ identical characters down to one ("fuuuuck" -> "fuck",
// "خرااااا" -> "خرا"). Two repeats are left intact to limit over-collapsing.
function collapseRepeats(token: string): string {
  return token.replace(/(.)\1{2,}/gu, "$1");
}

const NORMALIZED_WORDS: Set<string> = new Set(
  [...EN_WORDS, ...AR_WORDS]
    .map((w) => collapseRepeats(normalizeForProfanity(w)))
    .filter(Boolean),
);

// Multi-word phrases (contain a space after normalization) are matched against
// the whole normalized text rather than per-token.
const NORMALIZED_PHRASES: string[] = [...NORMALIZED_WORDS].filter((w) =>
  w.includes(" "),
);

// A "word" run: any sequence of letters, combining marks, or digits across
// scripts. Punctuation/whitespace are treated as boundaries (and preserved).
const WORD_RE = /[\p{L}\p{M}\p{N}]+/gu;

function tokenIsProfane(token: string): boolean {
  const norm = collapseRepeats(normalizeForProfanity(token));
  if (!norm) return false;
  return NORMALIZED_WORDS.has(norm);
}

// Returns true if the text contains any masked-worthy profanity.
export function containsProfanity(text: string): boolean {
  const normalizedText = collapseRepeats(normalizeForProfanity(text));
  for (const phrase of NORMALIZED_PHRASES) {
    if (normalizedText.includes(phrase)) return true;
  }
  for (const m of text.matchAll(WORD_RE)) {
    if (tokenIsProfane(m[0])) return true;
  }
  return false;
}

// Replaces each profane token with asterisks of the same visible length,
// preserving surrounding text, punctuation, and spacing. Multi-word phrases are
// masked as a unit.
export function maskProfanity(text: string): string {
  let out = text;

  // Phrase masking first: replace each occurrence (case/diacritic-insensitive)
  // with asterisks spanning the matched original substring.
  for (const phrase of NORMALIZED_PHRASES) {
    const wordCount = phrase.split(" ").length;
    out = maskPhrase(out, wordCount, phrase);
  }

  // Then per-token masking.
  out = out.replace(WORD_RE, (token) =>
    tokenIsProfane(token) ? "*".repeat(token.length) : token,
  );
  return out;
}

// Scans windows of `wordCount` consecutive word-tokens; when a window's
// normalized form equals `normalizedPhrase`, masks the whole span (including the
// inner whitespace) with asterisks of equal length.
function maskPhrase(
  text: string,
  wordCount: number,
  normalizedPhrase: string,
): string {
  const tokens = [...text.matchAll(WORD_RE)];
  if (tokens.length < wordCount) return text;
  let result = text;
  // Walk right-to-left so earlier indices stay valid after replacement.
  for (let i = tokens.length - wordCount; i >= 0; i--) {
    const first = tokens[i];
    const last = tokens[i + wordCount - 1];
    const start = first.index;
    const end = last.index + last[0].length;
    const span = result.slice(start, end);
    const normSpan = collapseRepeats(normalizeForProfanity(span)).replace(
      /\s+/g,
      " ",
    );
    if (normSpan === normalizedPhrase) {
      result = result.slice(0, start) + "*".repeat(end - start) + result.slice(end);
    }
  }
  return result;
}

// Exposed for tests / diagnostics.
export const PROFANITY_WORD_COUNT = NORMALIZED_WORDS.size;
