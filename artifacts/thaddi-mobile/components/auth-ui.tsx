import { Image } from "expo-image";
import React, { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { LangToggle, Screen, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

const logo = require("@/assets/images/logo.png");

/**
 * Shared scaffold for the auth screens: stadium background, language toggle,
 * brand logo, and a localized title/subtitle. Keeps sign-in and sign-up visually
 * consistent and direction-aware.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { dir } = useI18n();
  return (
    <Screen scroll>
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          justifyContent: "flex-end",
        }}
      >
        <LangToggle />
      </View>
      <View style={{ alignItems: "center", gap: 10, marginTop: 8, marginBottom: 28 }}>
        <Image source={logo} style={{ width: 72, height: 72 }} contentFit="contain" />
        <ThemedText gold weight="extrabold" size={26} center>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText muted size={15} center>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {children}
    </Screen>
  );
}

export function AuthDivider({ label }: { label: string }) {
  const c = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginVertical: 18,
      }}
    >
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
      <ThemedText muted size={13}>
        {label}
      </ThemedText>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
    </View>
  );
}
