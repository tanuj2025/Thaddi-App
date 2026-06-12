import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet } from "react-native";

import { ActivationGate } from "@/components/activation-gate";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export default function TabLayout() {
  const c = useColors();
  const { t } = useI18n();
  const { isSignedIn } = useAuth();

  const tab = (name: FeatherName) =>
    ({ color, size }: { color: string; size: number }) => (
      <Feather name={name} size={size ?? 22} color={color} />
    );

  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <ActivationGate>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.mutedForeground,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: c.card,
          borderTopColor: c.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          ...(Platform.OS === "web" ? { height: 84 } : {}),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t("nav.home"), tabBarIcon: tab("home") }}
      />
      <Tabs.Screen
        name="matches"
        options={{ title: t("nav.matches"), tabBarIcon: tab("calendar") }}
      />
      <Tabs.Screen
        name="challenges"
        options={{ title: t("nav.challenges"), tabBarIcon: tab("award") }}
      />
      <Tabs.Screen
        name="rankings"
        options={{ title: t("nav.rankings"), tabBarIcon: tab("bar-chart-2") }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t("nav.profile"), tabBarIcon: tab("user") }}
      />
    </Tabs>
    </ActivationGate>
  );
}
