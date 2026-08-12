import { Image } from "expo-image";
import React, { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { LangToggle, Reveal, Screen, ThemedText } from "@/components/ui";
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
  scroll = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const { dir } = useI18n();
  return (
    <Screen scroll={scroll} contentStyle={{ justifyContent: "center" }}>
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          justifyContent: "flex-end",
          marginBottom: 4,
        }}
      >
        <LangToggle />
      </View>
      <Reveal>
        <View style={{ alignItems: "center", gap: 6, marginTop: 2, marginBottom: 16 }}>
          <Image
            source={logo}
            style={{
              width: 58,
              height: 58,
              borderRadius: 29,
              borderWidth: 1.5,
              borderColor: "rgba(232,180,48,0.4)",
            }}
            contentFit="contain"
          />
          <ThemedText gold weight="extrabold" size={23} center>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText muted size={13} center style={{ marginTop: -2 }}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
      </Reveal>
      <Reveal delay={60}>
        <View>{children}</View>
      </Reveal>
    </Screen>
  );
}

export function AuthDivider({ label }: { label: string }) {
  const c = useColors();
  const { dir } = useI18n();
  return (
    <View
      style={{
        flexDirection: dir === "rtl" ? "row-reverse" : "row",
        alignItems: "center",
        gap: 12,
        marginVertical: 12,
      }}
    >
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
      <ThemedText muted size={12}>
        {label}
      </ThemedText>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
    </View>
  );
}
