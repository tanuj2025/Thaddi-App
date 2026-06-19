import {
  GetMatchesScope,
  getGetMatchesQueryKey,
  useGetMatches,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { CompetitionComingSoon } from "@/components/competition-empty";
import { CompetitionSwitcher } from "@/components/competition-switcher";
import { MatchCard } from "@/components/match-card";
import {
  Card,
  EmptyState,
  LangToggle,
  LoadingState,
  Screen,
  ScreenHeader,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useCompetition } from "@/lib/competition";
import { useI18n } from "@/lib/i18n";

const TABS: { scope: GetMatchesScope; key: string }[] = [
  { scope: GetMatchesScope.upcoming, key: "matches.tab.upcoming" },
  { scope: GetMatchesScope.live, key: "matches.tab.live" },
  { scope: GetMatchesScope.finished, key: "matches.tab.finished" },
  { scope: GetMatchesScope.all, key: "matches.tab.all" },
];

export default function MatchesScreen() {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const { selectedSlug, selectedSeason, comingSoon, isReady } = useCompetition();
  const [scope, setScope] = useState<GetMatchesScope>(GetMatchesScope.upcoming);
  const params = {
    scope,
    competitionSlug: selectedSlug ?? undefined,
    season: selectedSeason ?? undefined,
  };
  const q = useGetMatches(params, {
    query: {
      queryKey: getGetMatchesQueryKey(params),
      enabled: isReady && !comingSoon,
    },
  });
  const matches = q.data ?? [];
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const predictable = matches.filter((m) => !m.isLocked);
  const predicted = predictable.filter((m) => m.myPrediction);
  const showSummary = scope === GetMatchesScope.upcoming && predictable.length > 0;
  const allDone = predicted.length === predictable.length;

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title={t("matches.title")}
        subtitle={t("matches.subtitle")}
        right={<LangToggle />}
      />

      <View style={{ marginBottom: 14 }}>
        <CompetitionSwitcher />
      </View>

      {/* segmented tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: rowDir,
          // Fill the width so RTL tabs pack against the right edge.
          flexGrow: 1,
          gap: 8,
          paddingBottom: 4,
        }}
        style={{ flexGrow: 0, marginBottom: 14 }}
      >
        {TABS.map((tab) => {
          const active = tab.scope === scope;
          return (
            <Pressable
              key={tab.scope}
              onPress={() => setScope(tab.scope)}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: active ? c.primary : c.card,
                borderWidth: 1,
                borderColor: active ? c.primary : c.border,
              }}
            >
              <ThemedText
                size={13}
                weight="semibold"
                color={active ? c.primaryForeground : c.mutedForeground}
              >
                {t(tab.key)}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      {showSummary ? (
        <Card style={{ marginBottom: 14, paddingVertical: 12 }}>
          <ThemedText size={13} center weight="semibold" gold={allDone}>
            {allDone
              ? t("matches.summary.allDone")
              : `${formatNum(predicted.length)} ${t("matches.summary.of")} ${formatNum(predictable.length)} ${t("matches.summary.predicted")}`}
          </ThemedText>
        </Card>
      ) : null}

      <View style={{ flex: 1 }}>
        {comingSoon ? (
          <CompetitionComingSoon />
        ) : !isReady || q.isLoading ? (
          <LoadingState />
        ) : matches.length === 0 ? (
          <Card>
            <EmptyState title={t("matches.empty")} />
          </Card>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
            {matches.map((m) => (
              <MatchCard key={m.id} match={m} onPress={() => router.push(`/match/${m.id}`)} />
            ))}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}
