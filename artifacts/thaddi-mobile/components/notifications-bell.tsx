import { Feather } from "@expo/vector-icons";
import {
  getGetUnreadNotificationCountQueryKey,
  useGetUnreadNotificationCount,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

/**
 * Header bell that deep-links to the notifications screen and surfaces an unread
 * dot. Uses the lightweight count endpoint (not the full list) and refetches on
 * focus so the badge stays roughly current without polling.
 */
export function NotificationsBell() {
  const c = useColors();
  const { dir } = useI18n();
  const { data } = useGetUnreadNotificationCount({
    query: {
      refetchOnWindowFocus: true,
      queryKey: getGetUnreadNotificationCountQueryKey(),
    },
  });
  const unread = data?.unreadCount ?? 0;

  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
      accessibilityRole="button"
    >
      <Feather name="bell" size={22} color={c.foreground} />
      {unread > 0 ? (
        <View
          style={{
            position: "absolute",
            top: 2,
            ...(dir === "rtl" ? { left: 2 } : { right: 2 }),
            minWidth: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: c.destructive,
            borderWidth: 1.5,
            borderColor: c.background,
          }}
        />
      ) : null}
    </Pressable>
  );
}
