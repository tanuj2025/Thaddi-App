import { Feather } from "@expo/vector-icons";
import type { MatchSummary } from "@workspace/api-client-react";
import React from "react";
import { Platform, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Card, Pill, TeamFlag, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { compactCountdown, formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export function MatchCard({
  match,
  onPress,
}: {
  match: MatchSummary;
  onPress: () => void;
}) {
  const c = useColors();
  const { t, lang, dir, formatNum } = useI18n();

  const isLive = match.status === "live" || match.status === "half_time";
  const isHalftime = match.status === "half_time";
  const isFinished = match.status === "finished" || match.status === "full_time";
  const showScore =
    (isLive || isFinished) &&
    match.homeScore != null &&
    match.awayScore != null;

  const home = match.homeTeam;
  const away = match.awayTeam;
  const homeName = home ? (lang === "ar" ? home.nameAr : home.nameEn) : "—";
  const awayName = away ? (lang === "ar" ? away.nameAr : away.nameEn) : "—";

  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const pred = match.myPrediction;
  const locksIn =
    !match.isLocked && match.predictionLockAt
      ? compactCountdown(match.predictionLockAt, t)
      : null;

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== "web") {
          void Haptics.selectionAsync();
        }
        onPress();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 12 })}
    >
      <Card>
        {/* header: stage + status */}
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <ThemedText muted size={11} numberOfLines={1} style={{ flexShrink: 1 }}>
            {match.stageType ?? ""}
          </ThemedText>
          {isLive ? (
            <Pill
              tone="live"
              label={
                isHalftime
                  ? t("matches.halftime")
                  : match.minute != null
                    ? `${formatNum(match.minute)}'`
                    : t("matches.live")
              }
            />
          ) : isFinished ? (
            <Pill tone="neutral" label={t("matches.ended")} />
          ) : null}
        </View>

        {/* teams + score */}
        <View style={{ flexDirection: rowDir, alignItems: "center" }}>
          <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
            <TeamFlag uri={home?.flagUrl} size={40} />
            <ThemedText weight="semibold" size={13} center numberOfLines={1}>
              {homeName}
            </ThemedText>
          </View>

          <View style={{ paddingHorizontal: 10, alignItems: "center", minWidth: 64 }}>
            {showScore ? (
              <ThemedText weight="extrabold" size={22}>
                {formatNum(match.homeScore ?? 0)} - {formatNum(match.awayScore ?? 0)}
              </ThemedText>
            ) : (
              <ThemedText muted weight="bold" size={14}>
                {t("matches.vs")}
              </ThemedText>
            )}
          </View>

          <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
            <TeamFlag uri={away?.flagUrl} size={40} />
            <ThemedText weight="semibold" size={13} center numberOfLines={1}>
              {awayName}
            </ThemedText>
          </View>
        </View>

        {/* footer: kickoff + prediction state */}
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 14,
            gap: 8,
          }}
        >
          <ThemedText muted size={12} numberOfLines={1} style={{ flexShrink: 1 }}>
            {isFinished
              ? t("matches.finalScore")
              : isLive
                ? t("matches.live")
                : formatDateTime(match.kickoffAt, lang)}
          </ThemedText>

          {pred ? (
            <View style={{ flexDirection: rowDir, alignItems: "center", gap: 6 }}>
              <Feather name="check-circle" size={13} color={c.primary} />
              <ThemedText size={12} weight="semibold" color={c.primary}>
                {formatNum(pred.homeScore)}-{formatNum(pred.awayScore)}
                {pred.scoredAt ? ` · +${formatNum(pred.pointsAwarded)}` : ""}
              </ThemedText>
            </View>
          ) : locksIn ? (
            <Pill tone="gold" label={`${t("matches.locksIn")} ${locksIn}`} />
          ) : (
            <Pill tone="neutral" label={t("matches.locked")} />
          )}
        </View>
      </Card>
    </Pressable>
  );
}
