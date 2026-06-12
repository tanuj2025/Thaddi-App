import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMyNotificationsQueryKey,
  getGetUnreadNotificationCountQueryKey,
  useGetMyNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  type NotificationItem,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React from "react";
import { FlatList, Pressable, View } from "react-native";

import {
  EmptyState,
  LoadingState,
  Screen,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function NotificationsScreen() {
  const c = useColors();
  const { t, lang, dir } = useI18n();
  const queryClient = useQueryClient();

  const q = useGetMyNotifications();
  const notifications = q.data?.notifications ?? [];
  const unreadCount = q.data?.unreadCount ?? 0;
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });
  };

  const markOne = useMarkNotificationRead({ mutation: { onSuccess: invalidate } });
  const markAll = useMarkAllNotificationsRead({ mutation: { onSuccess: invalidate } });

  const renderItem = ({ item }: { item: NotificationItem }) => {
    const title = lang === "ar" ? item.titleAr : item.titleEn;
    const body = lang === "ar" ? item.bodyAr : item.bodyEn;
    return (
      <Pressable
        onPress={() => {
          if (!item.read) markOne.mutate({ id: item.id });
        }}
        style={{
          flexDirection: rowDir,
          gap: 12,
          padding: 14,
          marginBottom: 8,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: item.read ? c.border : c.primary,
          backgroundColor: item.read ? c.card : "rgba(39,176,112,0.08)",
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 6,
            backgroundColor: item.read ? "transparent" : c.primary,
          }}
        />
        <View style={{ flex: 1 }}>
          <ThemedText weight="semibold" size={14}>
            {title}
          </ThemedText>
          {body ? (
            <ThemedText muted size={13} style={{ marginTop: 2 }}>
              {body}
            </ThemedText>
          ) : null}
          <ThemedText muted size={11} style={{ marginTop: 6 }}>
            {formatDateTime(item.createdAt, lang)}
          </ThemedText>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen scroll={false}>
      <View
        style={{
          flexDirection: rowDir,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 6 }}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: 4 }}>
            <Feather
              name={dir === "rtl" ? "chevron-right" : "chevron-left"}
              size={26}
              color={c.foreground}
            />
          </Pressable>
          <ThemedText weight="extrabold" size={22}>
            {t("nav.notifications")}
          </ThemedText>
        </View>
        {unreadCount > 0 ? (
          <Pressable onPress={() => markAll.mutate()} hitSlop={8}>
            <ThemedText gold size={13} weight="semibold">
              {t("notifications.markAllRead")}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        {q.isLoading ? (
          <LoadingState />
        ) : notifications.length === 0 ? (
          <EmptyState title={t("notifications.empty")} />
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(n) => n.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 16 }}
          />
        )}
      </View>
    </Screen>
  );
}
