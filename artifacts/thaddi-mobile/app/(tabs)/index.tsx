import {
  GetMatchesScope,
  useGetMatches,
  useGetMe,
  useGetMyGamification,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React from "react";
import { View } from "react-native";

import { MatchCard } from "@/components/match-card";
import { NotificationsBell } from "@/components/notifications-bell";
import {
  Card,
  Divider,
  EmptyState,
  LangToggle,
  LoadingState,
  Pill,
  ProgressBar,
  Screen,
  ScreenHeader,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

export default function HomeScreen() {
  const c = useColors();
  const { t, lang, dir, formatNum } = useI18n();

  const meQ = useGetMe();
  const gamQ = useGetMyGamification();
  const liveQ = useGetMatches({ scope: GetMatchesScope.live });
  const upcomingQ = useGetMatches({ scope: GetMatchesScope.upcoming });

  const me = meQ.data;
  const gam = gamQ.data;
  const live = liveQ.data ?? [];
  const upcoming = (upcomingQ.data ?? []).slice(0, 5);
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const levelName =
    gam && (lang === "ar" ? gam.levelProgress.nameAr : gam.levelProgress.nameEn);
  const nextLevelName =
    gam &&
    (lang === "ar" ? gam.levelProgress.nextLevelNameAr : gam.levelProgress.nextLevelNameEn);

  return (
    <Screen scroll>
      <ScreenHeader
        title={t("app.name")}
        subtitle={
          me?.displayName
            ? `${t("home.welcome")}${lang === "ar" ? "، " : ", "}${me.displayName}`
            : t("home.welcome")
        }
        right={
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 12 }}>
            <NotificationsBell />
            <LangToggle />
          </View>
        }
      />

      {/* level / points card */}
      <Card>
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View>
            <ThemedText muted size={12}>
              {t("home.level")}
            </ThemedText>
            <ThemedText weight="extrabold" size={20} gold>
              {levelName ?? me?.level ?? "—"}
            </ThemedText>
          </View>
          <View style={{ alignItems: dir === "rtl" ? "flex-start" : "flex-end" }}>
            <ThemedText muted size={12}>
              {t("home.points")}
            </ThemedText>
            <ThemedText weight="extrabold" size={20}>
              {formatNum(me?.totalPoints ?? 0)}
            </ThemedText>
          </View>
        </View>

        {gam && gam.levelProgress.nextLevel ? (
          <View style={{ marginTop: 14 }}>
            <ProgressBar percent={gam.levelProgress.progressPercent} />
            <View
              style={{
                flexDirection: rowDir,
                justifyContent: "space-between",
                marginTop: 6,
              }}
            >
              <ThemedText muted size={11}>
                {formatNum(gam.levelProgress.progressPercent)}%
              </ThemedText>
              {nextLevelName ? (
                <ThemedText muted size={11}>
                  {t("profile.nextLevel")}: {nextLevelName}
                </ThemedText>
              ) : null}
            </View>
          </View>
        ) : null}
      </Card>

      {/* live */}
      {live.length > 0 ? (
        <View style={{ marginTop: 22 }}>
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ThemedText weight="bold" size={17}>
              {t("matches.tab.live")}
            </ThemedText>
            <Pill tone="live" label={formatNum(live.length)} />
          </View>
          {live.map((m) => (
            <MatchCard key={m.id} match={m} onPress={() => router.push(`/match/${m.id}`)} />
          ))}
        </View>
      ) : null}

      {/* upcoming */}
      <View style={{ marginTop: 22 }}>
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <ThemedText weight="bold" size={17}>
            {t("matches.tab.upcoming")}
          </ThemedText>
          <ThemedText
            gold
            size={13}
            onPress={() => router.push("/(tabs)/matches")}
          >
            {t("home.viewAll")}
          </ThemedText>
        </View>

        {upcomingQ.isLoading ? (
          <LoadingState />
        ) : upcoming.length === 0 ? (
          <Card>
            <EmptyState title={t("matches.empty")} />
          </Card>
        ) : (
          upcoming.map((m) => (
            <MatchCard key={m.id} match={m} onPress={() => router.push(`/match/${m.id}`)} />
          ))
        )}
      </View>

      <Divider style={{ marginTop: 24, opacity: 0 }} />
    </Screen>
  );
}
