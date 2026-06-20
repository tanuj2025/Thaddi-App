import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMatchComparisonQueryKey,
  getGetMatchQueryKey,
  getGetMatchTrendsQueryKey,
  getGetMatchesQueryKey,
  getGetPredictionHistoryQueryKey,
  useGetMatch,
  useGetMatchComparison,
  useGetMatchTrends,
  useGetPredictionHistory,
  useSubmitPrediction,
  type ComparisonOutcomeKey,
  type ParticipantPrediction,
  type PredictionComparison,
  type PredictionTrends,
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
  GlowCard,
  Pill,
  PressableScale,
  ProgressBar,
  Reveal,
  Screen,
  SectionTitle,
  Skeleton,
  StatCell,
  TeamFlag,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatDateTime, useCountdown } from "@/lib/format";
import { ltrIsolate, useI18n } from "@/lib/i18n";

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

  const hasKickedOff = match?.hasKickedOff ?? false;
  const trendsQ = useGetMatchTrends(id ?? "", {
    query: { enabled: !!id && hasKickedOff, queryKey: getGetMatchTrendsQueryKey(id ?? "") },
  });
  const comparisonQ = useGetMatchComparison(id ?? "", {
    query: {
      enabled: !!id && hasKickedOff,
      queryKey: getGetMatchComparisonQueryKey(id ?? ""),
    },
  });

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
        <MatchDetailSkeleton />
      ) : q.isError || !match ? (
        <ErrorState
          message={t("common.loadError")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          {/* scoreboard hero */}
          <Reveal>
            <GlowCard tone={isLive ? "green" : "gold"}>
              <View style={{ flexDirection: rowDir, alignItems: "flex-start" }}>
                <View style={{ flex: 1, alignItems: "center", gap: 10 }}>
                  <TeamFlag uri={home_?.flagUrl} size={64} />
                  <ThemedText weight="bold" size={15} center numberOfLines={2}>
                    {homeName}
                  </ThemedText>
                </View>
                <View style={{ paddingHorizontal: 12, alignItems: "center", gap: 8, paddingTop: 14 }}>
                  {showScore ? (
                    <ThemedText
                      weight="extrabold"
                      size={40}
                      style={{ writingDirection: "ltr" }}
                    >
                      {ltrIsolate(
                        `${formatNum(match.homeScore ?? 0)} - ${formatNum(match.awayScore ?? 0)}`,
                      )}
                    </ThemedText>
                  ) : (
                    <ThemedText muted weight="bold" size={22}>
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
                <View style={{ flex: 1, alignItems: "center", gap: 10 }}>
                  <TeamFlag uri={away_?.flagUrl} size={64} />
                  <ThemedText weight="bold" size={15} center numberOfLines={2}>
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
                <View style={{ marginTop: 16, alignItems: "center", gap: 5 }}>
                  <View style={{ flexDirection: rowDir, alignItems: "center", gap: 6 }}>
                    <Feather name="clock" size={13} color={c.thaddiGold} />
                    <ThemedText gold size={12} weight="semibold">
                      {t("match.lockCountdown")}
                    </ThemedText>
                  </View>
                  <ThemedText
                    gold
                    weight="extrabold"
                    size={24}
                    style={{ writingDirection: "ltr" }}
                  >
                    {ltrIsolate(
                      `${countdown.days > 0 ? `${formatNum(countdown.days)}${t("match.days")} ` : ""}${formatNum(countdown.hours)}:${String(countdown.minutes).padStart(2, "0")}:${String(countdown.seconds).padStart(2, "0")}`,
                    )}
                  </ThemedText>
                </View>
              ) : null}
            </GlowCard>
          </Reveal>

          {/* my prediction (editable until lock) */}
          <SectionTitle title={t("match.yourPrediction")} />
          <Card glow={!locked ? "green" : undefined}>
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

                {justSaved ? (
                  <Reveal distance={8}>
                    <View
                      style={{
                        flexDirection: rowDir,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <Feather name="check-circle" size={16} color={c.primary} />
                      <ThemedText weight="bold" size={13} color={c.primary}>
                        {t("match.predictionSaved")}
                      </ThemedText>
                    </View>
                  </Reveal>
                ) : null}

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
              <SectionTitle title={t("match.history")} />
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
                      <ThemedText weight="semibold" size={14} style={{ writingDirection: "ltr" }}>
                        {ltrIsolate(`${formatNum(h.homeScore)} - ${formatNum(h.awayScore)}`)}
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

          {/* analytics — trends + comparison (post-kickoff only) */}
          {hasKickedOff ? (
            <MatchAnalytics
              trends={trendsQ.data}
              comparison={comparisonQ.data}
              homeName={homeName}
              awayName={awayName}
            />
          ) : null}

          {/* participants */}
          <SectionTitle title={t("match.allPredictions")} />
          <Card>
            {!match.revealed ? (
              <EmptyState
                title={t("match.predictionsHidden")}
                icon={<Feather name="eye-off" size={26} color={c.mutedForeground} />}
              />
            ) : match.participantPredictions.length === 0 ? (
              <EmptyState
                title={t("match.noPredictions")}
                icon={<Feather name="users" size={26} color={c.mutedForeground} />}
              />
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
  const { formatNum, dir } = useI18n();

  const StepButton = ({
    icon,
    onPress,
    isDisabled,
  }: {
    icon: "minus" | "plus";
    onPress: () => void;
    isDisabled: boolean;
  }) => (
    <PressableScale
      onPress={() => {
        if (!isDisabled) onPress();
      }}
      disabled={isDisabled}
      haptic
      hitSlop={6}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: icon === "plus" ? c.primary : c.border,
        backgroundColor: icon === "plus" ? "rgba(39,176,112,0.12)" : c.card,
        alignItems: "center",
        justifyContent: "center",
        opacity: isDisabled ? 0.4 : 1,
      }}
    >
      <Feather
        name={icon}
        size={20}
        color={icon === "plus" ? c.primary : c.foreground}
      />
    </PressableScale>
  );

  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      <ThemedText muted size={13} center numberOfLines={1} style={{ maxWidth: 96 }}>
        {label}
      </ThemedText>
      <View style={{ flexDirection: dir === "rtl" ? "row-reverse" : "row", alignItems: "center", gap: 10 }}>
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
      <ThemedText size={14} weight="bold" style={{ writingDirection: "ltr" }}>
        {ltrIsolate(`${formatNum(p.homeScore)} - ${formatNum(p.awayScore)}`)}
      </ThemedText>
      <Pill tone={tone} label={`+${formatNum(p.pointsAwarded)}`} />
    </View>
  );
}

function rarityTone(rarity: string): "neutral" | "gold" | "green" {
  if (rarity === "bold" || rarity === "rare") return "gold";
  if (rarity === "popular") return "green";
  return "neutral";
}

function TrendBar({
  label,
  pct,
  dir,
}: {
  label: string;
  pct: number;
  dir: "row" | "row-reverse";
}) {
  const { formatNum } = useI18n();
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          flexDirection: dir,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <ThemedText muted size={13} numberOfLines={1} style={{ flexShrink: 1 }}>
          {label}
        </ThemedText>
        <ThemedText weight="bold" size={13}>
          {formatNum(pct)}%
        </ThemedText>
      </View>
      <ProgressBar percent={pct} />
    </View>
  );
}

function MatchAnalytics({
  trends,
  comparison,
  homeName,
  awayName,
}: {
  trends?: PredictionTrends;
  comparison?: PredictionComparison;
  homeName: string;
  awayName: string;
}) {
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const total = trends?.total ?? 0;

  const outcomeLabel = (key: ComparisonOutcomeKey): string =>
    key === "home_win" ? homeName : key === "away_win" ? awayName : t("trends.draw");

  return (
    <>
      {/* trends */}
      <SectionTitle title={t("trends.title")} />
      <Card>
        {total === 0 ? (
          <ThemedText muted size={14} center>
            {t("trends.empty")}
          </ThemedText>
        ) : (
          <View style={{ gap: 14 }}>
            {trends?.myRarity ? (
              <View style={{ flexDirection: rowDir }}>
                <Pill
                  tone={rarityTone(trends.myRarity)}
                  label={`${t("rarity.yourPick")} · ${t(`rarity.${trends.myRarity}`)}`}
                />
              </View>
            ) : null}
            <TrendBar
              label={t("trends.homeWin", { team: homeName })}
              pct={trends?.homeWinPct ?? 0}
              dir={rowDir}
            />
            <TrendBar label={t("trends.draw")} pct={trends?.drawPct ?? 0} dir={rowDir} />
            <TrendBar
              label={t("trends.awayWin", { team: awayName })}
              pct={trends?.awayWinPct ?? 0}
              dir={rowDir}
            />
            <ThemedText muted size={12}>
              {t("trends.basedOn", { count: formatNum(total) })}
            </ThemedText>
          </View>
        )}
      </Card>

      {/* comparison */}
      <SectionTitle title={t("comparison.title")} />
      <Card>
        {!comparison?.revealed ? (
          <ThemedText muted size={14} center>
            {t("comparison.beforeKickoff")}
          </ThemedText>
        ) : comparison.outcomes.length === 0 && comparison.scorelines.length === 0 ? (
          <ThemedText muted size={14} center>
            {t("trends.empty")}
          </ThemedText>
        ) : (
          <View style={{ gap: 16 }}>
            {comparison.outcomes.length > 0 ? (
              <View style={{ gap: 10 }}>
                <ThemedText muted size={12} weight="semibold">
                  {t("comparison.outcomes")}
                </ThemedText>
                <View style={{ flexDirection: rowDir }}>
                  {comparison.outcomes.map((o) => (
                    <StatCell
                      key={o.key}
                      value={`${formatNum(o.pct)}%`}
                      label={outcomeLabel(o.key)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {comparison.scorelines.length > 0 ? (
              <View style={{ gap: 8 }}>
                <ThemedText muted size={12} weight="semibold">
                  {t("comparison.popularScores")}
                </ThemedText>
                {comparison.scorelines.map((s) => (
                  <View
                    key={`${s.homeScore}-${s.awayScore}`}
                    style={{
                      flexDirection: rowDir,
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <ThemedText weight="bold" size={16} style={{ writingDirection: "ltr" }}>
                      {ltrIsolate(`${formatNum(s.homeScore)} - ${formatNum(s.awayScore)}`)}
                    </ThemedText>
                    <View style={{ flexDirection: rowDir, alignItems: "center", gap: 8 }}>
                      <Pill tone={rarityTone(s.rarity)} label={t(`rarity.${s.rarity}`)} />
                      <ThemedText muted size={13} weight="semibold">
                        {formatNum(s.pct)}%
                      </ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
      </Card>
    </>
  );
}

function MatchDetailSkeleton() {
  const { dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View style={{ gap: 22 }}>
      <Card>
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1, alignItems: "center", gap: 10 }}>
            <Skeleton width={64} height={64} radius={32} />
            <Skeleton width={70} height={12} />
          </View>
          <Skeleton width={70} height={36} />
          <View style={{ flex: 1, alignItems: "center", gap: 10 }}>
            <Skeleton width={64} height={64} radius={32} />
            <Skeleton width={70} height={12} />
          </View>
        </View>
        <View style={{ marginTop: 18, gap: 10 }}>
          <Skeleton width="100%" height={12} />
          <Skeleton width="60%" height={12} />
        </View>
      </Card>
      <View style={{ gap: 12 }}>
        <Skeleton width={140} height={16} />
        <Card>
          <View
            style={{
              flexDirection: rowDir,
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
            }}
          >
            <Skeleton width={44} height={44} radius={22} />
            <Skeleton width={40} height={40} />
            <Skeleton width={44} height={44} radius={22} />
          </View>
        </Card>
      </View>
    </View>
  );
}
