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

// Normalize an English team name for lookup (lowercase, strip accents/punct,
// collapse whitespace). Collapsing matters for club names where stripped
// punctuation leaves double spaces, e.g. "Brighton & Hove Albion".
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
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
  "congo dr": { ar: "الكونغو الديمقراطية", cc: "cd" },
  bolivia: { ar: "بوليفيا", cc: "bo" },
  venezuela: { ar: "فنزويلا", cc: "ve" },
  // Name variants that differ between providers (football-data vs ESPN), so the
  // same nation enriches + reconciles to one row instead of duplicating.
  "cape verde islands": { ar: "الرأس الأخضر", cc: "cv" },
  bosniaherzegovina: { ar: "البوسنة والهرسك", cc: "ba" },
  "bosnia and herzegovina": { ar: "البوسنة والهرسك", cc: "ba" },
  curacao: { ar: "كوراساو", cc: "cw" },
  haiti: { ar: "هايتي", cc: "ht" },
};

// Look up the curated Arabic name + ISO country code for an English team name.
// Returns undefined for teams not in the curated map.
export function lookupTeamI18n(nameEn: string | null | undefined): TeamI18n | undefined {
  if (!nameEn) return undefined;
  return TEAM_I18N[normalizeName(nameEn)];
}

// Curated Arabic names for CLUBS (domestic leagues + cups). Unlike nations,
// clubs keep their provider-supplied crest and the league's country code — only
// the Arabic display name is curated here. Saudi Pro League clubs are covered
// in full (Arabic-first audience); the most-followed Premier League and LaLiga
// clubs are included, and any club not listed falls back to its English name.
// Keyed by normalizeName() of the provider's English club name.
export const CLUB_I18N: Record<string, string> = {
  // --- Saudi Pro League (ksa.1) ---
  "al hilal": "الهلال",
  "al nassr": "النصر",
  "al ittihad": "الاتحاد",
  "al ahli": "الأهلي",
  "al ahli saudi": "الأهلي",
  "al shabab": "الشباب",
  "al ettifaq": "الاتفاق",
  "al taawoun": "التعاون",
  "al fateh": "الفتح",
  "al fayha": "الفيحاء",
  "al feiha": "الفيحاء",
  "al khaleej": "الخليج",
  "al riyadh": "الرياض",
  "al wehda": "الوحدة",
  "al okhdood": "الأخدود",
  "al akhdoud": "الأخدود",
  "al hazem": "الحزم",
  "al raed": "الرائد",
  damac: "ضمك",
  "al qadsiah": "القادسية",
  "al qadisiyah": "القادسية",
  "al orobah": "العروبة",
  "al kholood": "الخلود",
  neom: "نيوم",
  "neom sc": "نيوم",
  "al najma": "النجمة",
  // --- Premier League (eng.1) ---
  arsenal: "آرسنال",
  "aston villa": "أستون فيلا",
  bournemouth: "بورنموث",
  "afc bournemouth": "بورنموث",
  brentford: "برنتفورد",
  "brighton hove albion": "برايتون",
  brighton: "برايتون",
  chelsea: "تشيلسي",
  "crystal palace": "كريستال بالاس",
  everton: "إيفرتون",
  fulham: "فولهام",
  liverpool: "ليفربول",
  "manchester city": "مانشستر سيتي",
  "manchester united": "مانشستر يونايتد",
  "newcastle united": "نيوكاسل يونايتد",
  "nottingham forest": "نوتنغهام فورست",
  "tottenham hotspur": "توتنهام",
  tottenham: "توتنهام",
  "west ham united": "وست هام يونايتد",
  "wolverhampton wanderers": "وولفرهامبتون",
  wolves: "وولفرهامبتون",
  "leeds united": "ليدز يونايتد",
  burnley: "بيرنلي",
  sunderland: "سندرلاند",
  "leicester city": "ليستر سيتي",
  "ipswich town": "إيبسويتش تاون",
  southampton: "ساوثهامبتون",
  // --- LaLiga (esp.1) ---
  "real madrid": "ريال مدريد",
  barcelona: "برشلونة",
  "fc barcelona": "برشلونة",
  "atletico madrid": "أتلتيكو مدريد",
  "atletico de madrid": "أتلتيكو مدريد",
  sevilla: "إشبيلية",
  "real betis": "ريال بيتيس",
  "real sociedad": "ريال سوسيداد",
  "athletic club": "أتلتيك بلباو",
  villarreal: "فياريال",
  valencia: "فالنسيا",
  girona: "جيرونا",
  "celta vigo": "سيلتا فيغو",
  celta: "سيلتا فيغو",
  osasuna: "أوساسونا",
  "rayo vallecano": "رايو فايكانو",
  getafe: "خيتافي",
  mallorca: "مايوركا",
  "rcd mallorca": "مايوركا",
  "las palmas": "لاس بالماس",
  alaves: "ألافيس",
  "deportivo alaves": "ألافيس",
  espanyol: "إسبانيول",
  "rcd espanyol": "إسبانيول",
  leganes: "ليغانيس",
  "real valladolid": "بلد الوليد",
  elche: "إلتشي",
  levante: "ليفانتي",
  "real oviedo": "ريال أوفييدو",
};

// Look up the curated Arabic name for an English CLUB name. Returns undefined
// for clubs not in the curated map (caller falls back to the English name).
export function lookupClubI18n(nameEn: string | null | undefined): string | undefined {
  if (!nameEn) return undefined;
  return CLUB_I18N[normalizeName(nameEn)];
}
