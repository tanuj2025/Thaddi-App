import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMySocialQueryKey,
  getGetPlayerProfileQueryKey,
  useCancelFriendRequest,
  useFollowUser,
  useRemoveFriend,
  useRespondFriendRequest,
  useSendFriendRequest,
  useUnfollowUser,
  type ViewerRelationship,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useCallback, type ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";

import { Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

/**
 * Invalidate every social-touching query after a follow/friend mutation.
 * Mirrors the web `useInvalidateSocial`: the player profile, the My-Social
 * overview, and any followers/following lists (matched by query-key prefix).
 */
export function useInvalidateSocial() {
  const qc = useQueryClient();
  return useCallback(
    (userId?: string) => {
      if (userId) {
        void qc.invalidateQueries({ queryKey: getGetPlayerProfileQueryKey(userId) });
      }
      void qc.invalidateQueries({ queryKey: getGetMySocialQueryKey() });
      void qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            typeof k === "string" && (k.includes("/followers") || k.includes("/following"))
          );
        },
      });
    },
    [qc],
  );
}

/**
 * Wraps any row/content so tapping it opens that player's public profile.
 * Renders children unwrapped when there is no userId (e.g. a placeholder row)
 * so it never blocks an otherwise-static layout.
 */
export function PlayerLink({
  userId,
  children,
  style,
  disabled,
}: {
  userId?: string | null;
  children: ReactNode;
  style?: ViewStyle;
  disabled?: boolean;
}) {
  if (!userId || disabled) return <>{children}</>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/players/${userId}`)}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Follow / friend relationship controls. Ports the web RelationshipButtons:
 * follow/unfollow plus the friend-request lifecycle (add / cancel / accept /
 * decline / remove). Returns null for the caller's own profile.
 */
export function RelationshipButtons({
  userId,
  viewer,
}: {
  userId: string;
  viewer: ViewerRelationship;
}) {
  const { t, dir } = useI18n();
  const c = useColors();
  const invalidate = useInvalidateSocial();
  const onChanged = () => invalidate(userId);

  const follow = useFollowUser({ mutation: { onSuccess: onChanged } });
  const unfollow = useUnfollowUser({ mutation: { onSuccess: onChanged } });
  const sendReq = useSendFriendRequest({ mutation: { onSuccess: onChanged } });
  const cancelReq = useCancelFriendRequest({ mutation: { onSuccess: onChanged } });
  const removeFr = useRemoveFriend({ mutation: { onSuccess: onChanged } });
  const respond = useRespondFriendRequest({ mutation: { onSuccess: onChanged } });

  if (viewer.isSelf) return null;

  const busy =
    follow.isPending ||
    unfollow.isPending ||
    sendReq.isPending ||
    cancelReq.isPending ||
    removeFr.isPending ||
    respond.isPending;

  const fgFor = (variant: "primary" | "secondary" | "outline") =>
    variant === "primary"
      ? c.primaryForeground
      : variant === "secondary"
        ? c.secondaryForeground
        : c.foreground;

  const icon = (name: keyof typeof Feather.glyphMap, variant: "primary" | "secondary" | "outline") => (
    <Feather name={name} size={16} color={fgFor(variant)} />
  );

  return (
    <View
      style={{
        flexDirection: dir === "rtl" ? "row-reverse" : "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
      }}
    >
      {viewer.isFollowing ? (
        <Button
          label={t("social.followingState")}
          variant="outline"
          fullWidth={false}
          disabled={busy}
          icon={icon("user-check", "outline")}
          onPress={() => unfollow.mutate({ id: userId })}
          testID="button-unfollow"
        />
      ) : (
        <Button
          label={t("social.follow")}
          variant="primary"
          fullWidth={false}
          disabled={busy}
          icon={icon("user-plus", "primary")}
          onPress={() => follow.mutate({ id: userId })}
          testID="button-follow"
        />
      )}

      {viewer.friendStatus === "friends" && (
        <Button
          label={t("social.removeFriend")}
          variant="outline"
          fullWidth={false}
          disabled={busy}
          icon={icon("user-minus", "outline")}
          onPress={() => removeFr.mutate({ id: userId })}
          testID="button-remove-friend"
        />
      )}

      {viewer.friendStatus === "none" && (
        <Button
          label={t("social.addFriend")}
          variant="secondary"
          fullWidth={false}
          disabled={busy}
          icon={icon("user-plus", "secondary")}
          onPress={() => sendReq.mutate({ id: userId })}
          testID="button-add-friend"
        />
      )}

      {viewer.friendStatus === "request_sent" && (
        <Button
          label={t("social.cancelRequest")}
          variant="outline"
          fullWidth={false}
          disabled={busy}
          icon={icon("clock", "outline")}
          onPress={() => cancelReq.mutate({ id: userId })}
          testID="button-cancel-request"
        />
      )}

      {viewer.friendStatus === "request_received" && viewer.incomingRequestId && (
        <>
          <Button
            label={t("social.accept")}
            variant="secondary"
            fullWidth={false}
            disabled={busy}
            icon={icon("check", "secondary")}
            onPress={() =>
              respond.mutate({
                requestId: viewer.incomingRequestId!,
                data: { accept: true },
              })
            }
            testID="button-accept-request"
          />
          <Button
            label={t("social.decline")}
            variant="outline"
            fullWidth={false}
            disabled={busy}
            icon={icon("x", "outline")}
            onPress={() =>
              respond.mutate({
                requestId: viewer.incomingRequestId!,
                data: { accept: false },
              })
            }
            testID="button-decline-request"
          />
        </>
      )}
    </View>
  );
}
