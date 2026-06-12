import { useAuth } from "@clerk/expo";
import { useGetMe } from "@workspace/api-client-react";
import { Redirect } from "expo-router";
import React, { type ReactNode } from "react";
import { View } from "react-native";

import { Button, LoadingState, Screen, ThemedText } from "@/components/ui";
import { nextActivationRoute } from "@/lib/activation";
import { useI18n } from "@/lib/i18n";

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

  return <>{children}</>;
}
