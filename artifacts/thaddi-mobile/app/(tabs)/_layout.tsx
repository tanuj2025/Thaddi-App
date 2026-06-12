import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { type ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActivationGate } from "@/components/activation-gate";
import { ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

// Derive the tab-bar render props from expo-router's Tabs so we don't need a
// direct import of @react-navigation/bottom-tabs (not a direct dependency).
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * Custom tab bar. React Navigation lays out tabs inside an internal content View
 * (flexDirection: "row") that screenOptions can't reach, so we render our own
 * row and flip it to row-reverse for RTL — putting home (the first tab) on the
 * right in Arabic without relying on I18nManager.forceRTL.
 */
function RtlTabBar({ state, descriptors, navigation }: TabBarProps) {
  const c = useColors();
  const { dir } = useI18n();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === "web" ? 16 : insets.bottom;

  return (
    <View
      style={{
        flexDirection: dir === "rtl" ? "row-reverse" : "row",
        backgroundColor: c.card,
        borderTopColor: c.border,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 8,
        paddingBottom: bottomInset + 8,
        paddingHorizontal: Math.max(insets.left, insets.right),
      }}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const color = focused ? c.primary : c.mutedForeground;
        const label = typeof options.title === "string" ? options.title : route.name;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            if (Platform.OS !== "web") void Haptics.selectionAsync();
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({ type: "tabLongPress", target: route.key });
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {options.tabBarIcon?.({ focused, color, size: 22 })}
            <ThemedText size={11} weight="semibold" color={color} center numberOfLines={1}>
              {label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
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
        tabBar={(props) => <RtlTabBar {...props} />}
        screenOptions={{ headerShown: false }}
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
