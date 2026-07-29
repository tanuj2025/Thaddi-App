import { Feather } from "@expo/vector-icons";
import React from "react";
import { View } from "react-native";

import { Card, EmptyState, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";
import { useCompetition } from "@/lib/competition";
import { useCountdown } from "@/lib/format";

/**
 * Shown when the selected competition's current season has no published fixtures
 * yet (comingSoon). Keeps scoped surfaces — matches, rankings, home — from
 * rendering blank or an ended season's matches. Mirrors the web CompetitionComingSoon.
 */
export function CompetitionComingSoon() {
  const c = useColors();
  const { t, formatNum } = useI18n();
  const { selectedCompetition } = useCompetition();

  const currentSeason = selectedCompetition?.currentSeason;
  const officialStartDate = currentSeason?.officialStartDate;
  const cd = useCountdown(officialStartDate);

  const hasCountdown = cd && !cd.done;

  return (
    <Card>
      <EmptyState
        title={t("competition.comingSoonTitle")}
        subtitle={t("competition.comingSoonDesc")}
        icon={<Feather name="calendar" size={26} color={c.secondary} />}
      />
      {hasCountdown && (
        <View style={{ paddingBottom: 24, alignItems: "center", gap: 12 }}>
          <ThemedText weight="semibold" size={13} muted style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
            {t("landing.countdown.title")}
          </ThemedText>
          <View style={{ flexDirection: "row", gap: 12, direction: "ltr" }}>
            <View style={{ alignItems: "center" }}>
              <ThemedText weight="bold" size={22} color={c.secondary}>
                {formatNum(cd.days)}
              </ThemedText>
              <ThemedText muted size={10}>
                {t("landing.countdown.days")}
              </ThemedText>
            </View>
            <ThemedText weight="bold" size={22} muted>:</ThemedText>
            <View style={{ alignItems: "center" }}>
              <ThemedText weight="bold" size={22} color={c.secondary}>
                {formatNum(cd.hours)}
              </ThemedText>
              <ThemedText muted size={10}>
                {t("landing.countdown.hours")}
              </ThemedText>
            </View>
            <ThemedText weight="bold" size={22} muted>:</ThemedText>
            <View style={{ alignItems: "center" }}>
              <ThemedText weight="bold" size={22} color={c.secondary}>
                {formatNum(cd.minutes)}
              </ThemedText>
              <ThemedText muted size={10}>
                {t("landing.countdown.minutes")}
              </ThemedText>
            </View>
            <ThemedText weight="bold" size={22} muted>:</ThemedText>
            <View style={{ alignItems: "center" }}>
              <ThemedText weight="bold" size={22} color={c.secondary}>
                {formatNum(cd.seconds)}
              </ThemedText>
              <ThemedText muted size={10}>
                {t("landing.countdown.seconds")}
              </ThemedText>
            </View>
          </View>
        </View>
      )}
    </Card>
  );
}
