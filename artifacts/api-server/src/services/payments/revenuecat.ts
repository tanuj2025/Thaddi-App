// RevenueCat integration (https://www.revenuecat.com). Unlike Moyasar (a hosted
// web checkout), RevenueCat purchases happen natively on-device via the mobile
// SDK. The server's job is to VERIFY entitlements out-of-band: it asks the
// RevenueCat REST API which entitlements a customer (keyed by their Clerk user
// id, the app_user_id the mobile app logs in with) currently holds, then mirrors
// the result into our own subscriptions table. We never trust the client's claim
// of what it purchased.
//
// Auth is handled by the Replit connectors proxy: createProxyFetch injects and
// refreshes the OAuth credential per request (and retries once on 401), so the
// client never holds a stale token and no secret key lives in our code.

import { createClient } from "@replit/revenuecat-sdk/client";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  listEntitlements,
  listCustomerActiveEntitlements,
  type Entitlement,
  type CustomerEntitlement,
} from "@replit/revenuecat-sdk";
import { logger } from "../../lib/logger";

export function isRevenueCatConfigured(): boolean {
  return Boolean(process.env.REVENUECAT_PROJECT_ID);
}

function projectId(): string {
  const id = process.env.REVENUECAT_PROJECT_ID;
  if (!id) {
    throw new Error("REVENUECAT_PROJECT_ID is not configured");
  }
  return id;
}

type RevenueCatClient = ReturnType<typeof createClient>;

async function getClient(): Promise<RevenueCatClient> {
  const connectors = new ReplitConnectors();
  return createClient({
    baseUrl: "https://api.revenuecat.com/v2",
    fetch: connectors.createProxyFetch("revenuecat"),
  });
}

// A defensive hard cap so a misbehaving cursor can never loop forever. Our
// catalog has a handful of entitlements, so one page is the normal case.
const MAX_PAGES = 50;
const PAGE_LIMIT = 100;

// Every entitlement in the project, paginated. The entitlement's `lookup_key`
// is, by our seed convention, identical to the plan `code` in our database.
async function listAllEntitlements(
  client: RevenueCatClient,
): Promise<Entitlement[]> {
  const items: Entitlement[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await listEntitlements({
      client,
      path: { project_id: projectId() },
      query: {
        limit: PAGE_LIMIT,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
    });
    if (error || !data) {
      throw new Error("Failed to list RevenueCat entitlements");
    }
    items.push(...data.items);
    if (!data.next_page || data.items.length === 0) break;
    startingAfter = data.items[data.items.length - 1]?.id;
    if (!startingAfter) break;
  }
  return items;
}

// The customer's currently-active entitlements. RevenueCat already filters to
// active ones server-side. An unknown customer (never purchased) yields a 404,
// which we treat as "no entitlements" rather than an error.
async function listAllCustomerActiveEntitlements(
  client: RevenueCatClient,
  appUserId: string,
): Promise<CustomerEntitlement[]> {
  const items: CustomerEntitlement[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error, response } = await listCustomerActiveEntitlements({
      client,
      path: { project_id: projectId(), customer_id: appUserId },
      query: {
        limit: PAGE_LIMIT,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
    });
    if (response?.status === 404) return [];
    if (error || !data) {
      throw new Error("Failed to list RevenueCat customer entitlements");
    }
    items.push(...data.items);
    if (!data.next_page || data.items.length === 0) break;
    startingAfter = data.items[data.items.length - 1]?.entitlement_id;
    if (!startingAfter) break;
  }
  return items;
}

// Resolves the set of plan codes a customer is currently entitled to. The
// CustomerEntitlement only carries an opaque entitlement_id; we join it against
// the project's entitlement catalog to recover the lookup_key (== plan code).
export async function resolveActivePlanCodes(
  appUserId: string,
): Promise<string[]> {
  const client = await getClient();
  const [entitlements, active] = await Promise.all([
    listAllEntitlements(client),
    listAllCustomerActiveEntitlements(client, appUserId),
  ]);

  const lookupById = new Map<string, string>();
  for (const e of entitlements) lookupById.set(e.id, e.lookup_key);

  const now = Date.now();
  const codes = new Set<string>();
  for (const ce of active) {
    // expires_at null = lifetime (our passes are non-consumable one-time
    // unlocks). Skip anything already expired, belt-and-suspenders.
    if (ce.expires_at !== null && ce.expires_at <= now) continue;
    const code = lookupById.get(ce.entitlement_id);
    if (code) {
      codes.add(code);
    } else {
      logger.warn(
        { entitlementId: ce.entitlement_id },
        "active RevenueCat entitlement has no matching catalog lookup_key",
      );
    }
  }
  return [...codes];
}
