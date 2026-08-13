import {
  GetMatchesScope,
  getGetMatchesQueryKey,
  useGetMatches,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { ScrollView, View } from "react-native";

import { CompetitionComingSoon } from "@/components/competition-empty";
import { CompetitionSwitcher } from "@/components/competition-switcher";
import { MatchCard } from "@/components/match-card";
import {
  Button,
  Card,
  EmptyState,
  LangToggle,
  LoadingState,
  MatchCardSkeleton,
  PressableScale,
  Screen,
  ScreenHeader,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useCompetition } from "@/lib/competition";
import { rowDirection, useI18n } from "@/lib/i18n";
import { liveRefetchIntervalMs } from "@/lib/matchLive";

const TABS: { scope: GetMatchesScope; key: string }[] = [
  { scope: GetMatchesScope.live, key: "matches.tab.live" },
  { scope: GetMatchesScope.upcoming, key: "matches.tab.upcoming" },
  { scope: GetMatchesScope.finished, key: "matches.tab.finished" },
  { scope: GetMatchesScope.all, key: "matches.tab.all" },
];

export default function MatchesScreen() {
  const c = useColors();
  const { t, lang, dir, formatNum } = useI18n();
  const { selectedSlug, selectedSeason, comingSoon, isReady } = useCompetition();
  const [scope, setScope] = useState<GetMatchesScope>(GetMatchesScope.live);
  const params = {
    scope,
    competitionSlug: selectedSlug ?? undefined,
    season: selectedSeason ?? undefined,
  };
  const q = useGetMatches(params, {
    query: {
      queryKey: getGetMatchesQueryKey(params),
      enabled: isReady && !!selectedSlug && !comingSoon,
      refetchInterval: (query) => liveRefetchIntervalMs(query.state.data),
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

      <View style={{ marginBottom: 16 }}>
        <CompetitionSwitcher />
      </View>

      {/* segmented tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: rowDir,
          flexGrow: 1,
          gap: 10,
          paddingVertical: 4,
          paddingHorizontal: 2,
        }}
        style={{ flexGrow: 0, marginBottom: 18 }}
      >
        {TABS.map((tab) => {
          const active = tab.scope === scope;
          return (
            <PressableScale
              key={tab.scope}
              onPress={() => setScope(tab.scope)}
              style={{
                height: 48,
                paddingHorizontal: 22,
                borderRadius: 24,
                backgroundColor: active ? c.primary : c.card,
                borderWidth: 1,
                borderColor: active ? c.primary : c.border,
                flexDirection: rowDir,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: active ? c.primary : "#000",
                shadowOpacity: active ? 0.15 : 0.05,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 3 },
                elevation: active ? 4 : 1,
              }}
            >
              <ThemedText
                size={14}
                weight="bold"
                color={active ? c.primaryForeground : c.mutedForeground}
              >
                {t(tab.key)}
              </ThemedText>
            </PressableScale>
          );
        })}
      </ScrollView>

      {showSummary ? (
        <Card style={{ marginBottom: 16, paddingVertical: 12 }}>
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
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16, gap: 10 }}>
            <MatchCardSkeleton />
            <MatchCardSkeleton />
            <MatchCardSkeleton />
          </ScrollView>
        ) : matches.length === 0 ? (
          <View style={{ flex: 1, justifyContent: "center", paddingBottom: 64 }}>
            <EmptyState
              title={
                scope === GetMatchesScope.live
                  ? t("matches.emptyLive")
                  : t("matches.empty")
              }
              subtitle={
                scope === GetMatchesScope.live
                  ? (lang === "ar" ? "تفقد جدول المباريات القادمة لتوقع النتائج مبكراً." : "Check back later or explore upcoming fixtures to place your predictions.")
                  : (lang === "ar" ? "لا توجد مباريات مجدولة لهذه الجولة بعد." : "No fixtures scheduled for this period yet.")
              }
              icon={
                scope === GetMatchesScope.live ? (
                  <Feather name="activity" size={30} color={c.primary} />
                ) : (
                  <Feather name="calendar" size={30} color={c.mutedForeground} />
                )
              }
              action={
                scope === GetMatchesScope.live ? (
                  <Button
                    label={t("matches.tab.upcoming")}
                    onPress={() => setScope(GetMatchesScope.upcoming)}
                    variant="outline"
                    size="sm"
                    fullWidth={false}
                    testID="button-empty-live-upcoming"
                  />
                ) : undefined
              }
            />
          </View>
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
