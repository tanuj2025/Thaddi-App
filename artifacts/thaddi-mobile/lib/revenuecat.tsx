// RevenueCat IAP wiring for the mobile app.
//
// Unlike the web (which uses Moyasar's hosted checkout), purchases on mobile MUST
// go through the native store via RevenueCat — linking out to a web payment flow
// would violate Apple's guideline 3.1.1. The flow is:
//
//   1. configure() once at module load with the platform API key.
//   2. logIn(clerkUserId) so RevenueCat's app_user_id == our Clerk user id; the
//      server verifies entitlements by that same id (see api-server's
//      services/payments/revenuecat.ts), never trusting the client.
//   3. purchasePackage() drives the store sheet; on success the app calls the
//      server's POST /payments/iap/sync, which re-reads entitlements and mirrors
//      the highest purchasable plan into our subscriptions table.
//
// Everything here is defensive: the SDK constructs native bindings at import
// time, so on a platform without them (e.g. an unsupported web bundle) we degrade
// to "purchases unavailable" instead of crashing the whole app.

import { useMutation, useQuery, type UseMutateAsyncFunction } from "@tanstack/react-query";
import Constants from "expo-constants";
import React, {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import type {
  CustomerInfo,
  PurchasesOfferings,
  PurchasesPackage,
} from "react-native-purchases";

// By our seed convention (scripts/seedRevenueCat.ts) each entitlement's
// lookup_key — and each package identifier — equals the plan `code` in our DB.
export const REVENUECAT_ENTITLEMENT_IDS = ["professional", "legend", "goat"] as const;

const TEST_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const IOS_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ||
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
const ANDROID_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

type PurchasesModule = typeof import("react-native-purchases").default;

let cachedPurchases: PurchasesModule | null | undefined;

// Lazy CommonJS require. `react-native-purchases` builds a NativeEventEmitter at
// import time, which throws on platforms lacking the native module. Containing
// the require here means an unsupported environment yields `null` (→ "purchases
// unavailable") rather than crashing the root layout on import.
function getPurchases(): PurchasesModule | null {
  if (cachedPurchases !== undefined) return cachedPurchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-purchases");
    cachedPurchases = (mod.default ?? mod) as PurchasesModule;
  } catch {
    cachedPurchases = null;
  }
  return cachedPurchases;
}

export function revenueCatKeysPresent(): boolean {
  return Boolean(TEST_KEY && IOS_KEY && ANDROID_KEY);
}

// Expo Go and the web bundle can only use RevenueCat's Test Store, so they take
// the test key; real device builds take the per-store key.
function resolveApiKey(): string | null {
  if (__DEV__ || Platform.OS === "web" || Constants.appOwnership === "expo") {
    return TEST_KEY ?? null;
  }
  if (Platform.OS === "ios") return IOS_KEY ?? null;
  if (Platform.OS === "android") return ANDROID_KEY ?? null;
  return TEST_KEY ?? null;
}

let configured = false;

// Configure once. Called synchronously at root-layout module load (before the
// SubscriptionProvider mounts) so `configured` is settled before any query reads
// it. Throws if the SDK or keys are missing; the caller catches and degrades.
export function initializeRevenueCat(): void {
  if (configured) return;
  const Purchases = getPurchases();
  if (!Purchases) {
    throw new Error("RevenueCat SDK is unavailable on this platform");
  }
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error("RevenueCat API key is not configured");
  }
  Purchases.configure({ apiKey });
  configured = true;
}

export function isRevenueCatReady(): boolean {
  return configured;
}

// Align RevenueCat's app_user_id with the Clerk user id. Best-effort: a failed
// logIn must never block sign-in, and the server re-verifies by Clerk id anyway.
export async function identifyRevenueCatUser(userId: string): Promise<void> {
  if (!configured) return;
  const Purchases = getPurchases();
  if (!Purchases) return;
  try {
    await Purchases.logIn(userId);
  } catch {
    // ignore — entitlements are server-verified by Clerk id regardless.
  }
}

export async function logoutRevenueCatUser(): Promise<void> {
  if (!configured) return;
  const Purchases = getPurchases();
  if (!Purchases) return;
  try {
    await Purchases.logOut();
  } catch {
    // ignore — the query cache is cleared on sign-out regardless.
  }
}

// RevenueCat surfaces user-initiated cancellation as `userCancelled: true`; the
// paywall treats that as a silent dismiss, not an error.
export function purchaseWasCancelled(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === "object" &&
    (err as { userCancelled?: boolean }).userCancelled === true,
  );
}

/* -------------------------------------------------------------------------- */
/* Subscription context                                                        */
/* -------------------------------------------------------------------------- */

interface SubscriptionContextValue {
  /** SDK configured (purchases possible at all). */
  ready: boolean;
  /** A current offering with packages is loaded (a purchase can be initiated). */
  offeringReady: boolean;
  isLoading: boolean;
  /** Store packages keyed by plan code (package.identifier == plan.code). */
  packagesByPlanCode: Record<string, PurchasesPackage>;
  customerInfo: CustomerInfo | null;
  purchaseAsync: UseMutateAsyncFunction<
    CustomerInfo | null,
    Error,
    PurchasesPackage
  >;
  isPurchasing: boolean;
  restoreAsync: UseMutateAsyncFunction<CustomerInfo | null, Error, void>;
  isRestoring: boolean;
  refetch: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const enabled = configured;

  const offeringsQuery = useQuery({
    queryKey: ["revenuecat", "offerings"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PurchasesOfferings | null> => {
      const Purchases = getPurchases();
      if (!Purchases) return null;
      try {
        return await Purchases.getOfferings();
      } catch {
        return null;
      }
    },
  });

  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info"],
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<CustomerInfo | null> => {
      const Purchases = getPurchases();
      if (!Purchases) return null;
      try {
        return await Purchases.getCustomerInfo();
      } catch {
        return null;
      }
    },
  });

  const purchaseMutation = useMutation<CustomerInfo | null, Error, PurchasesPackage>({
    mutationFn: async (pkg) => {
      const Purchases = getPurchases();
      if (!Purchases) throw new Error("RevenueCat SDK is unavailable");
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return customerInfo;
    },
    onSuccess: () => {
      void customerInfoQuery.refetch();
    },
  });

  const restoreMutation = useMutation<CustomerInfo | null, Error, void>({
    mutationFn: async () => {
      const Purchases = getPurchases();
      if (!Purchases) throw new Error("RevenueCat SDK is unavailable");
      return Purchases.restorePurchases();
    },
    onSuccess: () => {
      void customerInfoQuery.refetch();
    },
  });

  const offeringsData = offeringsQuery.data;
  const customerData = customerInfoQuery.data;
  const value = useMemo<SubscriptionContextValue>(() => {
    const packagesByPlanCode: Record<string, PurchasesPackage> = {};
    const current = offeringsData?.current;
    for (const pkg of current?.availablePackages ?? []) {
      packagesByPlanCode[pkg.identifier] = pkg;
    }
    return {
      ready: enabled,
      offeringReady: Boolean(current),
      isLoading: offeringsQuery.isLoading || customerInfoQuery.isLoading,
      packagesByPlanCode,
      customerInfo: customerData ?? null,
      purchaseAsync: purchaseMutation.mutateAsync,
      isPurchasing: purchaseMutation.isPending,
      restoreAsync: restoreMutation.mutateAsync,
      isRestoring: restoreMutation.isPending,
      refetch: () => {
        void offeringsQuery.refetch();
        void customerInfoQuery.refetch();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    offeringsData,
    customerData,
    offeringsQuery.isLoading,
    customerInfoQuery.isLoading,
    purchaseMutation.mutateAsync,
    purchaseMutation.isPending,
    restoreMutation.mutateAsync,
    restoreMutation.isPending,
  ]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error("useSubscription must be used within a SubscriptionProvider");
  }
  return ctx;
}
