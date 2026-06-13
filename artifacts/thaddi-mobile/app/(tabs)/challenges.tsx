import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMyChallengesQueryKey,
  useDiscoverChallenges,
  useGetMyChallenges,
  useGetMySubscription,
  useJoinChallenge,
  type ChallengeSummary,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import {
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Pill,
  PressableScale,
  Screen,
  TextField,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

type Tab = "mine" | "discover";

export default function ChallengesScreen() {
  const c = useColors();
  const { t, dir } = useI18n();
  const { isSignedIn } = useAuth();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const [tab, setTab] = useState<Tab>("mine");
  const [q, setQ] = useState("");
  const [joinTarget, setJoinTarget] = useState<ChallengeSummary | null>(null);

  const mineQ = useGetMyChallenges({
    query: { enabled: isSignedIn === true, queryKey: getGetMyChallengesQueryKey() },
  });
  const discoverQ = useDiscoverChallenges();

  const owned = mineQ.data?.owned ?? [];
  const joined = mineQ.data?.joined ?? [];
  const discover = (discoverQ.data ?? []).filter((ch) =>
    ch.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const openChallenge = (ch: ChallengeSummary) => {
    const codeRequired = ch.visibility === "private" && !ch.inviteCode;
    if (codeRequired) {
      setJoinTarget(ch);
    } else {
      router.push(`/challenge/${ch.id}`);
    }
  };

  return (
    <Screen scroll>
      <View
        style={{
          flexDirection: rowDir,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <ThemedText weight="extrabold" size={26} gold>
          {t("challenges.title")}
        </ThemedText>
        <Button
          label={t("challenges.create")}
          onPress={() => router.push("/challenge/create")}
          fullWidth={false}
          icon={<Feather name="plus" size={16} color={c.primaryForeground} />}
        />
      </View>

      {/* segmented tabs */}
      <View
        style={{
          flexDirection: rowDir,
          backgroundColor: c.card,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: c.radius,
          padding: 4,
          marginBottom: 18,
          gap: 4,
        }}
      >
        <SegTab label={t("challenges.mine")} active={tab === "mine"} onPress={() => setTab("mine")} />
        <SegTab
          label={t("challenges.discover")}
          active={tab === "discover"}
          onPress={() => setTab("discover")}
        />
      </View>

      {tab === "mine" ? (
        <MineTab
          loading={mineQ.isLoading}
          error={mineQ.isError}
          onRetry={() => void mineQ.refetch()}
          owned={owned}
          joined={joined}
          onOpen={openChallenge}
        />
      ) : (
        <View>
          <TextField
            value={q}
            onChangeText={setQ}
            placeholder={t("challenges.search")}
            autoCapitalize="none"
          />
          {discoverQ.isLoading ? (
            <View style={{ gap: 12 }}>
              <Card><ListSkeleton rows={2} /></Card>
              <Card><ListSkeleton rows={2} /></Card>
            </View>
          ) : discoverQ.isError ? (
            <ErrorState
              message={t("common.loadError")}
              retryLabel={t("common.tryAgain")}
              onRetry={() => void discoverQ.refetch()}
            />
          ) : discover.length === 0 ? (
            <EmptyState
              title={q ? t("challenges.noResults") : t("challenges.emptyDiscover")}
            />
          ) : (
            <View style={{ gap: 12 }}>
              {discover.map((ch) => (
                <ChallengeCard key={ch.id} ch={ch} onPress={() => openChallenge(ch)} />
              ))}
            </View>
          )}
        </View>
      )}

      <View style={{ height: 24 }} />

      <JoinByCodeModal target={joinTarget} onClose={() => setJoinTarget(null)} />
    </Screen>
  );
}

function SegTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 9,
        borderRadius: c.radius - 2,
        backgroundColor: active ? "rgba(39,176,112,0.16)" : "transparent",
        alignItems: "center",
      }}
    >
      <ThemedText
        weight={active ? "bold" : "regular"}
        size={14}
        color={active ? c.primary : c.mutedForeground}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ChallengeCard({ ch, onPress }: { ch: ChallengeSummary; onPress: () => void }) {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const codeRequired = ch.visibility === "private" && !ch.inviteCode;
  return (
    <PressableScale onPress={onPress}>
      <Card>
          <View
            style={{
              flexDirection: rowDir,
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <View style={{ flex: 1 }}>
              <ThemedText weight="bold" size={17} numberOfLines={1}>
                {ch.name}
              </ThemedText>
              {ch.ownerDisplayName ? (
                <ThemedText muted size={12} numberOfLines={1} style={{ marginTop: 2 }}>
                  {t("challenges.hostedBy")} {ch.ownerDisplayName}
                </ThemedText>
              ) : null}
            </View>
            <View style={{ alignItems: dir === "rtl" ? "flex-start" : "flex-end", gap: 6 }}>
              <Pill tone="gold" label={t(`type.${ch.type}`)} />
              <Pill
                tone={ch.visibility === "private" ? "neutral" : "green"}
                label={t(`visibility.${ch.visibility}`)}
              />
            </View>
          </View>

          {ch.description ? (
            <ThemedText muted size={13} numberOfLines={2} style={{ marginTop: 8 }}>
              {ch.description}
            </ThemedText>
          ) : null}

          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 16, marginTop: 10 }}>
            <View style={{ flexDirection: rowDir, alignItems: "center", gap: 6 }}>
              <Feather name="users" size={14} color={c.mutedForeground} />
              <ThemedText muted size={13}>
                {formatNum(ch.participantCount)}
              </ThemedText>
            </View>
            {ch.prizeCount > 0 ? (
              <View style={{ flexDirection: rowDir, alignItems: "center", gap: 6 }}>
                <Feather name="award" size={14} color={c.thaddiGold} />
                <ThemedText size={13} gold>
                  {formatNum(ch.prizeCount)} {t("challenges.prizes")}
                </ThemedText>
              </View>
            ) : null}
          </View>

          {codeRequired ? (
            <View
              style={{
                flexDirection: rowDir,
                alignItems: "center",
                gap: 6,
                marginTop: 10,
              }}
            >
              <Feather name="lock" size={12} color={c.primary} />
              <ThemedText size={12} color={c.primary}>
                {t("challenges.codeToJoin")}
              </ThemedText>
            </View>
          ) : null}
      </Card>
    </PressableScale>
  );
}

function MineTab({
  loading,
  error,
  onRetry,
  owned,
  joined,
  onOpen,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  owned: ChallengeSummary[];
  joined: ChallengeSummary[];
  onOpen: (ch: ChallengeSummary) => void;
}) {
  const c = useColors();
  const { t } = useI18n();

  if (loading)
    return (
      <View style={{ gap: 12 }}>
        <Card><ListSkeleton rows={2} /></Card>
        <Card><ListSkeleton rows={2} /></Card>
        <Card><ListSkeleton rows={2} /></Card>
      </View>
    );
  if (error)
    return (
      <ErrorState
        message={t("common.loadError")}
        retryLabel={t("common.tryAgain")}
        onRetry={onRetry}
      />
    );
  if (owned.length === 0 && joined.length === 0) {
    return (
      <View style={{ gap: 16, paddingTop: 8 }}>
        <MyPlanCard />
        <EmptyState
          title={t("challenges.emptyMine")}
          icon={<Feather name="zap" size={32} color={c.primary} />}
        />
        <Button
          label={t("challenges.emptyMineCta")}
          onPress={() => router.push("/challenge/create")}
          icon={<Feather name="plus" size={16} color={c.primaryForeground} />}
        />
      </View>
    );
  }
  return (
    <View style={{ gap: 18 }}>
      <MyPlanCard />
      {owned.length > 0 ? (
        <View style={{ gap: 12 }}>
          <ThemedText weight="semibold" size={13} gold style={{ textTransform: "uppercase" }}>
            {t("challenges.owned")}
          </ThemedText>
          {owned.map((ch) => (
            <ChallengeCard key={ch.id} ch={ch} onPress={() => onOpen(ch)} />
          ))}
        </View>
      ) : null}
      {joined.length > 0 ? (
        <View style={{ gap: 12 }}>
          <ThemedText
            weight="semibold"
            size={13}
            color={c.primary}
            style={{ textTransform: "uppercase" }}
          >
            {t("challenges.joined")}
          </ThemedText>
          {joined.map((ch) => (
            <ChallengeCard key={ch.id} ch={ch} onPress={() => onOpen(ch)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function MyPlanCard() {
  const c = useColors();
  const { t, lang, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const subQ = useGetMySubscription();
  const sub = subQ.data;
  if (!sub) return null;
  const isFree = sub.planCode === "free";
  const planName = lang === "ar" ? sub.planNameAr : sub.planNameEn;
  const limitText =
    sub.participantLimit != null
      ? `${formatNum(sub.participantsUsed)}/${formatNum(sub.participantLimit)}`
      : `${formatNum(sub.participantsUsed)} · ${t("myPlan.unlimited")}`;
  return (
    <Card style={{ borderColor: "rgba(232,180,48,0.3)" }}>
      <View
        style={{
          flexDirection: rowDir,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <ThemedText muted size={11} style={{ textTransform: "uppercase" }}>
            {t("myPlan.title")}
          </ThemedText>
          <ThemedText weight="bold" size={17} numberOfLines={1}>
            {planName}
          </ThemedText>
          <ThemedText muted size={13} style={{ marginTop: 2 }}>
            {t("myPlan.participantLimit")}: {limitText}
          </ThemedText>
        </View>
        <Button
          label={isFree ? t("myPlan.upgrade") : t("myPlan.manage")}
          onPress={() => router.push("/(tabs)/profile")}
          variant={isFree ? "primary" : "outline"}
          fullWidth={false}
        />
      </View>
    </Card>
  );
}

function JoinByCodeModal({
  target,
  onClose,
}: {
  target: ChallengeSummary | null;
  onClose: () => void;
}) {
  const c = useColors();
  const { t, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const queryClient = useQueryClient();
  const join = useJoinChallenge();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCode("");
    setError(null);
  }, [target?.id]);

  const submit = () => {
    if (!target) return;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError(t("challenges.codeRequired"));
      return;
    }
    setError(null);
    join.mutate(
      { id: target.id, data: { viaCode: trimmed } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          const targetId = target.id;
          onClose();
          router.push(`/challenge/${targetId}`);
        },
        onError: (err) => {
          if (err?.status === 403) {
            setError(t("challenges.wrongCode"));
          } else if (err?.status === 409) {
            const detail = String(err?.data?.error ?? "");
            const full =
              err?.data?.code === "owner_pool_full" || /limit/i.test(detail);
            setError(full ? t("join.full") : t("join.ended"));
          } else {
            setError(t("join.error"));
          }
        },
      },
    );
  };

  return (
    <BottomSheet
      visible={!!target}
      onClose={onClose}
      title={t("challenges.joinPrivateTitle")}
      subtitle={t("challenges.joinPrivateDesc")}
    >
      <View style={{ flexDirection: rowDir, alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Feather name="lock" size={16} color={c.primary} />
        {target?.name ? (
          <ThemedText weight="semibold" size={15} style={{ flexShrink: 1 }}>
            {target.name}
          </ThemedText>
        ) : null}
      </View>
      <TextField
        label={t("challenges.codeLabel")}
        value={code}
        onChangeText={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        placeholder={t("challenges.codePlaceholder")}
        autoCapitalize="characters"
        autoComplete="off"
        error={error ?? undefined}
      />
      <View style={{ flexDirection: rowDir, gap: 10, marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Button label={t("common.cancel")} onPress={onClose} variant="outline" />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t("join.joinNow")} onPress={submit} loading={join.isPending} />
        </View>
      </View>
    </BottomSheet>
  );
}
