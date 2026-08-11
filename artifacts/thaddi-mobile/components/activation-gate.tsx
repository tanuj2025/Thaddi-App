import { useAuth } from "@clerk/expo";
import {
  getGetMeQueryKey,
  useGetMe,
} from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";

import { Button, LoadingState, Screen, ThemedText } from "@/components/ui";
import { nextActivationRoute } from "@/lib/activation";
import { useI18n } from "@/lib/i18n";

const PENDING_JOIN_KEY = "thaddi_pending_join";

// Android APK cold-starts (after OAuth redirect) can take longer for Clerk's
// SecureStore-backed token cache to become ready. Give Android more headroom.
const TOKEN_POLL_ATTEMPTS = Platform.OS === "android" ? 40 : 20;
const TOKEN_POLL_INTERVAL_MS = 250;

/**
 * Gates the authenticated tab area behind the activation flow.
 *
 * Renders one of:
 *  - a transient loading splash while /api/me resolves,
 *  - an error state with Retry + Sign out (NEVER a permanent spinner — a dead
 *    spinner here is the documented Safari/Clerk failure mode we must avoid),
 *  - an email-not-verified notice (cannot be resolved in-app; offer sign out),
 *  - a redirect into the next incomplete activation step,
 *  - otherwise the children (the tabs).
 *
 * `nextActivationRoute` is the single source of truth shared with each step's
 * onSuccess handler so the gate and the flow can never disagree on ordering.
 */
export function ActivationGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const [authReady, setAuthReady] = useState(false);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  // Incrementing this counter triggers a fresh token-poll cycle (used by Retry).
  const [pollEpoch, setPollEpoch] = useState(0);
  // Keep a ref so the poll loop can cancel itself when the component unmounts
  // or a new epoch starts.
  const activeEpochRef = useRef(0);

  // Clerk can report isSignedIn immediately after an OAuth callback while the
  // native token cache is still being populated. Starting /api/me during that
  // window sends no bearer token and produces the misleading "Couldn't load
  // your account" screen. Wait for an actual token, but keep a hard deadline
  // so a broken session cannot leave the user on a permanent spinner.
  useEffect(() => {
    const epoch = pollEpoch;
    activeEpochRef.current = epoch;

    setAuthReady(false);
    setAuthTimedOut(false);

    if (!isLoaded || !isSignedIn) return;

    const waitForToken = async () => {
      for (let attempt = 0; attempt < TOKEN_POLL_ATTEMPTS; attempt += 1) {
        // Stop if a newer epoch has started (e.g. Retry was pressed).
        if (activeEpochRef.current !== epoch) return;
        try {
          const token = await getToken();
          if (token) {
            if (activeEpochRef.current === epoch) setAuthReady(true);
            return;
          }
        } catch {
          // Clerk may still be finalizing the OAuth session; retry below.
        }
        await new Promise((resolve) => setTimeout(resolve, TOKEN_POLL_INTERVAL_MS));
      }

      if (activeEpochRef.current === epoch) {
        setAuthTimedOut(true);
        setAuthReady(true);
      }
    };

    void waitForToken();
  }, [getToken, isLoaded, isSignedIn, pollEpoch]);

  const {
    data: me,
    isLoading,
    isError,
    refetch,
  } = useGetMe({
    query: {
      // Only fire /api/me once we have confirmed a token exists (or timed out).
      // authTimedOut=true means the poll expired; we still set authReady so
      // useGetMe fires — but the request will likely fail without a token,
      // surfacing the timeout error below.
      enabled: authReady && isSignedIn === true,
      queryKey: getGetMeQueryKey(),
    },
  });

  // Retry handler: reset the token-poll state so the effect re-runs from
  // scratch. Only after a token is confirmed (or a second timeout) will
  // useGetMe re-fire — preventing a retry from going out with no bearer token.
  const handleRetry = useCallback(() => {
    setPollEpoch((e) => e + 1);
    void refetch();
  }, [refetch]);

  // Pending deep-link join (stashed by /join/{code} when an unauthenticated or
  // not-yet-activated user opened an invite). We read it once on mount and
  // resume it only at the fully-activated point below.
  const [pendingJoin, setPendingJoin] = useState<string | null>(null);
  const [checkedPending, setCheckedPending] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(PENDING_JOIN_KEY);
        if (active) setPendingJoin(stored);
      } catch {
        // best-effort; treat as "no pending join"
      } finally {
        if (active) setCheckedPending(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!isLoaded || (isSignedIn && !authReady) || isLoading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (authTimedOut || isError || !me) {
    // Distinguish a token-poll timeout from a server-side error so the message
    // is actionable (timeout → wait & retry; server error → try again or sign out).
    const isTimeout = authTimedOut && !isError;
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 12 }}>
          <ThemedText weight="bold" size={17} center>
            {isTimeout ? t("gate.error.timeout.title") : t("gate.error.title")}
          </ThemedText>
          <ThemedText muted size={14} center>
            {isTimeout ? t("gate.error.timeout.desc") : t("gate.error.desc")}
          </ThemedText>
          <View style={{ alignSelf: "stretch", gap: 10, marginTop: 8 }}>
            <Button label={t("common.tryAgain")} onPress={handleRetry} />
            <Button
              label={t("auth.signOut")}
              variant="outline"
              onPress={() => void signOut()}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (!me.emailVerified) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 12 }}>
          <ThemedText weight="bold" size={17} center>
            {t("gate.email.title")}
          </ThemedText>
          <ThemedText muted size={14} center>
            {t("gate.email.desc")}
          </ThemedText>
          <View style={{ alignSelf: "stretch", gap: 10, marginTop: 8 }}>
            <Button label={t("common.tryAgain")} onPress={() => void refetch()} />
            <Button
              label={t("auth.signOut")}
              variant="outline"
              onPress={() => void signOut()}
            />
          </View>
        </View>
      </Screen>
    );
  }

  const next = nextActivationRoute(me);
  if (next !== "/(tabs)") return <Redirect href={next} />;

  // Fully activated. Resume a pending deep-link join, if any, before rendering
  // the tabs. Wait for the AsyncStorage read so we never flash the tabs and
  // then redirect away.
  if (!checkedPending) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }
  if (pendingJoin) {
    // Clear BEFORE redirecting so a gate re-mount can't loop back here. The
    // activated join screen does not re-store, so the redirect happens once.
    void AsyncStorage.removeItem(PENDING_JOIN_KEY);
    return <Redirect href={`/join/${pendingJoin}`} />;
  }

  return <>{children}</>;
}
