import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getGetMyChallengesQueryKey,
  useGetInvitePreview,
  useGetMe,
  useJoinChallenge,
} from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import {
  Button,
  Card,
  Divider,
  ErrorState,
  LoadingState,
  Pill,
  Screen,
  ScreenHeader,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

const PENDING_KEY = "thaddi_pending_join";

/**
 * Deep-link join target — reachable via `thaddi-mobile://join/{code}`.
 *
 * Mirrors the web `join.tsx` flow:
 *  - Logged-out OR not-yet-activated: stash the code under `thaddi_pending_join`
 *    and bounce into the auth/activation flow. The ActivationGate consumes the
 *    pending code once the user is fully activated and returns here.
 *  - Signed-in & activated: render the invite preview with a Join button (or a
 *    "View challenge" shortcut when the user is already a member).
 */
export default function JoinScreen() {
  const { t, dir, formatNum } = useI18n();
  const c = useColors();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const queryClient = useQueryClient();

  const { code: codeParam } = useLocalSearchParams<{ code: string }>();
  const code = typeof codeParam === "string" ? codeParam : "";

  const { isLoaded, isSignedIn } = useAuth();
  const signedIn = isSignedIn === true;

  const previewQ = useGetInvitePreview(code, {
    query: { queryKey: ["invitePreview", code] },
  });
  const preview = previewQ.data;

  const meQ = useGetMe({
    query: { enabled: signedIn, queryKey: getGetMeQueryKey() },
  });
  const me = meQ.data;
  const activated = me?.activated === true;

  const join = useJoinChallenge();
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pendingStored, setPendingStored] = useState(false);

  // We can decide on auth/activation only once Clerk has loaded and — when
  // signed in — /api/me has resolved (success or error).
  const meResolved = !signedIn || me !== undefined || meQ.isError;
  const authReady = isLoaded && meResolved;
  const needsAuth = authReady && (!signedIn || !activated);

  // Logged-out OR not-activated: persist the code BEFORE redirecting so the
  // ActivationGate can resume the join once the user is fully activated.
  useEffect(() => {
    if (!needsAuth || !code) return;
    let active = true;
    void (async () => {
      try {
        await AsyncStorage.setItem(PENDING_KEY, code);
      } catch {
        // best-effort; navigation still proceeds
      }
      if (active) setPendingStored(true);
    })();
    return () => {
      active = false;
    };
  }, [needsAuth, code]);

  const backIcon = dir === "rtl" ? "chevron-right" : "chevron-left";
  const header = (
    <ScreenHeader
      title={t("join.invitedTitle")}
      left={
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Feather name={backIcon} size={24} color={c.foreground} />
        </Pressable>
      }
    />
  );

  // Brief splash while resolving auth, or while stashing the pending code
  // (avoids a flash of content before the redirect).
  if (!authReady || (needsAuth && !pendingStored)) {
    return (
      <Screen>
        {header}
        <LoadingState />
      </Screen>
    );
  }

  if (needsAuth) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // From here on: signed in AND activated.
  if (previewQ.isLoading) {
    return (
      <Screen>
        {header}
        <LoadingState />
      </Screen>
    );
  }

  if (previewQ.isError || !preview) {
    return (
      <Screen>
        {header}
        <ErrorState
          message={t("join.invalid")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void previewQ.refetch()}
        />
      </Screen>
    );
  }

  const goView = () => router.replace(`/challenge/${preview.id}`);

  const handleJoin = () => {
    setJoinError(null);
    join.mutate(
      { id: preview.id, data: { viaCode: code } },
      {
        onSuccess: () => {
          void AsyncStorage.removeItem(PENDING_KEY);
          void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          router.replace(`/challenge/${preview.id}`);
        },
        onError: (err) =>
          setJoinError(
            err?.data?.code === "owner_pool_full"
              ? t("join.full")
              : err?.data?.error || t("join.error"),
          ),
      },
    );
  };

  const prizeCount = preview.prizes.length;
  const limitSuffix = preview.participantLimit
    ? ` / ${formatNum(preview.participantLimit)}`
    : "";

  return (
    <Screen scroll>
      {header}

      <Card>
        {/* Invite identity */}
        <View style={{ alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(232,180,48,0.14)",
            }}
          >
            <Feather name="award" size={26} color={c.thaddiGold} />
          </View>
          <ThemedText weight="extrabold" size={22} gold center>
            {preview.name}
          </ThemedText>
          {preview.ownerDisplayName ? (
            <ThemedText muted size={13} center>
              {t("join.hostedBy")}: {preview.ownerDisplayName}
            </ThemedText>
          ) : null}
        </View>

        {preview.description ? (
          <>
            <Divider />
            <ThemedText size={14} center>
              {preview.description}
            </ThemedText>
          </>
        ) : null}

        <View
          style={{
            flexDirection: rowDir,
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "center",
            marginTop: 14,
          }}
        >
          <Pill
            tone="neutral"
            label={`${formatNum(preview.participantCount)}${limitSuffix}`}
          />
          {prizeCount > 0 ? (
            <Pill tone="gold" label={`${formatNum(prizeCount)} ${t("challenges.prizes")}`} />
          ) : null}
          <Pill tone="neutral" label={t(`type.${preview.type}`)} />
        </View>

        <Divider />

        {preview.alreadyJoined ? (
          <View style={{ gap: 12 }}>
            <View
              style={{
                flexDirection: rowDir,
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Feather name="check-circle" size={18} color={c.primary} />
              <ThemedText weight="bold" size={14} color={c.primary}>
                {t("join.alreadyIn")}
              </ThemedText>
            </View>
            <Button
              label={t("join.viewChallenge")}
              onPress={goView}
              testID="button-view-challenge"
            />
          </View>
        ) : preview.status !== "active" ? (
          <View
            style={{
              flexDirection: rowDir,
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Feather name="alert-circle" size={18} color={c.mutedForeground} />
            <ThemedText weight="bold" size={14} muted>
              {t("join.ended")}
            </ThemedText>
          </View>
        ) : preview.isFull ? (
          <View
            style={{
              flexDirection: rowDir,
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Feather name="alert-circle" size={18} color={c.destructive} />
            <ThemedText weight="bold" size={14} color={c.destructive}>
              {t("join.full")}
            </ThemedText>
          </View>
        ) : (
          <Button
            label={t("join.joinNow")}
            onPress={handleJoin}
            loading={join.isPending}
            testID="button-join"
          />
        )}

        {joinError ? (
          <ThemedText size={13} color={c.destructive} center style={{ marginTop: 10 }}>
            {joinError}
          </ThemedText>
        ) : null}
      </Card>
    </Screen>
  );
}
