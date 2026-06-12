import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMatchQueryKey,
  getGetMatchesQueryKey,
  getGetPredictionHistoryQueryKey,
  useGetMatch,
  useGetPredictionHistory,
  useSubmitPrediction,
  type ParticipantPrediction,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import {
  Avatar,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  Screen,
  TeamFlag,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatDateTime, useCountdown } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function MatchDetailScreen() {
  const c = useColors();
  const { t, lang, dir, formatNum } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const q = useGetMatch(id ?? "", {
    query: { enabled: !!id, queryKey: getGetMatchQueryKey(id ?? "") },
  });
  const historyQ = useGetPredictionHistory(id ?? "", {
    query: { enabled: !!id, queryKey: getGetPredictionHistoryQueryKey(id ?? "") },
  });
  const match = q.data;
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const submit = useSubmitPrediction();
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (match?.myPrediction) {
      setHome(match.myPrediction.homeScore);
      setAway(match.myPrediction.awayScore);
    }
  }, [match?.myPrediction]);

  const countdown = useCountdown(
    match && !match.isLocked ? match.predictionLockAt ?? null : null,
  );

  const isLive = match?.status === "live" || match?.status === "half_time";
  const isFinished = match?.status === "finished" || match?.status === "full_time";
  const showScore =
    (isLive || isFinished) && match?.homeScore != null && match?.awayScore != null;

  const home_ = match?.homeTeam;
  const away_ = match?.awayTeam;
  const homeName = home_ ? (lang === "ar" ? home_.nameAr : home_.nameEn) : "—";
  const awayName = away_ ? (lang === "ar" ? away_.nameAr : away_.nameEn) : "—";

  const locked = match?.isLocked ?? true;

  const savePrediction = () => {
    if (!id) return;
    setSaveError(null);
    submit.mutate(
      { id, data: { homeScore: home, awayScore: away } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMatchQueryKey(id) });
          void queryClient.invalidateQueries({
            queryKey: getGetPredictionHistoryQueryKey(id),
          });
          void queryClient.invalidateQueries({ queryKey: getGetMatchesQueryKey() });
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2000);
        },
        onError: (err) =>
          setSaveError(err.data?.error || t("match.predictionError")),
      },
    );
  };

  return (
    <Screen scroll>
      {/* back header */}
      <View style={{ flexDirection: rowDir, alignItems: "center", marginBottom: 14 }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: 4 }}>
          <Feather
            name={dir === "rtl" ? "chevron-right" : "chevron-left"}
            size={26}
            color={c.foreground}
          />
        </Pressable>
        <ThemedText weight="bold" size={16} style={{ marginHorizontal: 6 }}>
          {match?.stageType ?? t("match.result")}
        </ThemedText>
      </View>

      {q.isLoading ? (
        <LoadingState />
      ) : q.isError || !match ? (
        <ErrorState
          message={t("common.loadError")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          {/* scoreboard */}
          <Card>
            <View style={{ flexDirection: rowDir, alignItems: "center" }}>
              <View style={{ flex: 1, alignItems: "center", gap: 8 }}>
                <TeamFlag uri={home_?.flagUrl} size={56} />
                <ThemedText weight="semibold" size={15} center numberOfLines={2}>
                  {homeName}
                </ThemedText>
              </View>
              <View style={{ paddingHorizontal: 12, alignItems: "center", gap: 6 }}>
                {showScore ? (
                  <ThemedText weight="extrabold" size={34}>
                    {formatNum(match.homeScore ?? 0)} - {formatNum(match.awayScore ?? 0)}
                  </ThemedText>
                ) : (
                  <ThemedText muted weight="bold" size={20}>
                    {t("match.vs")}
                  </ThemedText>
                )}
                {isLive ? (
                  <Pill
                    tone="live"
                    label={
                      match.status === "half_time"
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
              <View style={{ flex: 1, alignItems: "center", gap: 8 }}>
                <TeamFlag uri={away_?.flagUrl} size={56} />
                <ThemedText weight="semibold" size={15} center numberOfLines={2}>
                  {awayName}
                </ThemedText>
              </View>
            </View>

            <Divider />

            <View style={{ gap: 6 }}>
              <InfoRow
                label={t("match.kickoff")}
                value={formatDateTime(match.kickoffAt, lang)}
                dir={rowDir}
              />
              {match.venue ? (
                <InfoRow label={t("match.venue")} value={match.venue} dir={rowDir} />
              ) : null}
            </View>

            {countdown && !countdown.done ? (
              <View style={{ marginTop: 12 }}>
                <Pill
                  tone="gold"
                  label={`${t("match.lockCountdown")} ${countdown.days > 0 ? `${formatNum(countdown.days)}${t("match.days")} ` : ""}${formatNum(countdown.hours)}:${String(countdown.minutes).padStart(2, "0")}:${String(countdown.seconds).padStart(2, "0")}`}
                />
              </View>
            ) : null}
          </Card>

          {/* my prediction (editable until lock) */}
          <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
            {t("match.yourPrediction")}
          </ThemedText>
          <Card>
            {locked ? (
              <View style={{ gap: 14 }}>
                <View
                  style={{
                    flexDirection: rowDir,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Feather name="lock" size={15} color={c.mutedForeground} />
                  <ThemedText muted size={13}>
                    {t("match.lockedMsg")}
                  </ThemedText>
                </View>
                {match.myPrediction ? (
                  <View
                    style={{
                      flexDirection: rowDir,
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <ThemedText weight="extrabold" size={22}>
                      {formatNum(match.myPrediction.homeScore)} -{" "}
                      {formatNum(match.myPrediction.awayScore)}
                    </ThemedText>
                    {match.myPrediction.scoredAt ? (
                      <Pill
                        tone={
                          match.myPrediction.outcome === "exact"
                            ? "gold"
                            : match.myPrediction.outcome === "winner"
                              ? "green"
                              : "neutral"
                        }
                        label={`${t("match.yourPoints")}: ${formatNum(match.myPrediction.pointsAwarded)}`}
                      />
                    ) : (
                      <Pill tone="neutral" label={t("matches.predicted")} />
                    )}
                  </View>
                ) : (
                  <ThemedText muted size={14} center>
                    {t("matches.notPredicted")}
                  </ThemedText>
                )}
              </View>
            ) : (
              <View style={{ gap: 18 }}>
                <View
                  style={{
                    flexDirection: rowDir,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 18,
                  }}
                >
                  <ScoreStepper
                    label={homeName}
                    value={home}
                    onChange={setHome}
                    disabled={submit.isPending}
                  />
                  <ThemedText muted weight="bold" size={22} style={{ marginTop: 22 }}>
                    -
                  </ThemedText>
                  <ScoreStepper
                    label={awayName}
                    value={away}
                    onChange={setAway}
                    disabled={submit.isPending}
                  />
                </View>

                <Button
                  label={justSaved ? t("match.savedInline") : t("match.savePrediction")}
                  onPress={savePrediction}
                  loading={submit.isPending}
                  disabled={justSaved}
                  icon={
                    justSaved ? (
                      <Feather name="check" size={16} color={c.primaryForeground} />
                    ) : undefined
                  }
                />

                {saveError ? (
                  <ThemedText size={13} color={c.destructive} center>
                    {saveError}
                  </ThemedText>
                ) : null}
              </View>
            )}
          </Card>

          {/* prediction history */}
          {(historyQ.data?.length ?? 0) > 0 ? (
            <>
              <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
                {t("match.history")}
              </ThemedText>
              <Card>
                {historyQ.data!.map((h, i) => (
                  <View key={h.id}>
                    {i > 0 ? <Divider /> : null}
                    <View
                      style={{
                        flexDirection: rowDir,
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <ThemedText weight="semibold" size={14}>
                        {formatNum(h.homeScore)} - {formatNum(h.awayScore)}
                      </ThemedText>
                      <ThemedText muted size={12}>
                        {formatDateTime(h.recordedAt, lang)}
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/* participants */}
          <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
            {t("match.allPredictions")}
          </ThemedText>
          <Card>
            {!match.revealed ? (
              <EmptyState title={t("match.predictionsHidden")} />
            ) : match.participantPredictions.length === 0 ? (
              <EmptyState title={t("match.noPredictions")} />
            ) : (
              match.participantPredictions.map((p, i) => (
                <View key={p.userId}>
                  {i > 0 ? <Divider /> : null}
                  <ParticipantRow p={p} dir={rowDir} />
                </View>
              ))
            )}
          </Card>

          <View style={{ height: 24 }} />
        </>
      )}
    </Screen>
  );
}

function ScoreStepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const c = useColors();
  const { formatNum } = useI18n();

  const StepButton = ({
    icon,
    onPress,
    isDisabled,
  }: {
    icon: "minus" | "plus";
    onPress: () => void;
    isDisabled: boolean;
  }) => (
    <Pressable
      onPress={() => {
        if (!isDisabled) onPress();
      }}
      disabled={isDisabled}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.card,
        alignItems: "center",
        justifyContent: "center",
        opacity: isDisabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Feather name={icon} size={18} color={c.foreground} />
    </Pressable>
  );

  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      <ThemedText muted size={13} center numberOfLines={1} style={{ maxWidth: 96 }}>
        {label}
      </ThemedText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <StepButton
          icon="minus"
          onPress={() => onChange(Math.max(0, value - 1))}
          isDisabled={disabled || value <= 0}
        />
        <ThemedText weight="extrabold" size={30} style={{ minWidth: 40, textAlign: "center" }}>
          {formatNum(value)}
        </ThemedText>
        <StepButton
          icon="plus"
          onPress={() => onChange(Math.min(99, value + 1))}
          isDisabled={disabled || value >= 99}
        />
      </View>
    </View>
  );
}

function InfoRow({
  label,
  value,
  dir,
}: {
  label: string;
  value: string;
  dir: "row" | "row-reverse";
}) {
  return (
    <View style={{ flexDirection: dir, alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <ThemedText muted size={13}>
        {label}
      </ThemedText>
      <ThemedText size={13} weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </ThemedText>
    </View>
  );
}

function ParticipantRow({
  p,
  dir,
}: {
  p: ParticipantPrediction;
  dir: "row" | "row-reverse";
}) {
  const { formatNum } = useI18n();
  const name = p.displayName ?? "—";
  const tone =
    p.outcome === "exact" ? "gold" : p.outcome === "winner" ? "green" : "neutral";
  return (
    <View style={{ flexDirection: dir, alignItems: "center", gap: 12 }}>
      <Avatar uri={p.avatarUrl} name={name} size={34} />
      <ThemedText size={14} weight="semibold" style={{ flex: 1 }} numberOfLines={1}>
        {name}
      </ThemedText>
      <ThemedText size={14} weight="bold">
        {formatNum(p.homeScore)} - {formatNum(p.awayScore)}
      </ThemedText>
      <Pill tone={tone} label={`+${formatNum(p.pointsAwarded)}`} />
    </View>
  );
}
