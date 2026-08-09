import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";

/**
 * Minimal fallback while native startup state is being resolved. This must not
 * depend on Clerk, i18n, or navigation because it is also used by their parent
 * gates during the first render.
 */
export function StartupLoadingScreen() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator
        accessibilityLabel="Loading"
        color={colors.primary}
        size="large"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});