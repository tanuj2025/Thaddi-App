import { useGetFeatureFlags, getGetFeatureFlagsQueryKey } from '@workspace/api-client-react';

/**
 * Returns whether a named feature flag is enabled. Defaults to false while
 * loading or when the flag is absent, so advanced surfaces stay hidden unless
 * explicitly turned on by an admin.
 */
export function useFeatureFlag(key: string): boolean {
  const { data } = useGetFeatureFlags({
    query: { queryKey: getGetFeatureFlagsQueryKey(), staleTime: 60_000 },
  });
  return data?.find((f) => f.key === key)?.enabled === true;
}
