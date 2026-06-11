// Curated bilingual (English → Arabic + flag) lookup for World Cup nations.
// THADDI is Arabic-first, but most providers (football-data.org, ESPN) return
// English team names only, so every provider enriches its teams through this
// shared map. Keyed by a normalized English name, with aliases for the name
// variants different providers use. Unknown teams fall back to the English name
// and the provider-supplied crest/logo.

export interface TeamI18n {
  ar: string;
  cc: string; // ISO 3166-1 alpha-2 (flagcdn), or gb-eng/gb-wls/gb-sct.
}

// Normalize an English country name for lookup (lowercase, strip accents/punct).
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
}

export function flag(cc: string): string {
  return `https://flagcdn.com/w160/${cc}.png`;
}

export const TEAM_I18N: Record<string, TeamI18n> = {
  "saudi arabia": { ar: "السعودية", cc: "sa" },
  argentina: { ar: "الأرجنتين", cc: "ar" },
  brazil: { ar: "البرازيل", cc: "br" },
  france: { ar: "فرنسا", cc: "fr" },
  mexico: { ar: "المكسيك", cc: "mx" },
  japan: { ar: "اليابان", cc: "jp" },
  morocco: { ar: "المغرب", cc: "ma" },
  portugal: { ar: "البرتغال", cc: "pt" },
  spain: { ar: "إسبانيا", cc: "es" },
  germany: { ar: "ألمانيا", cc: "de" },
  england: { ar: "إنجلترا", cc: "gb-eng" },
  wales: { ar: "ويلز", cc: "gb-wls" },
  scotland: { ar: "اسكتلندا", cc: "gb-sct" },
  "united states": { ar: "الولايات المتحدة", cc: "us" },
  usa: { ar: "الولايات المتحدة", cc: "us" },
  canada: { ar: "كندا", cc: "ca" },
  netherlands: { ar: "هولندا", cc: "nl" },
  belgium: { ar: "بلجيكا", cc: "be" },
  croatia: { ar: "كرواتيا", cc: "hr" },
  italy: { ar: "إيطاليا", cc: "it" },
  uruguay: { ar: "الأوروغواي", cc: "uy" },
  colombia: { ar: "كولومبيا", cc: "co" },
  senegal: { ar: "السنغال", cc: "sn" },
  "south korea": { ar: "كوريا الجنوبية", cc: "kr" },
  "korea republic": { ar: "كوريا الجنوبية", cc: "kr" },
  switzerland: { ar: "سويسرا", cc: "ch" },
  denmark: { ar: "الدنمارك", cc: "dk" },
  poland: { ar: "بولندا", cc: "pl" },
  serbia: { ar: "صربيا", cc: "rs" },
  ecuador: { ar: "الإكوادور", cc: "ec" },
  ghana: { ar: "غانا", cc: "gh" },
  cameroon: { ar: "الكاميرون", cc: "cm" },
  tunisia: { ar: "تونس", cc: "tn" },
  algeria: { ar: "الجزائر", cc: "dz" },
  egypt: { ar: "مصر", cc: "eg" },
  nigeria: { ar: "نيجيريا", cc: "ng" },
  australia: { ar: "أستراليا", cc: "au" },
  iran: { ar: "إيران", cc: "ir" },
  "ir iran": { ar: "إيران", cc: "ir" },
  qatar: { ar: "قطر", cc: "qa" },
  "ivory coast": { ar: "ساحل العاج", cc: "ci" },
  "cote divoire": { ar: "ساحل العاج", cc: "ci" },
  mali: { ar: "مالي", cc: "ml" },
  norway: { ar: "النرويج", cc: "no" },
  sweden: { ar: "السويد", cc: "se" },
  austria: { ar: "النمسا", cc: "at" },
  turkey: { ar: "تركيا", cc: "tr" },
  turkiye: { ar: "تركيا", cc: "tr" },
  ukraine: { ar: "أوكرانيا", cc: "ua" },
  czechia: { ar: "التشيك", cc: "cz" },
  "czech republic": { ar: "التشيك", cc: "cz" },
  hungary: { ar: "المجر", cc: "hu" },
  greece: { ar: "اليونان", cc: "gr" },
  peru: { ar: "بيرو", cc: "pe" },
  chile: { ar: "تشيلي", cc: "cl" },
  paraguay: { ar: "باراغواي", cc: "py" },
  "costa rica": { ar: "كوستاريكا", cc: "cr" },
  panama: { ar: "بنما", cc: "pa" },
  jamaica: { ar: "جامايكا", cc: "jm" },
  honduras: { ar: "هندوراس", cc: "hn" },
  "new zealand": { ar: "نيوزيلندا", cc: "nz" },
  "south africa": { ar: "جنوب أفريقيا", cc: "za" },
  uzbekistan: { ar: "أوزبكستان", cc: "uz" },
  jordan: { ar: "الأردن", cc: "jo" },
  iraq: { ar: "العراق", cc: "iq" },
  "united arab emirates": { ar: "الإمارات", cc: "ae" },
  oman: { ar: "عمان", cc: "om" },
  "cape verde": { ar: "الرأس الأخضر", cc: "cv" },
  "cabo verde": { ar: "الرأس الأخضر", cc: "cv" },
  "dr congo": { ar: "الكونغو الديمقراطية", cc: "cd" },
  bolivia: { ar: "بوليفيا", cc: "bo" },
  venezuela: { ar: "فنزويلا", cc: "ve" },
};

// Look up the curated Arabic name + ISO country code for an English team name.
// Returns undefined for teams not in the curated map.
export function lookupTeamI18n(nameEn: string | null | undefined): TeamI18n | undefined {
  if (!nameEn) return undefined;
  return TEAM_I18N[normalizeName(nameEn)];
}
