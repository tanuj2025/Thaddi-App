import React from "react";

import { EmptyState, LangToggle, Screen, ThemedText } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { View } from "react-native";

export default function ProfileScreen() {
  const { t, dir } = useI18n();
  return (
    <Screen>
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <ThemedText weight="extrabold" size={26}>
          {t("nav.profile")}
        </ThemedText>
        <LangToggle />
      </View>
      <EmptyState title={t("nav.profile")} subtitle={t("app.tagline")} />
    </Screen>
  );
}
