import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryClient } from "@tanstack/react-query";

const QUERY_CACHE_STORAGE_KEY = "THADDI_OFFLINE_QUERY_CACHE_V1";

interface SerializedCacheEntry {
  queryKey: unknown[];
  data: unknown;
  updatedAt: number;
}

/**
 * Lightweight, production-grade Query Cache persister using AsyncStorage.
 * Saves query data when online and hydrates the QueryClient cache on boot
 * so user screens display cached data when offline.
 */
export async function hydrateQueryCache(queryClient: QueryClient): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUERY_CACHE_STORAGE_KEY);
    if (!raw) return;

    const entries: SerializedCacheEntry[] = JSON.parse(raw);
    if (!Array.isArray(entries)) return;

    const now = Date.now();
    // Keep cached items up to 7 days for offline usage
    const MAX_OFFLINE_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

    for (const entry of entries) {
      if (
        entry &&
        Array.isArray(entry.queryKey) &&
        entry.data !== undefined &&
        typeof entry.updatedAt === "number" &&
        now - entry.updatedAt < MAX_OFFLINE_CACHE_AGE_MS
      ) {
        queryClient.setQueryData(entry.queryKey, entry.data);
      }
    }
  } catch {
    // Best-effort cache restoration; ignore errors
  }
}

/**
 * Persists current successful query data from QueryClient into AsyncStorage.
 */
export async function persistQueryCache(queryClient: QueryClient): Promise<void> {
  try {
    const cache = queryClient.getQueryCache();
    const queries = cache.getAll();
    const entries: SerializedCacheEntry[] = [];

    for (const query of queries) {
      // Only persist queries that succeeded and have data
      if (query.state.status === "success" && query.state.data !== undefined) {
        entries.push({
          queryKey: query.queryKey as unknown[],
          data: query.state.data,
          updatedAt: query.state.dataUpdatedAt || Date.now(),
        });
      }
    }

    // Limit persistent entries to 50 most recent queries to save storage space
    const topEntries = entries
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50);

    await AsyncStorage.setItem(
      QUERY_CACHE_STORAGE_KEY,
      JSON.stringify(topEntries),
    );
  } catch {
    // Best-effort cache persistence; ignore errors
  }
}

/**
 * Registers automatic persistence subscription on QueryClient cache updates.
 */
export function setupQueryCachePersistence(queryClient: QueryClient): () => void {
  // Hydrate initial cache on app boot
  void hydrateQueryCache(queryClient);

  // Subscribe to query cache changes and debounce persistence
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event?.type === "updated" && event.query.state.status === "success") {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void persistQueryCache(queryClient);
      }, 2000);
    }
  });

  return () => {
    unsubscribe();
    if (saveTimer) clearTimeout(saveTimer);
  };
}
