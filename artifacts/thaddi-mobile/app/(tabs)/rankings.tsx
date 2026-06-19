import { Feather } from "@expo/vector-icons";
import {
  getGetCompetitionRankingQueryKey,
  useGetCompetitionRanking,
  type RankingEntry,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React from "react";
import { FlatList, View } from "react-native";

import { CompetitionComingSoon } from "@/components/competition-empty";
import { CompetitionSwitcher } from "@/components/competition-switcher";
import { PlayerLink } from "@/components/social";
import {
  Avatar,
  Card,
  EmptyState,
  LangToggle,
  ListSkeleton,
  type PodiumEntry,
  Podium,
  Screen,
  ScreenHeader,
  SectionTitle,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useCompetition } from "@/lib/competition";
import { useI18n } from "@/lib/i18n";

function RankRow({ entry }: { entry: RankingEntry }) {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const name = entry.displayName ?? entry.username ?? "—";
  const acc =
    entry.accuracy != null ? `${formatNum(Math.round(entry.accuracy * 100))}%` : "—";

  return (
    <PlayerLink userId={entry.userId} style={{ marginBottom: 8 }}>
    <View
      style={{
        flexDirection: rowDir,
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
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
    </PlayerLink>
  );
}

function toPodiumEntry(entry: RankingEntry): PodiumEntry {
  return {
    rank: entry.rank,
    name: entry.displayName ?? entry.username ?? "—",
    avatarUrl: entry.avatarUrl,
    points: entry.points,
    isCurrentUser: entry.isCurrentUser,
    onPress: () => router.push(`/players/${entry.userId}`),
  };
}

export default function RankingsScreen() {
  const c = useColors();
  const { t } = useI18n();
  const { selectedSlug, selectedSeason, comingSoon, isReady } = useCompetition();
  const rankingParams = { season: selectedSeason ?? undefined, limit: 100 };
  const q = useGetCompetitionRanking(selectedSlug ?? "", rankingParams, {
    query: {
      queryKey: getGetCompetitionRankingQueryKey(selectedSlug ?? "", rankingParams),
      enabled: isReady && !!selectedSlug && !comingSoon,
    },
  });
  const entries = q.data?.entries ?? [];
  const me = q.data?.me ?? null;

  // Top 3 headline the podium; everyone from rank 4 down fills the list.
  const top3 = entries.filter((e) => e.rank <= 3);
  const rest = entries.filter((e) => e.rank > 3);

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title={t("rankings.title")}
        subtitle={t("rankings.subtitle")}
        right={<LangToggle />}
      />

      <View style={{ marginBottom: 14 }}>
        <CompetitionSwitcher />
      </View>

      {comingSoon ? (
        <CompetitionComingSoon />
      ) : !isReady || q.isLoading ? (
        <View style={{ paddingTop: 8 }}>
          <ListSkeleton rows={7} />
        </View>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            title={t("rankings.empty")}
            icon={<Feather name="bar-chart-2" size={26} color={c.mutedForeground} />}
          />
        </Card>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(e) => e.userId}
          renderItem={({ item }) => <RankRow entry={item} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 16 }}
          ListHeaderComponent={
            <View>
              {top3.length > 0 ? (
                <View style={{ marginBottom: 8 }}>
                  <Podium entries={top3.map(toPodiumEntry)} />
                </View>
              ) : null}

              {me && !entries.some((e) => e.isCurrentUser) ? (
                <View style={{ marginBottom: 14 }}>
                  <ThemedText muted size={12} style={{ marginBottom: 6 }}>
                    {t("rankings.yourRank")}
                  </ThemedText>
                  <RankRow entry={me} />
                </View>
              ) : null}

              {rest.length > 0 ? (
                <SectionTitle title={t("rankings.standings")} first />
              ) : null}
            </View>
          }
        />
      )}
    </Screen>
  );
}
