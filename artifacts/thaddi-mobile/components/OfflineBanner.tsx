import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ui";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useI18n } from "@/lib/i18n";

export function OfflineBanner() {
  const { isOffline, checkConnection } = useNetworkStatus();
  const { dir, lang } = useI18n();
  const insets = useSafeAreaInsets();

  if (!isOffline) return null;

  const topInset = Platform.OS === "web" ? 0 : insets.top;
  const isRtl = dir === "rtl";

  const message =
    lang === "ar"
      ? "وضع عدم الاتصال — يتم عرض البيانات المحفوظة"
      : "Offline Mode — Showing cached data";

  const retryLabel = lang === "ar" ? "تحديث" : "Retry";

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: topInset + 6,
          flexDirection: isRtl ? "row-reverse" : "row",
        },
      ]}
    >
      <View style={[styles.content, { flexDirection: isRtl ? "row-reverse" : "row" }]}>
        <Feather name="wifi-off" size={15} color="#060914" />
        <ThemedText
          size={12}
          weight="semibold"
          style={styles.text}
          numberOfLines={1}
        >
          {message}
        </ThemedText>
      </View>
      <Pressable
        onPress={() => void checkConnection()}
        style={({ pressed }) => [styles.retryButton, { opacity: pressed ? 0.7 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
      >
        <ThemedText size={11} weight="bold" style={styles.retryText}>
          {retryLabel}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    backgroundColor: "#e8b430",
    paddingBottom: 6,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 9999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  content: {
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  text: {
    color: "#060914",
  },
  retryButton: {
    backgroundColor: "rgba(6,9,20,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  retryText: {
    color: "#060914",
  },
});
