import { Feather } from "@expo/vector-icons";
import type { Competition } from "@workspace/api-client-react";
import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

import { BottomSheet, PressableScale, Skeleton, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { labelCompetition, useCompetition } from "@/lib/competition";
import { ltrIsolate, useI18n } from "@/lib/i18n";

function CompetitionCrest({
  competition,
  size = 24,
}: {
  competition: Competition;
  size?: number;
}) {
  const c = useColors();
  const { lang } = useI18n();
  if (competition.logoUrl) {
    return (
      <Image
        source={{ uri: competition.logoUrl }}
        accessibilityLabel={labelCompetition(competition, lang)}
        style={{ width: size, height: size, resizeMode: "contain" }}
      />
    );
  }
  return <Feather name="award" size={size} color={c.secondary} />;
}

/**
 * The one obvious control for picking which competition (and its current season)
 * the scoped surfaces — home, matches, rankings — read from. A compact chip that
 * opens a bottom-sheet list. Mirrors the web CompetitionSwitcher; RN bottom-sheet
 * instead of a dropdown.
 */
export function CompetitionSwitcher() {
  const c = useColors();
  const { t, lang, dir } = useI18n();
  const {
    competitions,
    selectedCompetition,
    selectedSeason,
    availableSeasons,
    isLoading,
    setCompetition,
    setSeason,
  } = useCompetition();
  const [open, setOpen] = useState(false);
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  if (isLoading) {
    return <Skeleton width={176} height={40} radius={14} />;
  }

  if (competitions.length === 0 || !selectedCompetition) {
    return null;
  }

  const pick = (slug: string) => {
    setCompetition(slug);
    setOpen(false);
  };

  const pickSeason = (season: string | null) => {
    setSeason(season);
    setOpen(false);
  };

  // Show the season list only when there's a real choice: more than one
  // published season, or the effective season isn't the sole published one
  // (e.g. a coming-soon current season with one past board to browse).
  const showSeasonPicker =
    availableSeasons.length > 1 ||
    (availableSeasons.length === 1 && !availableSeasons.some((s) => s.season === selectedSeason));

  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        accessibilityLabel={t("competition.switcherLabel")}
        testID="button-competition-switcher"
        style={{
          flexDirection: rowDir,
          alignItems: "center",
          gap: 10,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 14,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          backgroundColor: c.card,
        }}
      >
        <CompetitionCrest competition={selectedCompetition} size={20} />
        <View style={{ flexShrink: 1 }}>
          <ThemedText weight="bold" size={14} numberOfLines={1}>
            {labelCompetition(selectedCompetition, lang)}
          </ThemedText>
          {selectedSeason ? (
            <ThemedText muted size={11}>
              {ltrIsolate(selectedSeason)}
            </ThemedText>
          ) : null}
        </View>
        <Feather name="chevron-down" size={16} color={c.mutedForeground} />
      </PressableScale>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={t("competition.select")}>
        <View style={{ gap: 8 }}>
          {competitions.map((comp) => {
            const isSelected = comp.competitionSlug === selectedCompetition.competitionSlug;
            const isComingSoon = !!comp.currentSeason?.comingSoon;
            return (
              <PressableScale
                key={comp.competitionSlug}
                onPress={() => pick(comp.competitionSlug)}
                testID={`competition-option-${comp.competitionSlug}`}
                style={{
                  flexDirection: rowDir,
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: isSelected ? c.secondary : c.border,
                  backgroundColor: isSelected ? c.secondary + "1A" : c.background,
                }}
              >
                <CompetitionCrest competition={comp} size={26} />
                <View style={{ flex: 1 }}>
                  <ThemedText weight="semibold" size={15} numberOfLines={1}>
                    {labelCompetition(comp, lang)}
                  </ThemedText>
                  {isComingSoon ? (
                    <ThemedText muted size={12}>
                      {t("competition.comingSoon")}
                    </ThemedText>
                  ) : comp.currentSeason?.season ? (
                    <ThemedText muted size={12}>
                      {ltrIsolate(comp.currentSeason.season)}
                    </ThemedText>
                  ) : null}
                </View>
                {isSelected ? (
                  <Feather name="check" size={18} color={c.secondary} />
                ) : null}
              </PressableScale>
            );
          })}
        </View>

        {showSeasonPicker ? (
          <View style={{ gap: 8, marginTop: 16 }}>
            <ThemedText muted size={12} weight="semibold">
              {t("competition.season")}
            </ThemedText>
            {availableSeasons.map((s) => {
              const isCurrent = s.season === selectedCompetition.currentSeason?.season;
              const isSelected = s.season === selectedSeason;
              return (
                <PressableScale
                  key={s.season ?? "null"}
                  onPress={() => pickSeason(s.season ?? null)}
                  testID={`season-option-${s.season}`}
                  style={{
                    flexDirection: rowDir,
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: isSelected ? c.secondary : c.border,
                    backgroundColor: isSelected ? c.secondary + "1A" : c.background,
                  }}
                >
                  <ThemedText weight="semibold" size={15} style={{ flex: 1 }}>
                    {ltrIsolate(s.season ?? "")}
                  </ThemedText>
                  {isCurrent ? (
                    <ThemedText muted size={12}>
                      {t("competition.currentSeasonBadge")}
                    </ThemedText>
                  ) : null}
                  {isSelected ? (
                    <Feather name="check" size={18} color={c.secondary} />
                  ) : null}
                </PressableScale>
              );
            })}
          </View>
        ) : null}
      </BottomSheet>
    </>
  );
}
