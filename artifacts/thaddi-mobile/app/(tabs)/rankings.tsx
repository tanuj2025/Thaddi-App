import {
  useGetGlobalRanking,
  type RankingEntry,
} from "@workspace/api-client-react";
import React from "react";
import { FlatList, View } from "react-native";

import {
  Avatar,
  Card,
  EmptyState,
  LangToggle,
  LoadingState,
  Pill,
  Screen,
  ScreenHeader,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

function RankRow({ entry }: { entry: RankingEntry }) {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const name = entry.displayName ?? entry.username ?? "—";
  const acc =
    entry.accuracy != null ? `${formatNum(Math.round(entry.accuracy * 100))}%` : "—";

  return (
    <View
      style={{
        flexDirection: rowDir,
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginBottom: 8,
        borderRadius: c.radius,
        borderWidth: 1,
        borderColor: entry.isCurrentUser ? c.primary : c.border,
        backgroundColor: entry.isCurrentUser ? "rgba(39,176,112,0.10)" : c.card,
      }}
    >
      <ThemedText weight="extrabold" size={16} gold style={{ minWidth: 28 }} center>
        {formatNum(entry.rank)}
      </ThemedText>
      <Avatar uri={entry.avatarUrl} name={name} size={38} />
      <View style={{ flex: 1 }}>
        <ThemedText weight="semibold" size={14} numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText muted size={11}>
          {t("rankings.accuracy")} {acc} · {t("rankings.exact")} {formatNum(entry.exactPredictions)}
        </ThemedText>
      </View>
      <View style={{ alignItems: "center" }}>
        <ThemedText weight="extrabold" size={16}>
          {formatNum(entry.points)}
        </ThemedText>
        <ThemedText muted size={10}>
          {t("rankings.points")}
        </ThemedText>
      </View>
    </View>
  );
}

export default function RankingsScreen() {
  const { t } = useI18n();
  const q = useGetGlobalRanking({ limit: 100 });
  const entries = q.data?.entries ?? [];
  const me = q.data?.me ?? null;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title={t("rankings.title")}
        subtitle={t("rankings.subtitle")}
        right={<LangToggle />}
      />

      {q.isLoading ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState title={t("rankings.empty")} />
        </Card>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.userId}
          renderItem={({ item }) => <RankRow entry={item} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 16 }}
          ListHeaderComponent={
            me && !entries.some((e) => e.isCurrentUser) ? (
              <View style={{ marginBottom: 14 }}>
                <ThemedText muted size={12} style={{ marginBottom: 6 }}>
                  {t("rankings.yourRank")}
                </ThemedText>
                <RankRow entry={me} />
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}
