import { Image } from "expo-image";
import React from "react";
import { View } from "react-native";

import { LangToggle, Screen, ThemedText } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

const logo = require("@/assets/images/logo.png");

export default function HomeScreen() {
  const { t, dir } = useI18n();
  return (
    <Screen>
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          justifyContent: "flex-end",
        }}
      >
        <LangToggle />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
        <Image
          source={logo}
          style={{ width: 96, height: 96 }}
          contentFit="contain"
        />
        <ThemedText gold weight="extrabold" size={32} center>
          {t("app.name")}
        </ThemedText>
        <ThemedText muted size={16} center>
          {t("app.tagline")}
        </ThemedText>
      </View>
    </Screen>
  );
}
