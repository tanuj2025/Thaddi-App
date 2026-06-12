import { useAuth } from "@clerk/expo";
import { useGetMe } from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect } from "expo-router";
import React, { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

import { Button, LoadingState, Screen, ThemedText } from "@/components/ui";
import { nextActivationRoute } from "@/lib/activation";
import { useI18n } from "@/lib/i18n";

const PENDING_JOIN_KEY = "thaddi_pending_join";

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
  const { signOut } = useAuth();
  const { data: me, isLoading, isError, refetch } = useGetMe();

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

  if (isLoading) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (isError || !me) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 12 }}>
          <ThemedText weight="bold" size={17} center>
            {t("gate.error.title")}
          </ThemedText>
          <ThemedText muted size={14} center>
            {t("gate.error.desc")}
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
