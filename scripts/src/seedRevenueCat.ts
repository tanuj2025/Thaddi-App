import { getUncachableRevenueCatClient } from "./revenueCatClient";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

// THADDI sells a one-time all-access pass per tier (NOT a recurring
// subscription). RevenueCat is the purchase rail + verification only; the
// server (subscriptions table) is the source of truth for the granted plan.
//
// SEASON SCOPING: these products/entitlements are the LEGACY 2026 (World Cup)
// season pass. Their entitlement lookup_key is the bare plan code
// ("professional"/"legend"), which the server honors ONLY for the season_2026
// edition (see services/payments/revenuecat.ts + passSeason.ts). A future
// season's products must use a season-scoped lookup_key
// (`${edition}__${planCode}`, e.g. "season_2026_27__professional") so a 2026
// buyer's lifetime entitlement never unlocks a later season; add those tiers
// here when that season becomes purchasable.
const PROJECT_NAME = "thaddi App";

const APP_STORE_APP_NAME = "thaddi App (iOS)";
const APP_STORE_BUNDLE_ID = "app.thaddi";
const PLAY_STORE_APP_NAME = "thaddi App (Android)";
const PLAY_STORE_PACKAGE_NAME = "com.thaddi.app";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "World Cup 2026 Pass";

type Price = { amount_micros: number; currency: string };

// Each purchasable THADDI tier maps to one RevenueCat product (one per store),
// one entitlement whose lookup_key EQUALS the plan code (the server joins active
// entitlements -> plan code on this), and one package in the default offering.
// Prices are display-only: the server's upgrade/supersede logic always reads the
// THADDI plan's priceSar, never RevenueCat's price. SAR is the market currency;
// if the Test Store rejects SAR we fall back to USD at the riyal's fixed 3.75
// peg so the paywall always has a priceString to show.
type Tier = {
  planCode: string;
  storeIdentifier: string;
  displayName: string;
  title: string;
  entitlementLookupKey: string;
  entitlementDisplayName: string;
  packageIdentifier: string;
  packageDisplayName: string;
  priceSar: Price;
  priceUsd: Price;
};

const TIERS: Tier[] = [
  {
    planCode: "professional",
    storeIdentifier: "wc2026_professional",
    displayName: "Professional — World Cup 2026 Pass",
    title: "Professional Pass",
    entitlementLookupKey: "professional",
    entitlementDisplayName: "Professional Access",
    packageIdentifier: "professional",
    packageDisplayName: "Professional",
    priceSar: { amount_micros: 200_000_000, currency: "SAR" },
    priceUsd: { amount_micros: 53_330_000, currency: "USD" },
  },
  {
    planCode: "legend",
    storeIdentifier: "wc2026_legend",
    displayName: "Legend — World Cup 2026 Pass",
    title: "Legend Pass",
    entitlementLookupKey: "legend",
    entitlementDisplayName: "Legend Access",
    packageIdentifier: "legend",
    packageDisplayName: "Legend",
    priceSar: { amount_micros: 1_000_000_000, currency: "SAR" },
    priceUsd: { amount_micros: 266_670_000, currency: "USD" },
  },
];

type TestStorePricesResponse = {
  object: string;
  prices: Price[];
};

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: string }).type === "resource_already_exists"
  );
}

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  // ---- Project ----
  let project: Project;
  const { data: existingProjects, error: listProjectsError } =
    await listProjects({ client, query: { limit: 20 } });
  if (listProjectsError) throw new Error("Failed to list projects");

  const existingProject = existingProjects.items?.find(
    (p) => p.name === PROJECT_NAME,
  );
  if (existingProject) {
    console.log("Project already exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: newProject, error } = await createProject({
      client,
      body: { name: PROJECT_NAME },
    });
    if (error) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  // ---- Apps (test store comes pre-created with the project) ----
  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listAppsError || !apps || apps.items.length === 0) {
    throw new Error("No apps found");
  }

  const app: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find(
    (a) => a.type === "app_store",
  );
  let playStoreApp: App | undefined = apps.items.find(
    (a) => a.type === "play_store",
  );

  if (!app) throw new Error("No app with test store found");
  console.log("Test Store app found:", app.id);

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: APP_STORE_APP_NAME,
        type: "app_store",
        app_store: { bundle_id: APP_STORE_BUNDLE_ID },
      },
    });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app found:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: PLAY_STORE_APP_NAME,
        type: "play_store",
        play_store: { package_name: PLAY_STORE_PACKAGE_NAME },
      },
    });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app found:", playStoreApp.id);
  }

  // ---- Products ----
  const { data: existingProducts, error: listProductsError } =
    await listProducts({
      client,
      path: { project_id: project.id },
      query: { limit: 100 },
    });
  if (listProductsError) throw new Error("Failed to list products");

  const ensureProductForApp = async (
    targetApp: App,
    label: string,
    tier: Tier,
    isTestStore: boolean,
  ): Promise<Product> => {
    const existing = existingProducts.items?.find(
      (p) =>
        p.store_identifier === tier.storeIdentifier &&
        p.app_id === targetApp.id,
    );
    if (existing) {
      console.log(`  ${label} product already exists:`, existing.id);
      return existing;
    }

    // Edition pass = a permanent, restorable unlock (no renewal), so it is a
    // non-consumable one-time product. The Test Store only accepts
    // subscription/consumable/non_consumable (NOT "one_time"); RevenueCat stores
    // a non_consumable as a one-time product internally. The Test Store requires
    // a user-facing `title`. Play Store one-time identifiers are plain SKUs (the
    // {subscriptionId}:{basePlanId} format is subscription-only).
    const body: CreateProductData["body"] = {
      store_identifier: tier.storeIdentifier,
      app_id: targetApp.id,
      type: "non_consumable",
      display_name: tier.displayName,
    };
    if (isTestStore) body.title = tier.title;

    const { data: created, error } = await createProduct({
      client,
      path: { project_id: project.id },
      body,
    });
    if (error) throw new Error(`Failed to create ${label} product`);
    console.log(`  Created ${label} product:`, created.id);
    return created;
  };

  const addTestStorePrices = async (productId: string, tier: Tier) => {
    const tryPrices = async (prices: Price[]) =>
      client.post<TestStorePricesResponse>({
        url: "/projects/{project_id}/products/{product_id}/test_store_prices",
        path: { project_id: project.id, product_id: productId },
        body: { prices },
      });

    let { error } = await tryPrices([tier.priceSar]);
    if (!error) {
      console.log(`  Set test prices (SAR) for ${tier.planCode}`);
      return;
    }
    if (isAlreadyExists(error)) {
      console.log(`  Test prices already exist for ${tier.planCode}`);
      return;
    }
    console.warn(
      `  SAR price rejected for ${tier.planCode}, retrying in USD`,
      error,
    );
    ({ error } = await tryPrices([tier.priceUsd]));
    if (!error) {
      console.log(`  Set test prices (USD) for ${tier.planCode}`);
      return;
    }
    if (isAlreadyExists(error)) {
      console.log(`  Test prices already exist for ${tier.planCode}`);
      return;
    }
    throw new Error(`Failed to add test store prices for ${tier.planCode}`);
  };

  // ---- Existing entitlements / offerings (fetched once) ----
  const { data: existingEntitlements, error: listEntErr } =
    await listEntitlements({
      client,
      path: { project_id: project.id },
      query: { limit: 50 },
    });
  if (listEntErr) throw new Error("Failed to list entitlements");

  let offering: Offering | undefined;
  const { data: existingOfferings, error: listOffErr } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listOffErr) throw new Error("Failed to list offerings");
  offering = existingOfferings.items?.find(
    (o) => o.lookup_key === OFFERING_IDENTIFIER,
  );
  if (offering) {
    console.log("Offering already exists:", offering.id);
  } else {
    const { data: newOffering, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: {
        lookup_key: OFFERING_IDENTIFIER,
        display_name: OFFERING_DISPLAY_NAME,
      },
    });
    if (error) throw new Error("Failed to create offering");
    console.log("Created offering:", newOffering.id);
    offering = newOffering;
  }
  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current");
    console.log("Set offering as current");
  }

  const { data: existingPackages, error: listPkgErr } = await listPackages({
    client,
    path: { project_id: project.id, offering_id: offering.id },
    query: { limit: 50 },
  });
  if (listPkgErr) throw new Error("Failed to list packages");

  const summary: {
    planCode: string;
    entitlement: string;
    testProductId: string;
    appProductId: string;
    playProductId: string;
  }[] = [];

  // ---- Per-tier: products, prices, entitlement, package ----
  for (const tier of TIERS) {
    console.log(`\nTier: ${tier.planCode}`);
    const testStoreProduct = await ensureProductForApp(
      app,
      "Test Store",
      tier,
      true,
    );
    const appStoreProduct = await ensureProductForApp(
      appStoreApp,
      "App Store",
      tier,
      false,
    );
    const playStoreProduct = await ensureProductForApp(
      playStoreApp,
      "Play Store",
      tier,
      false,
    );

    await addTestStorePrices(testStoreProduct.id, tier);

    // Entitlement (lookup_key == plan code).
    let entitlement: Entitlement | undefined = existingEntitlements.items?.find(
      (e) => e.lookup_key === tier.entitlementLookupKey,
    );
    if (entitlement) {
      console.log(`  Entitlement already exists:`, entitlement.id);
    } else {
      const { data: newEntitlement, error } = await createEntitlement({
        client,
        path: { project_id: project.id },
        body: {
          lookup_key: tier.entitlementLookupKey,
          display_name: tier.entitlementDisplayName,
        },
      });
      if (error) throw new Error(`Failed to create entitlement ${tier.planCode}`);
      console.log(`  Created entitlement:`, newEntitlement.id);
      entitlement = newEntitlement;
    }

    const { error: attachEntErr } = await attachProductsToEntitlement({
      client,
      path: { project_id: project.id, entitlement_id: entitlement.id },
      body: {
        product_ids: [
          testStoreProduct.id,
          appStoreProduct.id,
          playStoreProduct.id,
        ],
      },
    });
    if (attachEntErr) {
      if (attachEntErr.type === "unprocessable_entity_error") {
        console.log("  Products already attached to entitlement");
      } else {
        throw new Error(
          `Failed to attach products to entitlement ${tier.planCode}`,
        );
      }
    } else {
      console.log("  Attached products to entitlement");
    }

    // Package within the default offering.
    let pkg: Package | undefined = existingPackages.items?.find(
      (p) => p.lookup_key === tier.packageIdentifier,
    );
    if (pkg) {
      console.log(`  Package already exists:`, pkg.id);
    } else {
      const { data: newPackage, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: {
          lookup_key: tier.packageIdentifier,
          display_name: tier.packageDisplayName,
        },
      });
      if (error) throw new Error(`Failed to create package ${tier.planCode}`);
      console.log(`  Created package:`, newPackage.id);
      pkg = newPackage;
    }

    const { error: attachPkgErr } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: testStoreProduct.id, eligibility_criteria: "all" },
          { product_id: appStoreProduct.id, eligibility_criteria: "all" },
          { product_id: playStoreProduct.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPkgErr) {
      if (
        attachPkgErr.type === "unprocessable_entity_error" &&
        attachPkgErr.message?.includes("Cannot attach product")
      ) {
        console.log("  Skipping package attach: incompatible product present");
      } else {
        throw new Error(`Failed to attach products to package ${tier.planCode}`);
      }
    } else {
      console.log("  Attached products to package");
    }

    summary.push({
      planCode: tier.planCode,
      entitlement: tier.entitlementLookupKey,
      testProductId: testStoreProduct.id,
      appProductId: appStoreProduct.id,
      playProductId: playStoreProduct.id,
    });
  }

  // ---- Public API keys ----
  const { data: testKeys, error: testKeysErr } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: app.id },
  });
  if (testKeysErr) throw new Error("Failed to list Test Store API keys");
  const { data: appKeys, error: appKeysErr } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: appStoreApp.id },
  });
  if (appKeysErr) throw new Error("Failed to list App Store API keys");
  const { data: playKeys, error: playKeysErr } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: playStoreApp.id },
  });
  if (playKeysErr) throw new Error("Failed to list Play Store API keys");

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("REVENUECAT_PROJECT_ID:", project.id);
  console.log("REVENUECAT_TEST_STORE_APP_ID:", app.id);
  console.log("REVENUECAT_APPLE_APP_STORE_APP_ID:", appStoreApp.id);
  console.log("REVENUECAT_GOOGLE_PLAY_STORE_APP_ID:", playStoreApp.id);
  for (const s of summary) {
    console.log(
      `Tier ${s.planCode}: entitlement="${s.entitlement}" test=${s.testProductId} app=${s.appProductId} play=${s.playProductId}`,
    );
  }
  console.log(
    "EXPO_PUBLIC_REVENUECAT_TEST_API_KEY:",
    testKeys?.items.map((i) => i.key).join(", ") ?? "N/A",
  );
  console.log(
    "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:",
    appKeys?.items.map((i) => i.key).join(", ") ?? "N/A",
  );
  console.log(
    "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY:",
    playKeys?.items.map((i) => i.key).join(", ") ?? "N/A",
  );
  console.log("====================\n");
}

seedRevenueCat().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
