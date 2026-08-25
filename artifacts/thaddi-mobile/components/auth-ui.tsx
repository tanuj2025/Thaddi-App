import { Image } from "expo-image";
import React, { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { LangToggle, Reveal, Screen, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

const appIcon = require("@/assets/images/icon.png");

/**
 * Shared scaffold for the auth screens: stadium background, language toggle,
 * official brand app icon, and a localized title/subtitle. Keeps sign-in and sign-up
 * visually consistent, keyboard-resilient, and direction-aware.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const { dir } = useI18n();
  return (
    <Screen
      scroll={false}
      contentStyle={{ flex: 1, justifyContent: "center", paddingVertical: 16 }}
    >
      {scroll ? (
        <KeyboardAwareScrollViewCompat
          style={{ flex: 1, width: "100%" }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          bottomOffset={24}
        >
          <AuthContent dir={dir} title={title} subtitle={subtitle}>
            {children}
          </AuthContent>
        </KeyboardAwareScrollViewCompat>
      ) : (
        <AuthContent dir={dir} title={title} subtitle={subtitle}>
          {children}
        </AuthContent>
      )}
    </Screen>
  );
}

function AuthContent({
  dir,
  title,
  subtitle,
  children,
}: {
  dir: "ltr" | "rtl";
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ width: "100%" }}>
        <View
          style={{
            flexDirection: dir === "rtl" ? "row-reverse" : "row",
            justifyContent: "flex-end",
            marginBottom: 6,
          }}
        >
          <LangToggle />
        </View>
        <Reveal>
          <View style={{ alignItems: "center", gap: 8, marginTop: 4, marginBottom: 20 }}>
            <Image
              source={appIcon}
              style={{
                width: 72,
                height: 72,
                borderRadius: 20,
                borderWidth: 1.5,
                borderColor: "rgba(232,180,48,0.5)",
                backgroundColor: "#060914",
                shadowColor: "#000",
                shadowOpacity: 0.3,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
              }}
              contentFit="contain"
              accessibilityLabel="THADDI App Icon"
            />
            <ThemedText gold weight="extrabold" size={24} center>
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
      </View>
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
