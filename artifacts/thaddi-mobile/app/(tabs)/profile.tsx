import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  useGetMe,
  useGetMyGamification,
  useGetMySubscription,
  useGetSubscriptionHistory,
  useUpdatePreferences,
  type CurrentUser,
  type EarnedAchievement,
  type EarnedBadge,
  type SubscriptionHistoryItem,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, Switch, View } from "react-native";

import { NotificationsBell } from "@/components/notifications-bell";
import {
  Avatar,
  Button,
  Card,
  Divider,
  EmptyState,
  LangToggle,
  LoadingState,
  Pill,
  ProgressBar,
  Screen,
  ScreenHeader,
  StatCell,
  TeamFlag,
  ThemedText,
} from "@/components/ui";
import {
  ChangeEmailSheet,
  ChangeMobileSheet,
  ChangePasswordSheet,
} from "@/components/account/dialogs";
import { useColors } from "@/hooks/useColors";
import { formatDate, formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useUser } from "@clerk/expo";

export default function ProfileScreen() {
  const c = useColors();
  const { t, lang, dir, formatNum } = useI18n();
  const { signOut } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  const [emailOpen, setEmailOpen] = React.useState(false);
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const hasPassword = Boolean(user?.passwordEnabled);

  const meQ = useGetMe();
  const gamQ = useGetMyGamification();
  const subQ = useGetMySubscription();
  const historyQ = useGetSubscriptionHistory();
  const me = meQ.data;
  const gam = gamQ.data;
  const sub = subQ.data;
  const history = historyQ.data ?? [];
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const prefs = useUpdatePreferences({
    mutation: {
      onSuccess: (updated: CurrentUser) =>
        queryClient.setQueryData(getGetMeQueryKey(), updated),
    },
  });

  if (meQ.isLoading || !me) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  const stats = gam?.stats;
  const favName = me.favoriteTeam
    ? lang === "ar"
      ? me.favoriteTeam.nameAr
      : me.favoriteTeam.nameEn
    : null;

  return (
    <Screen scroll>
      <ScreenHeader
        title={t("nav.profile")}
        right={
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 12 }}>
            <NotificationsBell />
            <LangToggle />
          </View>
        }
      />

      {/* identity */}
      <Card>
        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 14 }}>
          <Avatar uri={me.avatarUrl} name={me.displayName} size={64} />
          <View style={{ flex: 1 }}>
            <ThemedText weight="extrabold" size={20} numberOfLines={1}>
              {me.displayName ?? "—"}
            </ThemedText>
            {me.username ? (
              <ThemedText muted size={13}>
                @{me.username}
              </ThemedText>
            ) : null}
            <View style={{ flexDirection: rowDir, marginTop: 6 }}>
              <Pill tone="gold" label={gam ? (lang === "ar" ? gam.levelProgress.nameAr : gam.levelProgress.nameEn) : me.level} />
            </View>
          </View>
        </View>

        {gam && gam.levelProgress.nextLevel ? (
          <View style={{ marginTop: 16 }}>
            <ProgressBar percent={gam.levelProgress.progressPercent} />
            <ThemedText muted size={11} style={{ marginTop: 6 }}>
              {t("profile.nextLevel")}:{" "}
              {lang === "ar" ? gam.levelProgress.nextLevelNameAr : gam.levelProgress.nextLevelNameEn}
            </ThemedText>
          </View>
        ) : null}
      </Card>

      {/* stats */}
      <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
        {t("profile.stats")}
      </ThemedText>
      <Card>
        <View style={{ flexDirection: rowDir }}>
          <StatCell value={formatNum(me.totalPoints)} label={t("profile.points")} />
          <StatCell value={formatNum(stats?.totalPredictions ?? 0)} label={t("profile.predictions")} />
          <StatCell value={`${formatNum(Math.round(stats?.accuracy ?? 0))}%`} label={t("profile.accuracy")} />
        </View>
        <Divider />
        <View style={{ flexDirection: rowDir }}>
          <StatCell value={formatNum(stats?.exactPredictions ?? 0)} label={t("profile.exact")} />
          <StatCell value={formatNum(stats?.competitionsWon ?? 0)} label={t("profile.competitionsWon")} />
          <StatCell value={formatNum(stats?.competitionsJoined ?? 0)} label={t("profile.competitionsJoined")} />
        </View>
      </Card>

      {/* favourite team */}
      <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
        {t("profile.chooseTeam")}
      </ThemedText>
      <Card>
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 12, flex: 1 }}>
            <TeamFlag uri={me.favoriteTeam?.flagUrl} size={32} />
            <ThemedText weight="semibold" size={15}>
              {favName ?? t("profile.chooseTeam")}
            </ThemedText>
          </View>
          <ThemedText
            gold
            size={13}
            onPress={() => router.push("/(activation)/pick-team?change=1")}
          >
            {t("profile.changeTeam")}
          </ThemedText>
        </View>
      </Card>

      {/* plan / upgrades */}
      <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
        {t("pricing.title")}
      </ThemedText>
      <Card>
        <Pressable
          onPress={() => router.push("/paywall")}
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flexShrink: 1 }}>
            <ThemedText weight="semibold" size={15}>
              {sub ? (lang === "ar" ? sub.planNameAr : sub.planNameEn) : t("paywall.entry")}
            </ThemedText>
            <ThemedText muted size={12} style={{ marginTop: 2 }}>
              {t("paywall.entryDesc")}
            </ThemedText>
          </View>
          <Feather
            name={dir === "rtl" ? "chevron-left" : "chevron-right"}
            size={22}
            color={c.thaddiGold}
          />
        </Pressable>
      </Card>

      {/* subscription history (read-only, informational) */}
      <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
        {t("subscription.title")}
      </ThemedText>
      {history.length === 0 ? (
        <Card>
          <EmptyState title={t("subscription.empty")} />
        </Card>
      ) : (
        <View style={{ gap: 12 }}>
          {history.map((item: SubscriptionHistoryItem) => (
            <SubscriptionHistoryRow key={item.id} item={item} dir={rowDir} />
          ))}
        </View>
      )}

      {/* social */}
      <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
        {t("social.title")}
      </ThemedText>
      <Card>
        <Pressable
          onPress={() => router.push("/social")}
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 12, flexShrink: 1 }}>
            <Feather name="users" size={20} color={c.thaddiGold} />
            <ThemedText weight="semibold" size={15}>
              {t("social.manageCta")}
            </ThemedText>
          </View>
          <Feather
            name={dir === "rtl" ? "chevron-left" : "chevron-right"}
            size={22}
            color={c.thaddiGold}
          />
        </Pressable>
      </Card>

      {/* badges */}
      {gam && gam.badges.length > 0 ? (
        <>
          <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
            {t("profile.badges")}
          </ThemedText>
          <Card>
            <View style={{ flexDirection: rowDir, flexWrap: "wrap", gap: 8 }}>
              {gam.badges.map((b: EarnedBadge) => (
                <Pill key={b.id} tone="green" label={lang === "ar" ? b.nameAr : b.nameEn} />
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {/* achievements */}
      {gam && gam.achievements.length > 0 ? (
        <>
          <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
            {t("profile.achievements")}
          </ThemedText>
          <Card>
            <View style={{ gap: 10 }}>
              {gam.achievements.map((a: EarnedAchievement) => (
                <View key={a.id} style={{ flexDirection: rowDir, alignItems: "center", gap: 8 }}>
                  <Pill tone="gold" label={lang === "ar" ? a.nameAr : a.nameEn} />
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {/* privacy */}
      <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
        {t("profile.privacy")}
      </ThemedText>
      <Card>
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <ThemedText weight="semibold" size={14}>
              {t("profile.hidePredictions")}
            </ThemedText>
            <ThemedText muted size={12} style={{ marginTop: 2 }}>
              {t("profile.hidePredictionsDesc")}
            </ThemedText>
          </View>
          <Switch
            value={me.hidePredictions}
            onValueChange={(v) => prefs.mutate({ data: { hidePredictions: v } })}
            trackColor={{ true: c.primary, false: c.muted }}
            thumbColor={c.foreground}
          />
        </View>
      </Card>

      {/* account */}
      <ThemedText weight="bold" size={16} style={{ marginTop: 22, marginBottom: 12 }}>
        {t("profile.account")}
      </ThemedText>
      <Card>
        <AccountRow
          label={t("profile.email")}
          value={me.email ?? "—"}
          dir={rowDir}
          actionLabel={t("account.change")}
          onAction={() => setEmailOpen(true)}
        />
        <Divider />
        <AccountRow
          label={t("account.password")}
          value={hasPassword ? "••••••••" : t("account.passwordNotSet")}
          dir={rowDir}
          actionLabel={hasPassword ? t("account.change") : t("account.setPassword")}
          onAction={() => setPasswordOpen(true)}
        />
        <Divider />
        <AccountRow
          label={t("profile.mobile")}
          value={me.mobileNumber ?? "—"}
          dir={rowDir}
          actionLabel={t("account.change")}
          onAction={() => setMobileOpen(true)}
        />
        <Divider />
        <AccountRow label={t("profile.joined")} value={formatDate(me.createdAt, lang)} dir={rowDir} />
      </Card>

      <View style={{ marginTop: 22 }}>
        <Button label={t("auth.signOut")} variant="outline" onPress={() => void signOut()} />
      </View>

      <ChangeEmailSheet visible={emailOpen} onClose={() => setEmailOpen(false)} />
      <ChangePasswordSheet visible={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <ChangeMobileSheet visible={mobileOpen} onClose={() => setMobileOpen(false)} />
    </Screen>
  );
}

function AccountRow({
  label,
  value,
  dir,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  dir: "row" | "row-reverse";
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ flexDirection: dir, alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flexShrink: 1 }}>
        <ThemedText muted size={13}>
          {label}
        </ThemedText>
        <ThemedText size={13} weight="semibold" numberOfLines={1}>
          {value}
        </ThemedText>
      </View>
      {actionLabel && onAction ? (
        <ThemedText gold size={13} weight="semibold" onPress={onAction}>
          {actionLabel}
        </ThemedText>
      ) : null}
    </View>
  );
}

function SubscriptionHistoryRow({
  item,
  dir,
}: {
  item: SubscriptionHistoryItem;
  dir: "row" | "row-reverse";
}) {
  const { t, lang } = useI18n();
  const planName = lang === "ar" ? item.planNameAr : item.planNameEn;
  const statusTone = item.status === "active" ? "green" : "neutral";
  return (
    <Card>
      <View style={{ flexDirection: dir, alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <ThemedText weight="semibold" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
          {planName}
        </ThemedText>
        <Pill tone={statusTone} label={t(`subscription.status.${item.status}`)} />
      </View>
      <View style={{ marginTop: 10, gap: 4 }}>
        <View style={{ flexDirection: dir, alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <ThemedText muted size={12}>
            {t("subscription.started")}
          </ThemedText>
          <ThemedText size={12} weight="semibold">
            {formatDateTime(item.startedAt, lang)}
          </ThemedText>
        </View>
        {item.expiresAt ? (
          <View style={{ flexDirection: dir, alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <ThemedText muted size={12}>
              {t("subscription.expires")}
            </ThemedText>
            <ThemedText size={12} weight="semibold">
              {formatDateTime(item.expiresAt, lang)}
            </ThemedText>
          </View>
        ) : null}
        {item.priceSar ? (
          <View style={{ flexDirection: dir, alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <ThemedText muted size={12}>
              {t("subscription.price")}
            </ThemedText>
            <ThemedText size={12} weight="semibold" gold>
              {item.priceSar} {lang === "ar" ? "ريال" : "SAR"}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
