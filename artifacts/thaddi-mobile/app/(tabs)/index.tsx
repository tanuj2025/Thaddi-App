import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  GetMatchesScope,
  useGetMatches,
  useGetMe,
  useGetMyChallenges,
  useGetMyGamification,
  useListActiveAnnouncements,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

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
import { useCountdown } from "@/lib/format";
import { forwardChevron, ltrIsolate, useI18n } from "@/lib/i18n";

const STORAGE_DISMISSED_ANNOUNCEMENTS = "thaddi.dismissedAnnouncements";
const STORAGE_FIRST_RUN_DISMISSED = "thaddi.firstRunDismissed";

/* -------------------------------------------------------------------------- */
/* Active announcements banner (dismissals persisted in AsyncStorage)          */
/* -------------------------------------------------------------------------- */

function AnnouncementBanner() {
  const c = useColors();
  const { t, lang, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const { data } = useListActiveAnnouncements();

  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_DISMISSED_ANNOUNCEMENTS);
        if (active && raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setDismissed(parsed.filter((x): x is string => typeof x === "string"));
          }
        }
      } catch {
        // Best-effort persistence; fall back to showing all announcements.
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      void AsyncStorage.setItem(
        STORAGE_DISMISSED_ANNOUNCEMENTS,
        JSON.stringify(next),
      ).catch(() => {});
      return next;
    });
  }, []);

  const visible = (data?.announcements ?? []).filter((a) => !dismissed.includes(a.id));
  if (!loaded || visible.length === 0) return null;

  return (
    <View style={{ gap: 12, marginBottom: 18 }}>
      {visible.map((a) => {
        const title = lang === "ar" ? a.titleAr : a.titleEn;
        const body = lang === "ar" ? a.bodyAr : a.bodyEn;
        return (
          <Card key={a.id} style={{ borderColor: c.thaddiGold }}>
            <View style={{ flexDirection: rowDir, alignItems: "flex-start", gap: 12 }}>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(232,180,48,0.14)",
                }}
              >
                <Feather name="info" size={18} color={c.thaddiGold} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText weight="bold" size={14}>
                  {title}
                </ThemedText>
                {body ? (
                  <ThemedText muted size={13} style={{ marginTop: 4 }}>
                    {body}
                  </ThemedText>
                ) : null}
              </View>
              <Pressable
                onPress={() => dismiss(a.id)}
                hitSlop={8}
                accessibilityLabel={t("home.announcement.dismiss")}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
              >
                <Feather name="x" size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* First-run engagement checklist (derived from the user's activation state)   */
/* -------------------------------------------------------------------------- */

function EngagementChecklist() {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const chevron = forwardChevron(dir);

  const meQ = useGetMe();
  const mineQ = useGetMyChallenges();
  const upcomingQ = useGetMatches({ scope: GetMatchesScope.upcoming });

  const me = meQ.data;
  const mine = mineQ.data;
  const upcoming = upcomingQ.data ?? [];

  const [dismissed, setDismissed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_FIRST_RUN_DISMISSED);
        if (active && raw === "1") setDismissed(true);
      } catch {
        // Best-effort persistence.
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const dismiss = React.useCallback(() => {
    setDismissed(true);
    void AsyncStorage.setItem(STORAGE_FIRST_RUN_DISMISSED, "1").catch(() => {});
  }, []);

  if (!loaded || dismissed || !me) return null;

  const challengeCount = (mine?.owned?.length ?? 0) + (mine?.joined?.length ?? 0);
  const hasPredicted =
    (me.totalPoints ?? 0) > 0 || upcoming.some((m) => Boolean(m.myPrediction));

  const steps: {
    key: string;
    done: boolean;
    title: string;
    desc: string;
    onPress: () => void;
  }[] = [
    {
      key: "verify",
      done: me.mobileVerified,
      title: t("verify.title"),
      desc: t("verify.subtitle"),
      onPress: () => router.push("/(activation)/verify-mobile"),
    },
    {
      key: "team",
      done: me.favoriteTeamSelected,
      title: t("pickTeam.title"),
      desc: t("pickTeam.subtitle"),
      onPress: () => router.push("/(activation)/pick-team?change=1"),
    },
    {
      key: "challenge",
      done: challengeCount > 0,
      title: t("home.firstRun.step2.title"),
      desc: t("home.firstRun.step2.desc"),
      onPress: () => router.push("/challenge/create"),
    },
    {
      key: "predict",
      done: hasPredicted,
      title: t("home.firstRun.step1.title"),
      desc: t("home.firstRun.step1.desc"),
      onPress: () => router.push("/(tabs)/matches"),
    },
  ];

  if (steps.every((s) => s.done)) return null;

  return (
    <Card style={{ marginTop: 18, borderColor: c.thaddiGold }}>
      <View
        style={{
          flexDirection: rowDir,
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <ThemedText weight="extrabold" size={18} gold>
            {t("home.firstRun.title")}
          </ThemedText>
          <ThemedText muted size={13} style={{ marginTop: 2 }}>
            {t("home.firstRun.subtitle")}
          </ThemedText>
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          accessibilityLabel={t("home.firstRun.dismiss")}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
        >
          <Feather name="x" size={18} color={c.mutedForeground} />
        </Pressable>
      </View>

      <View style={{ marginTop: 14, gap: 10 }}>
        {steps.map((step, i) => (
          <Pressable
            key={step.key}
            onPress={step.done ? undefined : step.onPress}
            disabled={step.done}
            style={({ pressed }) => ({
              flexDirection: rowDir,
              alignItems: "center",
              gap: 12,
              borderRadius: c.radius,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              backgroundColor: c.background,
              paddingHorizontal: 12,
              paddingVertical: 10,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: step.done
                  ? "rgba(39,176,112,0.16)"
                  : "rgba(232,180,48,0.14)",
              }}
            >
              {step.done ? (
                <Feather name="check" size={16} color={c.primary} />
              ) : (
                <ThemedText weight="extrabold" size={14} gold>
                  {formatNum(i + 1)}
                </ThemedText>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText weight="semibold" size={14} numberOfLines={1}>
                {step.title}
              </ThemedText>
              <ThemedText muted size={12} numberOfLines={1}>
                {step.desc}
              </ThemedText>
            </View>
            {step.done ? null : (
              <Feather name={chevron} size={18} color={c.mutedForeground} />
            )}
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={dismiss}
        hitSlop={6}
        style={({ pressed }) => ({
          alignSelf: dir === "rtl" ? "flex-start" : "flex-end",
          marginTop: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <ThemedText muted size={13}>
          {t("home.firstRun.dismiss")}
        </ThemedText>
      </Pressable>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Next-action banner (no challenge yet / pending predictions w/ urgency)      */
/* -------------------------------------------------------------------------- */

function NextActionBanner() {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const upcomingQ = useGetMatches({ scope: GetMatchesScope.upcoming });
  const mineQ = useGetMyChallenges();

  const upcoming = upcomingQ.data ?? [];
  const pending = upcoming
    .filter((m) => !m.myPrediction && !m.isLocked)
    .sort((a, b) => {
      const aMs = a.predictionLockAt ? new Date(a.predictionLockAt).getTime() : Infinity;
      const bMs = b.predictionLockAt ? new Date(b.predictionLockAt).getTime() : Infinity;
      return aMs - bMs;
    });

  const urgent = pending[0];
  const urgentLockAt = urgent?.predictionLockAt ?? null;
  const cd = useCountdown(urgentLockAt);

  if (upcomingQ.isLoading || mineQ.isLoading) return null;

  const challengeCount =
    (mineQ.data?.owned?.length ?? 0) + (mineQ.data?.joined?.length ?? 0);

  if (challengeCount === 0) {
    return (
      <Pressable
        onPress={() => router.push("/(tabs)/challenges")}
        style={({ pressed }) => ({ marginTop: 14, opacity: pressed ? 0.85 : 1 })}
      >
        <Card style={{ borderColor: c.primary }}>
          <View
            style={{
              flexDirection: rowDir,
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <View
              style={{ flexDirection: rowDir, alignItems: "center", gap: 12, flex: 1 }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(39,176,112,0.16)",
                }}
              >
                <Feather name="users" size={18} color={c.primary} />
              </View>
              <ThemedText weight="semibold" size={14} numberOfLines={2} style={{ flex: 1 }}>
                {t("home.nextAction.noChallenges")}
              </ThemedText>
            </View>
            <View style={{ flexDirection: rowDir, alignItems: "center", gap: 4 }}>
              <ThemedText weight="bold" size={13} color={c.primary}>
                {t("home.nextAction.joinCta")}
              </ThemedText>
              <Feather name={forwardChevron(dir)} size={16} color={c.primary} />
            </View>
          </View>
        </Card>
      </Pressable>
    );
  }

  const pendingCount = pending.length;
  if (pendingCount === 0) return null;

  const label = t("home.nextAction.pendingPredictions", { count: pendingCount });

  const URGENCY_MS = 24 * 60 * 60 * 1000;
  const isUrgent =
    urgentLockAt != null && new Date(urgentLockAt).getTime() - Date.now() < URGENCY_MS;

  if (isUrgent && urgent) {
    const cdStr =
      cd && !cd.done
        ? [
            cd.days > 0 ? `${formatNum(cd.days)}${t("match.days")}` : null,
            `${formatNum(cd.hours)}${t("match.hours")}`,
            `${formatNum(cd.minutes)}${t("match.minutes")}`,
            cd.days === 0 ? `${formatNum(cd.seconds)}${t("match.seconds")}` : null,
          ]
            .filter((x): x is string => Boolean(x))
            // Isolate each segment so RTL never reorders the countdown tokens.
            .map(ltrIsolate)
            .join(" ")
        : "";
    return (
      <Pressable
        onPress={() => router.push(`/match/${urgent.id}`)}
        style={({ pressed }) => ({ marginTop: 14, opacity: pressed ? 0.85 : 1 })}
      >
        <Card style={{ borderColor: c.destructive }}>
          <View
            style={{
              flexDirection: rowDir,
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <View
              style={{ flexDirection: rowDir, alignItems: "center", gap: 12, flex: 1 }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(220,40,40,0.16)",
                }}
              >
                <Feather name="clock" size={18} color={c.destructive} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText weight="bold" size={13} color={c.destructive} numberOfLines={1}>
                  {label}
                </ThemedText>
                <ThemedText weight="semibold" size={13} numberOfLines={1}>
                  {t("home.nextAction.predictCta")}
                </ThemedText>
              </View>
            </View>
            <View style={{ alignItems: dir === "rtl" ? "flex-start" : "flex-end" }}>
              <ThemedText
                weight="extrabold"
                size={16}
                color={c.destructive}
                style={{ writingDirection: "ltr" }}
              >
                {cdStr}
              </ThemedText>
              <ThemedText muted size={10}>
                {t("matches.locksIn")}
              </ThemedText>
            </View>
          </View>
        </Card>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => router.push("/(tabs)/matches")}
      style={({ pressed }) => ({ marginTop: 14, opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ borderColor: c.thaddiGold }}>
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 12, flex: 1 }}>
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(232,180,48,0.14)",
              }}
            >
              <Feather name="zap" size={18} color={c.thaddiGold} />
            </View>
            <ThemedText weight="semibold" size={14} numberOfLines={2} style={{ flex: 1 }}>
              {label}
            </ThemedText>
          </View>
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 4 }}>
            <ThemedText gold weight="bold" size={13}>
              {t("home.nextAction.predictCta")}
            </ThemedText>
            <Feather name={forwardChevron(dir)} size={16} color={c.thaddiGold} />
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

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

      {/* active announcements */}
      <AnnouncementBanner />

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

      {/* first-run checklist + next-action engagement */}
      <EngagementChecklist />
      <NextActionBanner />

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
