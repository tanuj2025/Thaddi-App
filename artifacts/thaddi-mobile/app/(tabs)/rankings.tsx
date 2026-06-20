import { Feather } from "@expo/vector-icons";
import {
  getGetChallengeRankingQueryKey,
  getGetCompetitionRankingQueryKey,
  useGetChallengeRanking,
  useGetCompetitionRanking,
  useGetMyChallenges,
  type RankingEntry,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, View } from "react-native";

import { CompetitionComingSoon } from "@/components/competition-empty";
import { CompetitionSwitcher } from "@/components/competition-switcher";
import { PlayerLink } from "@/components/social";
import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  GlowCard,
  LangToggle,
  ListSkeleton,
  Pill,
  PressableScale,
  Screen,
  ScreenHeader,
  SectionTitle,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useCompetition } from "@/lib/competition";
import { ltrIsolate, useI18n } from "@/lib/i18n";

const WHATSAPP_GREEN = "#25D366";
const WEB_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

type RankingView = "global" | "challenge";

/* Movement chevron — up = green gain, down = red drop, flat = muted dash. */
function Movement({ delta }: { delta?: number | null }) {
  const c = useColors();
  const { dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  if (delta == null || delta === 0) {
    return <Feather name="minus" size={13} color={c.mutedForeground} />;
  }
  const up = delta > 0;
  const tint = up ? c.primary : c.destructive;
  return (
    <View style={{ flexDirection: rowDir, alignItems: "center", gap: 1 }}>
      <Feather name={up ? "chevron-up" : "chevron-down"} size={13} color={tint} />
      <ThemedText size={11} weight="semibold" color={tint}>
        {formatNum(Math.abs(delta))}
      </ThemedText>
    </View>
  );
}

/* Rank chip — medal-coloured award icon for the top 3, plain number otherwise. */
function RankBadge({ rank }: { rank: number }) {
  const c = useColors();
  const { formatNum } = useI18n();
  const medal =
    rank === 1
      ? c.thaddiGold
      : rank === 2
        ? c.podiumSilver
        : rank === 3
          ? c.podiumBronze
          : null;
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.muted,
        borderWidth: medal ? 1.5 : StyleSheet.hairlineWidth,
        borderColor: medal ?? c.border,
      }}
    >
      {medal ? (
        <Feather name="award" size={20} color={medal} />
      ) : (
        <ThemedText weight="extrabold" size={14} center>
          {formatNum(rank)}
        </ThemedText>
      )}
    </View>
  );
}

function RankRow({ entry }: { entry: RankingEntry }) {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const name = entry.displayName ?? entry.username ?? "—";
  const acc =
    entry.accuracy != null ? `${formatNum(Math.round(entry.accuracy * 100))}%` : "—";
  const isFirst = entry.rank === 1;

  return (
    <PlayerLink userId={entry.userId} style={{ marginBottom: 8 }}>
      <View
        style={{
          flexDirection: rowDir,
          alignItems: "center",
          gap: 12,
          paddingVertical: 11,
          paddingHorizontal: 14,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: entry.isCurrentUser ? c.primary : c.border,
          backgroundColor: entry.isCurrentUser ? "rgba(39,176,112,0.10)" : c.card,
        }}
      >
        <RankBadge rank={entry.rank} />
        <Avatar uri={entry.avatarUrl} name={name} size={40} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 6 }}>
            <ThemedText
              weight="semibold"
              size={14}
              numberOfLines={1}
              style={{ flexShrink: 1 }}
              color={isFirst ? c.thaddiGold : undefined}
            >
              {name}
            </ThemedText>
            {entry.isCurrentUser ? <Pill label={t("rankings.you")} tone="green" /> : null}
          </View>
          <ThemedText muted size={11} numberOfLines={1}>
            {t("rankings.accuracy")} {acc} · {t("rankings.exact")}{" "}
            {formatNum(entry.exactPredictions)}
          </ThemedText>
        </View>
        <View
          style={{
            alignItems: dir === "rtl" ? "flex-start" : "flex-end",
            gap: 3,
          }}
        >
          <ThemedText weight="extrabold" size={16} gold={isFirst}>
            {formatNum(entry.points)}
          </ThemedText>
          <Movement delta={entry.rankMovement} />
        </View>
      </View>
    </PlayerLink>
  );
}

/* "Your rank" hero with WhatsApp share (global view). */
function YourRankCard({ me, onShare }: { me: RankingEntry; onShare: () => void }) {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <GlowCard tone="gold" style={{ marginBottom: 18 }}>
      <View
        style={{
          flexDirection: rowDir,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <ThemedText gold size={12} weight="semibold">
            {t("rankings.yourRank")}
          </ThemedText>
          <ThemedText weight="extrabold" size={34} style={{ marginTop: 2 }}>
            {ltrIsolate(`#${formatNum(me.rank)}`)}
          </ThemedText>
          <View
            style={{
              flexDirection: rowDir,
              alignItems: "baseline",
              gap: 5,
              marginTop: 2,
            }}
          >
            <ThemedText gold weight="bold" size={14}>
              {formatNum(me.points)}
            </ThemedText>
            <ThemedText muted size={12}>
              {t("rankings.points")}
            </ThemedText>
          </View>
        </View>
        <PressableScale
          onPress={onShare}
          testID="button-share-rank"
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            gap: 8,
            backgroundColor: WHATSAPP_GREEN,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: c.radius,
            alignSelf: "flex-start",
          }}
        >
          <Feather name="message-circle" size={16} color="#FFFFFF" />
          <ThemedText weight="bold" size={14} color="#FFFFFF">
            {t("rankings.share")}
          </ThemedText>
        </PressableScale>
      </View>
    </GlowCard>
  );
}

/* Shared scrolling leaderboard — appends the viewer's own row if missing. */
function RankingList({
  entries,
  me,
  header,
  emptyText,
}: {
  entries: RankingEntry[];
  me: RankingEntry | null;
  header?: React.ReactElement | null;
  emptyText: string;
}) {
  const c = useColors();
  const meInList = me ? entries.some((e) => e.userId === me.userId) : true;
  const data = me && !meInList ? [...entries, me] : entries;
  return (
    <FlatList
      style={{ flex: 1 }}
      data={data}
      keyExtractor={(e) => e.userId}
      renderItem={({ item }) => <RankRow entry={item} />}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: 16 }}
      ListHeaderComponent={header ?? null}
      ListEmptyComponent={
        <Card>
          <EmptyState
            title={emptyText}
            icon={<Feather name="bar-chart-2" size={26} color={c.mutedForeground} />}
          />
        </Card>
      }
    />
  );
}

/* Segmented global / by-challenge toggle. */
function ContextToggle({
  view,
  setView,
}: {
  view: RankingView;
  setView: (v: RankingView) => void;
}) {
  const c = useColors();
  const { t, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const items: {
    key: RankingView;
    icon: keyof typeof Feather.glyphMap;
    label: string;
  }[] = [
    { key: "global", icon: "globe", label: "rankings.context.global" },
    { key: "challenge", icon: "users", label: "rankings.context.byChallenge" },
  ];
  return (
    <View style={{ flexDirection: rowDir, gap: 8, marginBottom: 14 }}>
      {items.map((it) => {
        const active = view === it.key;
        return (
          <Pressable
            key={it.key}
            testID={`button-rankings-${it.key}`}
            onPress={() => setView(it.key)}
            style={{
              flexDirection: rowDir,
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: active ? c.secondary : c.card,
              borderWidth: 1,
              borderColor: active ? c.secondary : c.border,
            }}
          >
            <Feather
              name={it.icon}
              size={14}
              color={active ? c.secondaryForeground : c.mutedForeground}
            />
            <ThemedText
              size={13}
              weight="semibold"
              color={active ? c.secondaryForeground : c.mutedForeground}
            >
              {t(it.label)}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RankingsScreen() {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const { selectedSlug, selectedSeason, comingSoon, isReady } = useCompetition();

  const [view, setView] = useState<RankingView>("global");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* Global competition leaderboard. */
  const rankingParams = { season: selectedSeason ?? undefined, limit: 100 };
  const q = useGetCompetitionRanking(selectedSlug ?? "", rankingParams, {
    query: {
      queryKey: getGetCompetitionRankingQueryKey(selectedSlug ?? "", rankingParams),
      enabled: isReady && !!selectedSlug && !comingSoon,
    },
  });
  const entries = q.data?.entries ?? [];
  const me = q.data?.me ?? null;
  const globalReady = isReady && !!selectedSlug && !comingSoon && !q.isLoading && !q.isError;

  /* My challenges feed the by-challenge picker. */
  const mine = useGetMyChallenges();
  const allChallenges = [
    ...(mine.data?.owned ?? []),
    ...(mine.data?.joined ?? []),
  ];
  const selectedChallenge =
    allChallenges.find((ch) => ch.id === challengeId) ?? null;

  /* Per-challenge leaderboard (only fetched once a challenge is picked). */
  const cq = useGetChallengeRanking(challengeId ?? "", {
    query: {
      queryKey: getGetChallengeRankingQueryKey(challengeId ?? ""),
      enabled: view === "challenge" && !!challengeId,
    },
  });
  const cEntries = cq.data?.entries ?? [];
  const cMe = cq.data?.me ?? null;

  const shareRank = () => {
    if (!me) return;
    const msg = t("rankings.shareMessage").replace("{rank}", formatNum(me.rank));
    const text = WEB_BASE ? `${msg} ${WEB_BASE}` : msg;
    void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
  };

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

      <ContextToggle view={view} setView={setView} />

      {view === "global" ? (
        comingSoon ? (
          <CompetitionComingSoon />
        ) : !isReady || q.isLoading ? (
          <View style={{ paddingTop: 8 }}>
            <ListSkeleton rows={7} />
          </View>
        ) : q.isError ? (
          <Card>
            <ErrorState
              message={t("common.loadError")}
              retryLabel={t("common.tryAgain")}
              onRetry={() => void q.refetch()}
            />
          </Card>
        ) : (
          <RankingList
            entries={entries}
            me={me}
            emptyText={t("rankings.empty")}
            header={
              <View>
                {me ? (
                  <YourRankCard me={me} onShare={shareRank} />
                ) : globalReady ? (
                  <Card style={{ marginBottom: 18 }}>
                    <EmptyState
                      icon={
                        <Feather name="target" size={26} color={c.mutedForeground} />
                      }
                      title={t("rankings.noRankYet")}
                      subtitle={t("rankings.noRankYetDesc")}
                      action={
                        <Button
                          label={t("rankings.noRankYetCta")}
                          onPress={() => router.push("/matches")}
                          fullWidth={false}
                        />
                      }
                    />
                  </Card>
                ) : null}
                {entries.length > 0 ? (
                  <SectionTitle title={t("rankings.standings")} first={!me} />
                ) : null}
              </View>
            }
          />
        )
      ) : allChallenges.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Feather name="users" size={26} color={c.mutedForeground} />}
            title={t("rankings.context.noChallenges")}
            action={
              <Button
                label={t("home.nextAction.joinCta")}
                onPress={() => router.push("/challenges")}
                fullWidth={false}
              />
            }
          />
        </Card>
      ) : (
        <View style={{ flex: 1 }}>
          <Pressable
            testID="button-pick-challenge"
            onPress={() => setPickerOpen(true)}
            style={{
              flexDirection: rowDir,
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: c.radius,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.card,
              marginBottom: 14,
            }}
          >
            <Feather name="users" size={16} color={c.thaddiGold} />
            <ThemedText
              size={14}
              weight="semibold"
              numberOfLines={1}
              style={{ flex: 1 }}
            >
              {selectedChallenge
                ? selectedChallenge.name
                : t("rankings.context.selectChallenge")}
            </ThemedText>
            <Feather name="chevron-down" size={18} color={c.mutedForeground} />
          </Pressable>

          {!selectedChallenge ? (
            <Card>
              <EmptyState
                icon={<Feather name="award" size={26} color={c.mutedForeground} />}
                title={t("rankings.context.selectChallenge")}
              />
            </Card>
          ) : cq.isLoading ? (
            <View style={{ paddingTop: 8 }}>
              <ListSkeleton rows={6} />
            </View>
          ) : cq.isError ? (
            <Card>
              <ErrorState
                message={t("common.loadError")}
                retryLabel={t("common.tryAgain")}
                onRetry={() => void cq.refetch()}
              />
            </Card>
          ) : (
            <RankingList
              entries={cEntries}
              me={cMe}
              emptyText={t("rankings.empty")}
              header={
                <View
                  style={{
                    flexDirection: rowDir,
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  <ThemedText
                    size={13}
                    muted
                    numberOfLines={2}
                    style={{ flexShrink: 1 }}
                  >
                    {t("rankings.context.challengeRank").replace(
                      "{name}",
                      selectedChallenge.name,
                    )}
                  </ThemedText>
                  <ThemedText
                    gold
                    size={13}
                    weight="semibold"
                    onPress={() =>
                      router.push(`/challenge/${selectedChallenge.id}`)
                    }
                  >
                    {t("detail.openChallenge")}
                  </ThemedText>
                </View>
              }
            />
          )}

          <BottomSheet
            visible={pickerOpen}
            onClose={() => setPickerOpen(false)}
            title={t("rankings.context.selectChallenge")}
          >
            {allChallenges.map((ch) => {
              const sel = ch.id === challengeId;
              return (
                <Pressable
                  key={ch.id}
                  onPress={() => {
                    setChallengeId(ch.id);
                    setPickerOpen(false);
                  }}
                  style={{
                    flexDirection: rowDir,
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    borderRadius: c.radius,
                    backgroundColor: sel ? "rgba(39,176,112,0.10)" : "transparent",
                  }}
                >
                  <ThemedText
                    size={15}
                    weight={sel ? "bold" : "semibold"}
                    numberOfLines={1}
                    style={{ flexShrink: 1 }}
                  >
                    {ch.name}
                  </ThemedText>
                  {sel ? <Feather name="check" size={18} color={c.primary} /> : null}
                </Pressable>
              );
            })}
          </BottomSheet>
        </View>
      )}
    </Screen>
  );
}
