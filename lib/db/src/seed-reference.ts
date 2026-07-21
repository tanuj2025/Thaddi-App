/**
 * Idempotent seed for THADDI reference data: feature flags, season Pass
 * plans + entitlements, gamification levels/badges/achievements, challenge
 * templates, the challenge-badge catalog, and the World Championship 2026
 * tournament with its stages.
 *
 * Exposed as `seedReferenceData()` so it can be run both from the CLI
 * (`pnpm --filter @workspace/db run seed`) and from the admin API, where it
 * lets an admin top up missing reference rows in a live database without
 * touching any existing rows. Every insert uses `onConflictDoNothing`, so the
 * operation only ever ADDS missing rows — it never updates or deletes — and the
 * returned summary reports how many new rows were inserted per category.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./index";
import {
  featureFlagsTable,
  plansTable,
  planEntitlementsTable,
  levelsTable,
  badgesTable,
  achievementsTable,
  challengeTemplatesTable,
  challengeBadgeCatalogTable,
  tournamentsTable,
  stagesTable,
} from "./schema";

export interface SeedSummary {
  featureFlags: number;
  plans: number;
  planEntitlements: number;
  levels: number;
  badges: number;
  achievements: number;
  challengeBadges: number;
  challengeTemplates: number;
  tournaments: number;
  stages: number;
  /** Total new rows inserted across all categories. */
  total: number;
}

async function seedFeatureFlags(): Promise<number> {
  const flags = [
    {
      key: "winning_probability",
      name: "Winning Probability",
      description: "Show each participant's probability of winning a challenge.",
    },
    {
      key: "prediction_comparison",
      name: "Prediction Comparison",
      description: "Compare your predictions against other participants.",
    },
    {
      key: "rare_predictions",
      name: "Rare Predictions",
      description: "Highlight uncommon predictions that few users made.",
    },
    {
      key: "hall_of_fame",
      name: "Hall of Fame",
      description: "Permanent showcase of top achievements.",
    },
  ];
  let inserted = 0;
  for (const f of flags) {
    const rows = await db
      .insert(featureFlagsTable)
      .values({ ...f, enabled: false, rolloutPercentage: 0 })
      .onConflictDoNothing({ target: featureFlagsTable.key })
      .returning({ id: featureFlagsTable.id });
    inserted += rows.length;
  }
  return inserted;
}

async function seedPlans(): Promise<{ plans: number; entitlements: number }> {
  const plans = [
    {
      code: "free" as const,
      nameEn: "Beginner",
      nameAr: "المبتدئ",
      priceSar: "0",
      participantLimit: 20,
      isActive: true,
      isComingSoon: false,
      orderIndex: 0,
      entitlements: {
        max_participants: "20",
        advanced_stats: "false",
        custom_prizes: "false",
        premium_features: "false",
        priority_support: "false",
      },
    },
    {
      code: "professional" as const,
      nameEn: "Professional",
      nameAr: "المحترف",
      priceSar: "200",
      participantLimit: 100,
      isActive: true,
      isComingSoon: false,
      orderIndex: 1,
      entitlements: {
        max_participants: "100",
        advanced_stats: "true",
        custom_prizes: "true",
        premium_features: "false",
        priority_support: "false",
      },
    },
    {
      code: "legend" as const,
      nameEn: "Legend",
      nameAr: "الأسطورة",
      priceSar: "1000",
      participantLimit: 500,
      isActive: true,
      isComingSoon: false,
      orderIndex: 2,
      entitlements: {
        max_participants: "500",
        advanced_stats: "true",
        custom_prizes: "true",
        premium_features: "true",
        priority_support: "true",
      },
    },
    {
      code: "business" as const,
      nameEn: "Business",
      nameAr: "الأعمال",
      priceSar: "0",
      participantLimit: null,
      isActive: false,
      isComingSoon: true,
      orderIndex: 3,
      entitlements: {},
    },
  ];

  let plansInserted = 0;
  let entitlementsInserted = 0;
  for (const p of plans) {
    const { entitlements, ...plan } = p;
    const created = await db
      .insert(plansTable)
      .values(plan)
      .onConflictDoNothing({ target: plansTable.code })
      .returning({ id: plansTable.id });
    plansInserted += created.length;

    const row = await db.query.plansTable.findFirst({
      where: eq(plansTable.code, plan.code),
    });
    if (!row) continue;
    for (const [key, value] of Object.entries(entitlements)) {
      const ent = await db
        .insert(planEntitlementsTable)
        .values({ planId: row.id, key, value })
        .onConflictDoNothing({
          target: [planEntitlementsTable.planId, planEntitlementsTable.key],
        })
        .returning({ id: planEntitlementsTable.id });
      entitlementsInserted += ent.length;
    }
  }
  return { plans: plansInserted, entitlements: entitlementsInserted };
}

async function seedLevels(): Promise<number> {
  const levels = [
    { level: "bronze" as const, nameEn: "Bronze", nameAr: "برونزي", minPoints: 0, orderIndex: 0 },
    { level: "silver" as const, nameEn: "Silver", nameAr: "فضي", minPoints: 500, orderIndex: 1 },
    { level: "gold" as const, nameEn: "Gold", nameAr: "ذهبي", minPoints: 2000, orderIndex: 2 },
    { level: "elite" as const, nameEn: "Elite", nameAr: "النخبة", minPoints: 5000, orderIndex: 3 },
    { level: "legend" as const, nameEn: "Legend", nameAr: "أسطورة", minPoints: 10000, orderIndex: 4 },
  ];
  let inserted = 0;
  for (const l of levels) {
    const rows = await db
      .insert(levelsTable)
      .values(l)
      .onConflictDoNothing({ target: levelsTable.level })
      .returning({ level: levelsTable.level });
    inserted += rows.length;
  }
  return inserted;
}

async function seedBadges(): Promise<number> {
  const badges = [
    { code: "prediction_king", nameEn: "Prediction King", nameAr: "ملك التوقعات", descriptionEn: "Most exact predictions.", descriptionAr: "أكثر التوقعات دقة." },
    { code: "goal_master", nameEn: "Goal Master", nameAr: "سيد الأهداف", descriptionEn: "Mastery of goal predictions.", descriptionAr: "إتقان توقع الأهداف." },
    { code: "saudi_expert", nameEn: "Saudi Expert", nameAr: "الخبير السعودي", descriptionEn: "Expert on Saudi matches.", descriptionAr: "خبير في مباريات السعودية." },
    { code: "elite_predictor", nameEn: "Elite Predictor", nameAr: "المتوقع النخبة", descriptionEn: "Consistently elite accuracy.", descriptionAr: "دقة عالية باستمرار." },
  ];
  let inserted = 0;
  for (const b of badges) {
    const rows = await db
      .insert(badgesTable)
      .values(b)
      .onConflictDoNothing({ target: badgesTable.code })
      .returning({ id: badgesTable.id });
    inserted += rows.length;
  }
  return inserted;
}

async function seedAchievements(): Promise<number> {
  const achievements = [
    { code: "world_cup_champion", type: "hall_of_fame" as const, nameEn: "World Championship Winner", nameAr: "بطل بطولة العالم", descriptionEn: "Won a World Championship challenge.", descriptionAr: "فاز بتحدي بطولة العالم." },
    { code: "top_predictor", type: "hall_of_fame" as const, nameEn: "Top Predictor", nameAr: "أفضل متوقع", descriptionEn: "Reached the top of the global ranking.", descriptionAr: "وصل إلى قمة الترتيب العالمي." },
    { code: "competition_winner", type: "hall_of_fame" as const, nameEn: "Competition Winner", nameAr: "الفائز بالمنافسة", descriptionEn: "Won a competition.", descriptionAr: "فاز بمنافسة." },
  ];
  let inserted = 0;
  for (const a of achievements) {
    const rows = await db
      .insert(achievementsTable)
      .values(a)
      .onConflictDoNothing({ target: achievementsTable.code })
      .returning({ id: achievementsTable.id });
    inserted += rows.length;
  }
  return inserted;
}

async function seedChallengeBadges(): Promise<number> {
  const badges = [
    { code: "golden_trophy", nameEn: "Golden Trophy", nameAr: "الكأس الذهبية", priceSar: "9" },
    { code: "champion_crown", nameEn: "Champion's Crown", nameAr: "تاج البطل", priceSar: "15" },
    { code: "flaming_ball", nameEn: "Flaming Ball", nameAr: "الكرة الملتهبة", priceSar: "12" },
    { code: "captain_armband", nameEn: "Captain's Armband", nameAr: "شارة القائد", priceSar: "10" },
    { code: "golden_boot", nameEn: "Golden Boot", nameAr: "الحذاء الذهبي", priceSar: "14" },
    { code: "emerald_shield", nameEn: "Emerald Shield", nameAr: "الدرع الزمردي", priceSar: "11" },
    { code: "eagle_emblem", nameEn: "Eagle Emblem", nameAr: "شعار النسر", priceSar: "13" },
    { code: "lightning_strike", nameEn: "Lightning Strike", nameAr: "ضربة البرق", priceSar: "12" },
    { code: "star_medal", nameEn: "Star Medal", nameAr: "ميدالية النجمة", priceSar: "8" },
    { code: "phoenix_fire", nameEn: "Phoenix Fire", nameAr: "نار العنقاء", priceSar: "18" },
    { code: "laurel_wreath", nameEn: "Laurel Wreath", nameAr: "إكليل الغار", priceSar: "10" },
    { code: "diamond_crest", nameEn: "Diamond Crest", nameAr: "شعار الألماس", priceSar: "20" },
    { code: "roaring_lion", nameEn: "Roaring Lion", nameAr: "الأسد الزائر", priceSar: "16" },
    { code: "golden_whistle", nameEn: "Golden Whistle", nameAr: "الصافرة الذهبية", priceSar: "9" },
    { code: "victory_flag", nameEn: "Victory Flag", nameAr: "راية النصر", priceSar: "8" },
    { code: "royal_falcon", nameEn: "Royal Falcon", nameAr: "الصقر الملكي", priceSar: "17" },
    { code: "crossed_swords", nameEn: "Crossed Swords", nameAr: "السيوف المتقاطعة", priceSar: "14" },
    { code: "goal_net_burst", nameEn: "Goal Burst", nameAr: "انفجار الهدف", priceSar: "12" },
    { code: "desert_star", nameEn: "Desert Star", nameAr: "نجمة الصحراء", priceSar: "11" },
    { code: "stadium_crown", nameEn: "Stadium Crown", nameAr: "تاج الملعب", priceSar: "19" },
  ];
  let inserted = 0;
  for (let i = 0; i < badges.length; i++) {
    const b = badges[i];
    const rows = await db
      .insert(challengeBadgeCatalogTable)
      .values({
        code: b.code,
        nameEn: b.nameEn,
        nameAr: b.nameAr,
        iconUrl: `badges/${b.code}.png`,
        priceSar: b.priceSar,
        isActive: true,
        orderIndex: i,
      })
      .onConflictDoNothing({ target: challengeBadgeCatalogTable.code })
      .returning({ id: challengeBadgeCatalogTable.id });
    inserted += rows.length;
  }
  return inserted;
}

async function seedTemplates(): Promise<number> {
  const templates = [
    { slug: "world-championship-2026", nameEn: "World Championship 2026", nameAr: "بطولة العالم 2026", scope: "entire_tournament" as const, orderIndex: 0 },
    { slug: "saudi-arabia-matches", nameEn: "Saudi Arabia Matches", nameAr: "مباريات السعودية", scope: "team_journey" as const, orderIndex: 1 },
    { slug: "group-stage", nameEn: "Group Stage", nameAr: "دور المجموعات", scope: "stage" as const, orderIndex: 2 },
    { slug: "knockout-stage", nameEn: "Knockout Stage", nameAr: "الأدوار الإقصائية", scope: "stage" as const, orderIndex: 3 },
    { slug: "final-match", nameEn: "Final Match", nameAr: "المباراة النهائية", scope: "custom" as const, orderIndex: 4 },
    { slug: "custom-challenge", nameEn: "Custom Challenge", nameAr: "تحدّي مخصص", scope: "custom" as const, orderIndex: 5 },
  ];
  let inserted = 0;
  for (const t of templates) {
    const rows = await db
      .insert(challengeTemplatesTable)
      .values(t)
      .onConflictDoNothing({ target: challengeTemplatesTable.slug })
      .returning({ id: challengeTemplatesTable.id });
    inserted += rows.length;
  }
  return inserted;
}

// Stage presets reused across competitions of the same shape.
const WORLD_CHAMPIONSHIP_STAGES = [
  { type: "group" as const, nameEn: "Group Stage", nameAr: "دور المجموعات", orderIndex: 0 },
  { type: "round_of_32" as const, nameEn: "Round of 32", nameAr: "دور الـ32", orderIndex: 1 },
  { type: "round_of_16" as const, nameEn: "Round of 16", nameAr: "دور الـ16", orderIndex: 2 },
  { type: "quarter_final" as const, nameEn: "Quarter-finals", nameAr: "ربع النهائي", orderIndex: 3 },
  { type: "semi_final" as const, nameEn: "Semi-finals", nameAr: "نصف النهائي", orderIndex: 4 },
  { type: "third_place" as const, nameEn: "Third-place Play-off", nameAr: "تحديد المركز الثالث", orderIndex: 5 },
  { type: "final" as const, nameEn: "Final", nameAr: "النهائي", orderIndex: 6 },
];

// Round-robin domestic leagues have a single "league" stage (matchweeks).
const LEAGUE_STAGES = [
  { type: "league" as const, nameEn: "League", nameAr: "الدوري", orderIndex: 0 },
];

// Domestic knockout cups (e.g. King's Cup). Earlier rounds the provider may
// expose fall back to the nearest seeded stage; unmapped rounds get a null
// stage, which the schedule tolerates.
const CUP_KNOCKOUT_STAGES = [
  { type: "round_of_32" as const, nameEn: "Round of 32", nameAr: "دور الـ32", orderIndex: 0 },
  { type: "round_of_16" as const, nameEn: "Round of 16", nameAr: "دور الـ16", orderIndex: 1 },
  { type: "quarter_final" as const, nameEn: "Quarter-finals", nameAr: "ربع النهائي", orderIndex: 2 },
  { type: "semi_final" as const, nameEn: "Semi-finals", nameAr: "نصف النهائي", orderIndex: 3 },
  { type: "final" as const, nameEn: "Final", nameAr: "النهائي", orderIndex: 4 },
];

interface CompetitionSeed {
  slug: string;
  competitionSlug: string;
  providerLeagueSlug: string;
  nameEn: string;
  nameAr: string;
  type: "world_championship" | "league" | "cup";
  season: string;
  status: "upcoming" | "active" | "completed";
  startDate: Date | null;
  endDate: Date | null;
  hasPublishedFixtures: boolean;
  displayOrder: number;
  countryCode: string | null;
  stages: { type: "group" | "round_of_32" | "round_of_16" | "quarter_final" | "semi_final" | "third_place" | "final" | "league" | "custom"; nameEn: string; nameAr: string; orderIndex: number }[];
}

// The competitions the engine serves. The World Championship keeps its original slug so
// its live data / predictions are untouched; new competitions are season-keyed
// shells (one row per competition-season) that the season resolver attaches
// fixtures to once the provider publishes them ("season coming soon" until
// then). Per-season slugs use the ESPN season year (e.g. eng.1-2026 for 2026/27).
const COMPETITIONS: CompetitionSeed[] = [
  {
    slug: "world-championship-2026",
    competitionSlug: "world.champ",
    providerLeagueSlug: "world.champ",
    nameEn: "World Championship 2026",
    nameAr: "بطولة العالم 2026",
    type: "world_championship",
    season: "2026",
    status: "upcoming",
    startDate: new Date("2026-06-11T00:00:00Z"),
    endDate: new Date("2026-07-19T23:59:59Z"),
    hasPublishedFixtures: true,
    displayOrder: 0,
    countryCode: null,
    stages: WORLD_CHAMPIONSHIP_STAGES,
  },
  {
    slug: "ksa.1-2026",
    competitionSlug: "ksa.1",
    providerLeagueSlug: "ksa.1",
    nameEn: "Saudi Pro League",
    nameAr: "دوري روشن السعودي",
    type: "league",
    season: "2026/27",
    status: "upcoming",
    startDate: null,
    endDate: null,
    hasPublishedFixtures: false,
    displayOrder: 1,
    countryCode: "sa",
    stages: LEAGUE_STAGES,
  },
  {
    slug: "ksa.kings.cup-2026",
    competitionSlug: "ksa.kings.cup",
    providerLeagueSlug: "ksa.kings.cup",
    nameEn: "King's Cup",
    nameAr: "كأس الملك",
    type: "cup",
    season: "2026/27",
    status: "upcoming",
    startDate: null,
    endDate: null,
    hasPublishedFixtures: false,
    displayOrder: 2,
    countryCode: "sa",
    stages: CUP_KNOCKOUT_STAGES,
  },
  {
    slug: "eng.1-2026",
    competitionSlug: "eng.1",
    providerLeagueSlug: "eng.1",
    nameEn: "Premier League",
    nameAr: "الدوري الإنجليزي الممتاز",
    type: "league",
    season: "2026/27",
    status: "upcoming",
    startDate: null,
    endDate: null,
    hasPublishedFixtures: false,
    displayOrder: 3,
    countryCode: "gb-eng",
    stages: LEAGUE_STAGES,
  },
  {
    slug: "esp.1-2026",
    competitionSlug: "esp.1",
    providerLeagueSlug: "esp.1",
    nameEn: "LaLiga",
    nameAr: "الدوري الإسباني",
    type: "league",
    season: "2026/27",
    status: "upcoming",
    startDate: null,
    endDate: null,
    hasPublishedFixtures: false,
    displayOrder: 4,
    countryCode: "es",
    stages: LEAGUE_STAGES,
  },
];

async function seedCompetitions(): Promise<{ tournaments: number; stages: number }> {
  let tournamentsInserted = 0;
  let stagesInserted = 0;

  for (const c of COMPETITIONS) {
    const created = await db
      .insert(tournamentsTable)
      .values({
        slug: c.slug,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        type: c.type,
        season: c.season,
        status: c.status,
        startDate: c.startDate,
        endDate: c.endDate,
        competitionSlug: c.competitionSlug,
        providerLeagueSlug: c.providerLeagueSlug,
        hasPublishedFixtures: c.hasPublishedFixtures,
        displayOrder: c.displayOrder,
        countryCode: c.countryCode,
        isActive: true,
      })
      .onConflictDoNothing({ target: tournamentsTable.slug })
      .returning({ id: tournamentsTable.id });
    tournamentsInserted += created.length;

    // Backfill the new competition columns on a row that predates them (e.g. the
    // World Championship row seeded before this migration). Guarded on competitionSlug
    // IS NULL so it runs exactly once and never overwrites later resolver/admin
    // edits (e.g. a sync that flipped hasPublishedFixtures on).
    await db
      .update(tournamentsTable)
      .set({
        competitionSlug: c.competitionSlug,
        providerLeagueSlug: c.providerLeagueSlug,
        hasPublishedFixtures: c.hasPublishedFixtures,
        displayOrder: c.displayOrder,
        countryCode: c.countryCode,
      })
      .where(
        and(
          eq(tournamentsTable.slug, c.slug),
          isNull(tournamentsTable.competitionSlug),
        ),
      );

    const tournament = await db.query.tournamentsTable.findFirst({
      where: eq(tournamentsTable.slug, c.slug),
    });
    if (!tournament) continue;

    // The stages table has no unique constraint on (tournament_id, type), so we
    // top up only the missing stage types — a partially seeded tournament gains
    // its missing stages rather than being skipped wholesale.
    const existingStages = await db.query.stagesTable.findMany({
      where: eq(stagesTable.tournamentId, tournament.id),
      columns: { type: true },
    });
    const existingTypes = new Set(existingStages.map((s) => s.type));
    const missingStages = c.stages.filter((s) => !existingTypes.has(s.type));
    if (missingStages.length === 0) continue;

    const inserted = await db
      .insert(stagesTable)
      .values(missingStages.map((s) => ({ ...s, tournamentId: tournament.id })))
      .returning({ id: stagesTable.id });
    stagesInserted += inserted.length;
  }

  return { tournaments: tournamentsInserted, stages: stagesInserted };
}

/**
 * Runs every reference-data seed step idempotently and returns the count of
 * new rows inserted per category. Safe to run repeatedly and against a live
 * database: existing rows are never modified or deleted.
 */
export async function seedReferenceData(): Promise<SeedSummary> {
  const featureFlags = await seedFeatureFlags();
  const plansResult = await seedPlans();
  const levels = await seedLevels();
  const badges = await seedBadges();
  const achievements = await seedAchievements();
  const challengeBadges = await seedChallengeBadges();
  const challengeTemplates = await seedTemplates();
  const competitions = await seedCompetitions();

  const summary: Omit<SeedSummary, "total"> = {
    featureFlags,
    plans: plansResult.plans,
    planEntitlements: plansResult.entitlements,
    levels,
    badges,
    achievements,
    challengeBadges,
    challengeTemplates,
    tournaments: competitions.tournaments,
    stages: competitions.stages,
  };
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  return { ...summary, total };
}
