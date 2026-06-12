import { createClient } from "@replit/revenuecat-sdk/client";
import { ReplitConnectors } from "@replit/connectors-sdk";

// Builds an authenticated RevenueCat REST client. Authentication is injected
// per-request by the Replit connectors proxy fetch (which also transparently
// refreshes the OAuth token and retries on a 401), so the returned client never
// holds a stale credential. Not cached, per the integration's "uncachable"
// contract — create a fresh client per use.
export async function getUncachableRevenueCatClient() {
  const connectors = new ReplitConnectors();
  return createClient({
    baseUrl: "https://api.revenuecat.com/v2",
    fetch: connectors.createProxyFetch("revenuecat"),
  });
}
