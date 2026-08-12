import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getGetMySubscriptionQueryKey,
  getGetSubscriptionHistoryQueryKey,
  useGetMySubscription,
  useGetPlans,
  useIapSync,
  type Plan,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Modal, Pressable, View } from "react-native";

import {
  Button,
  Card,
  Divider,
  ErrorState,
  ListSkeleton,
  Pill,
  Reveal,
  Screen,
  Skeleton,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";
import { purchaseWasCancelled, useSubscription } from "@/lib/revenuecat";

type Banner =
  | { kind: "success" }
  | { kind: "pending" }
  | { kind: "restored" }
  | { kind: "restoreNone" }
  | { kind: "error" }
  | { kind: "unavailable" }
  | null;

// Mirror of the web's planFeatures(): enforced entitlements first, then the
// admin-authored display-only marketing bullets.
function planFeatures(
  plan: Plan,
  t: (k: string, vars?: Record<string, string | number>) => string,
  lang: string,
): string[] {
  const features: string[] = [];
  if (plan.participantLimit != null) {
    features.push(t("pricing.feat.participants", { n: plan.participantLimit }));
  }
  const has = (key: string) =>
    plan.entitlements.some((e) => e.key === key && e.value === "true");
  if (has("advanced_stats")) features.push(t("pricing.feat.advancedStats"));
  if (has("custom_prizes")) features.push(t("pricing.feat.customPrizes"));
  if (has("premium_features")) features.push(t("pricing.feat.premiumFeatures"));
  if (has("priority_support")) features.push(t("pricing.feat.prioritySupport"));
  for (const f of plan.displayFeatures ?? []) {
    const text = lang === "ar" ? f.ar : f.en;
    if (text && text.trim()) features.push(text);
  }
  return features;
}

export default function PaywallScreen() {
  const c = useColors();
  const { t, lang, dir, formatNum } = useI18n();
  const queryClient = useQueryClient();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const plansQ = useGetPlans();
  const subQ = useGetMySubscription({
    query: { queryKey: getGetMySubscriptionQueryKey(), staleTime: 60_000 },
  });
  const sub = useSubscription();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      sub.refetch();
      await plansQ.refetch();
    } finally {
      setRefreshing(false);
    }
  };
  const iapSync = useIapSync();

  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const plans = plansQ.data;
  const current = subQ.data;

  const { activePlan, currentPrice, upgrades, onTopPlan } = useMemo(() => {
    const all = (plans ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);
    const active =
      current?.status === "active"
        ? all.find((p) => p.code === current.planCode)
        : undefined;
    const price = active ? Number(active.priceSar) : 0;
    // Hide free, coming-soon, the current plan and anything cheaper-or-equal:
    // only genuine upgrades are purchasable here.
    const ups = all.filter(
      (p) =>
        p.isActive &&
        !p.isComingSoon &&
        Number(p.priceSar) > 0 &&
        Number(p.priceSar) > price,
    );
    return {
      activePlan: active,
      currentPrice: price,
      upgrades: ups,
      onTopPlan: price > 0 && ups.length === 0,
    };
  }, [plans, current]);

  const invalidateSubscription = () => {
    void queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    void queryClient.invalidateQueries({
      queryKey: getGetSubscriptionHistoryQueryKey(),
    });
  };

  const priceLabel = (plan: Plan): string => {
    // Prefer the live store-formatted price; fall back to the catalog price.
    const pkg = sub.packagesByPlanCode[plan.code];
    const storePrice = pkg?.product?.priceString;
    if (storePrice) return storePrice;
    return `${formatNum(Number(plan.priceSar))} ${lang === "ar" ? "ريال" : "SAR"}`;
  };

  const confirmPurchase = async () => {
    const plan = pendingPlan;
    setPendingPlan(null);
    if (!plan) return;
    const pkg = sub.packagesByPlanCode[plan.code];
    if (!pkg) {
      setBanner({ kind: "unavailable" });
      return;
    }
    setBusy(true);
    setBanner(null);
    try {
      await sub.purchaseAsync(pkg);
      // The store purchase succeeded; ask the server to verify the entitlement
      // and mirror it into our subscriptions table. The server is the source of
      // truth — a successful store purchase that the server cannot yet confirm
      // shows as "pending" rather than a false success.
      const result = await iapSync.mutateAsync();
      if (result.activated) {
        invalidateSubscription();
        setBanner({ kind: "success" });
      } else {
        setBanner({ kind: "pending" });
      }
    } catch (err) {
      if (!purchaseWasCancelled(err)) {
        setBanner({ kind: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setBanner(null);
    try {
      await sub.restoreAsync();
      const result = await iapSync.mutateAsync();
      if (result.activated) {
        invalidateSubscription();
        setBanner({ kind: "restored" });
      } else {
        setBanner({ kind: "restoreNone" });
      }
    } catch {
      setBanner({ kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  if (plansQ.isLoading || subQ.isLoading) {
    return (
      <Screen scroll>
        <PaywallHeader />
        <Card style={{ marginBottom: 18 }}>
          <Skeleton width="40%" height={12} />
          <View style={{ marginTop: 8 }}>
            <Skeleton width="55%" height={17} />
          </View>
        </Card>
        <Card>
          <ListSkeleton rows={4} />
        </Card>
      </Screen>
    );
  }
  if (plansQ.isError || !plans) {
    return (
      <Screen>
        <PaywallHeader />
        <ErrorState
          message={t("common.loadError")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void plansQ.refetch()}
        />
      </Screen>
    );
  }

  const bannerText: Record<NonNullable<Banner>["kind"], string> = {
    success: t("pricing.paymentSuccess"),
    pending: t("paywall.verifyPending"),
    restored: t("paywall.restored"),
    restoreNone: t("paywall.restoreNone"),
    error: t("paywall.purchaseFailed"),
    unavailable: t("paywall.unavailable"),
  };
  const bannerTone = (k: NonNullable<Banner>["kind"]) =>
    k === "success" || k === "restored" ? c.primary : c.destructive;

  return (
    <Screen scroll onRefresh={() => void handleRefresh()} refreshing={refreshing}>
      <PaywallHeader />

      <ThemedText muted size={14} style={{ marginBottom: 18 }}>
        {t("pricing.subtitle")}
      </ThemedText>

      {banner ? (
        <Card style={{ marginBottom: 16, borderColor: bannerTone(banner.kind) }}>
          <ThemedText
            weight="semibold"
            size={14}
            style={{ color: bannerTone(banner.kind) }}
          >
            {bannerText[banner.kind]}
          </ThemedText>
        </Card>
      ) : null}

      {/* current plan */}
      <Card style={{ marginBottom: 18 }}>
        <View
          style={{
            flexDirection: rowDir,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flexShrink: 1 }}>
            <ThemedText muted size={12}>
              {t("pricing.currentPlan")}
            </ThemedText>
            <ThemedText weight="bold" size={17} style={{ marginTop: 2 }}>
              {current
                ? lang === "ar"
                  ? current.planNameAr
                  : current.planNameEn
                : "—"}
            </ThemedText>
          </View>
          {activePlan ? <Pill tone="gold" label={t("pricing.alreadyOwned")} /> : null}
        </View>
      </Card>

      {!sub.ready || !sub.offeringReady ? (
        <Card style={{ marginBottom: 16 }}>
          <ThemedText muted size={13}>
            {t("paywall.unavailable")}
          </ThemedText>
        </Card>
      ) : null}

      {onTopPlan ? (
        <Card>
          <ThemedText weight="bold" size={16}>
            {t("paywall.topPlan")}
          </ThemedText>
          <ThemedText muted size={13} style={{ marginTop: 6 }}>
            {t("paywall.topPlanDesc")}
          </ThemedText>
        </Card>
      ) : (
        upgrades.map((plan, i) => {
          const features = planFeatures(plan, t, lang);
          const highlighted = plan.code === "professional";
          const pkg = sub.packagesByPlanCode[plan.code];
          const canBuy = sub.ready && sub.offeringReady && Boolean(pkg);
          return (
            <Reveal key={plan.id} delay={i * 70}>
            <Card
              glow={highlighted ? "gold" : undefined}
              style={{ marginBottom: 14 }}
            >
              <View
                style={{
                  flexDirection: rowDir,
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <ThemedText weight="extrabold" size={19}>
                  {lang === "ar" ? plan.nameAr : plan.nameEn}
                </ThemedText>
                {highlighted ? (
                  <Pill tone="gold" label={t("pricing.mostPopular")} />
                ) : null}
              </View>

              <View
                style={{ flexDirection: rowDir, alignItems: "flex-end", gap: 6, marginTop: 8 }}
              >
                <ThemedText weight="extrabold" size={26} gold={highlighted}>
                  {priceLabel(plan)}
                </ThemedText>
                <ThemedText muted size={12} style={{ marginBottom: 4 }}>
                  {t("pricing.perEdition")}
                </ThemedText>
              </View>

              <Divider />

              <View style={{ gap: 10 }}>
                {features.map((f, i) => (
                  <View
                    key={i}
                    style={{ flexDirection: rowDir, alignItems: "flex-start", gap: 10 }}
                  >
                    <Feather
                      name="check"
                      size={16}
                      color={highlighted ? c.secondary : c.primary}
                      style={{ marginTop: 2 }}
                    />
                    <ThemedText size={13} style={{ flexShrink: 1 }}>
                      {f}
                    </ThemedText>
                  </View>
                ))}
              </View>

              <View style={{ marginTop: 16 }}>
                <Button
                  label={
                    canBuy
                      ? currentPrice > 0
                        ? t("pricing.upgrade")
                        : t("pricing.choosePlan")
                      : t("paywall.unavailable")
                  }
                  variant={highlighted ? "primary" : "secondary"}
                  disabled={!canBuy || busy}
                  loading={busy}
                  onPress={() => setPendingPlan(plan)}
                  testID={`buy-${plan.code}`}
                />
              </View>
            </Card>
            </Reveal>
          );
        })
      )}

      {/* Restore is required by App Store review (guideline 3.1.1). */}
      <View style={{ marginTop: 8 }}>
        <Button
          label={busy ? t("paywall.restoring") : t("paywall.restore")}
          variant="ghost"
          disabled={busy || !sub.ready}
          onPress={() => void restore()}
        />
      </View>

      <ConfirmModal
        plan={pendingPlan}
        priceLabel={pendingPlan ? priceLabel(pendingPlan) : ""}
        onCancel={() => setPendingPlan(null)}
        onConfirm={() => void confirmPurchase()}
      />
    </Screen>
  );
}

function PaywallHeader() {
  const c = useColors();
  const { t, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View
      style={{
        flexDirection: rowDir,
        alignItems: "center",
        gap: 6,
        marginBottom: 16,
      }}
    >
      <Pressable onPress={() => router.back()} hitSlop={8} style={{ padding: 4 }}>
        <Feather
          name={dir === "rtl" ? "chevron-right" : "chevron-left"}
          size={26}
          color={c.foreground}
        />
      </Pressable>
      <ThemedText weight="extrabold" size={22}>
        {t("pricing.title")}
      </ThemedText>
    </View>
  );
}

function ConfirmModal({
  plan,
  priceLabel,
  onCancel,
  onConfirm,
}: {
  plan: Plan | null;
  priceLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const c = useColors();
  const { t, lang, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const planName = plan ? (lang === "ar" ? plan.nameAr : plan.nameEn) : "";
  return (
    <Modal
      visible={plan !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: c.card,
            borderColor: c.border,
            borderWidth: 1,
            borderRadius: c.radius,
            padding: 20,
            gap: 8,
          }}
        >
          <ThemedText weight="extrabold" size={18}>
            {t("paywall.confirmTitle")}
          </ThemedText>
          <ThemedText muted size={14}>
            {t("paywall.confirmBody", { plan: planName, price: priceLabel })}
          </ThemedText>
          <View style={{ flexDirection: rowDir, gap: 10, marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t("common.cancel")}
                variant="outline"
                onPress={onCancel}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t("paywall.confirm")} onPress={onConfirm} />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
