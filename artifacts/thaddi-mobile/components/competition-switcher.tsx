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
          justifyContent: "space-between",
          minHeight: 56,
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.card,
          shadowColor: "#000",
          shadowOpacity: 0.1,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            gap: 12,
            flex: 1,
            minWidth: 0,
            marginEnd: 8,
          }}
        >
          <CompetitionCrest competition={selectedCompetition} size={28} />
          <View style={{ flex: 1 }}>
            <ThemedText weight="bold" size={14} numberOfLines={1}>
              {labelCompetition(selectedCompetition, lang)}
            </ThemedText>
            {selectedSeason ? (
              <ThemedText muted size={11} style={{ marginTop: 2 }}>
                {ltrIsolate(selectedSeason)}
              </ThemedText>
            ) : null}
          </View>
        </View>

        <Feather name="chevron-down" size={18} color={c.mutedForeground} />
      </PressableScale>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={t("competition.select")}>
        <View style={{ gap: 12 }}>
          {Array.from({ length: Math.ceil(competitions.length / 2) }).map((_, rowIndex) => {
            const pair = competitions.slice(rowIndex * 2, rowIndex * 2 + 2);
            return (
              <View key={rowIndex} style={{ flexDirection: rowDir, gap: 12 }}>
                {pair.map((comp) => {
                  const isSelected = comp.competitionSlug === selectedCompetition.competitionSlug;
                  const currentSeason = comp.currentSeason;
                  let isComingSoon = false;
                  if (!currentSeason) {
                    isComingSoon = true;
                  } else if (currentSeason.officialStartDate) {
                    const start = new Date(currentSeason.officialStartDate).getTime();
                    isComingSoon = Date.now() < start || !!currentSeason.comingSoon;
                  } else {
                    isComingSoon = !!currentSeason.comingSoon;
                  }
                  return (
                    <View key={comp.competitionSlug} style={{ flex: 1 }}>
                      <PressableScale
                        onPress={() => pick(comp.competitionSlug)}
                        testID={`competition-option-${comp.competitionSlug}`}
                        style={{
                          width: "100%",
                          borderRadius: 16,
                          borderWidth: isSelected ? 2 : 1,
                          borderColor: isSelected ? c.secondary : c.border,
                          backgroundColor: isSelected ? c.secondary + "0C" : c.background,
                          paddingVertical: 16,
                          paddingHorizontal: 10,
                          alignItems: "center",
                          justifyContent: "center",
                          position: "relative",
                          shadowColor: isSelected ? c.secondary : "#000",
                          shadowOpacity: isSelected ? 0.12 : 0.05,
                          shadowRadius: 8,
                          shadowOffset: { width: 0, height: 4 },
                          elevation: isSelected ? 4 : 1,
                        }}
                      >
                        {isSelected && (
                          <View
                            style={{
                              position: "absolute",
                              top: 8,
                              right: dir === "rtl" ? undefined : 8,
                              left: dir === "rtl" ? 8 : undefined,
                              width: 18,
                              height: 18,
                              borderRadius: 9,
                              backgroundColor: c.secondary,
                              alignItems: "center",
                              justifyContent: "center",
                              zIndex: 10,
                            }}
                          >
                            <Feather name="check" size={11} color={c.secondaryForeground} />
                          </View>
                        )}

                        <CompetitionCrest competition={comp} size={40} />

                        <ThemedText
                          weight="bold"
                          size={13}
                          center
                          numberOfLines={2}
                          style={{ marginTop: 10, minHeight: 36, textAlign: "center" }}
                        >
                          {labelCompetition(comp, lang)}
                        </ThemedText>

                        <View style={{ marginTop: 8 }}>
                          {isComingSoon ? (
                            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: c.muted }}>
                              <ThemedText muted size={10} weight="bold">
                                {t("competition.comingSoon")}
                              </ThemedText>
                            </View>
                          ) : comp.currentSeason?.season ? (
                            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: isSelected ? c.secondary + "25" : c.muted }}>
                              <ThemedText size={10} weight="bold" color={isSelected ? c.secondary : undefined}>
                                {ltrIsolate(comp.currentSeason.season)}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                      </PressableScale>
                    </View>
                  );
                })}
                {pair.length === 1 && <View style={{ flex: 1 }} />}
              </View>
            );
          })}
        </View>

        {showSeasonPicker ? (
          <View style={{ gap: 10, marginTop: 24 }}>
            <ThemedText muted size={11} weight="extrabold" style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
              {t("competition.season")}
            </ThemedText>
            <View style={{ flexDirection: rowDir, flexWrap: "wrap", gap: 8 }}>
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
                      gap: 8,
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: isSelected ? c.secondary : c.border,
                      backgroundColor: isSelected ? c.secondary + "1A" : c.background,
                    }}
                  >
                    <ThemedText weight="semibold" size={13} color={isSelected ? c.secondary : undefined}>
                      {ltrIsolate(s.season ?? "")}
                    </ThemedText>
                    {isCurrent ? (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 4, backgroundColor: c.accent }}>
                        <ThemedText muted size={9} weight="bold">
                          {t("competition.currentSeasonBadge")}
                        </ThemedText>
                      </View>
                    ) : null}
                  </PressableScale>
                );
              })}
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </>
  );
}
