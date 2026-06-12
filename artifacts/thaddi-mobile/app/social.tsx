import { Feather } from "@expo/vector-icons";
import {
  useCancelFriendRequest,
  useGetMySocial,
  useRespondFriendRequest,
  type FriendRequestItem,
  type PlayerSummary,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";

import { PlayerLink, RelationshipButtons, useInvalidateSocial } from "@/components/social";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Pill,
  Screen,
  ScreenHeader,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

function PersonRow({
  person,
  action,
}: {
  person: PlayerSummary;
  action?: React.ReactNode;
}) {
  const { t, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View style={{ gap: 12 }}>
      <PlayerLink userId={person.userId}>
        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 12 }}>
          <Avatar uri={person.avatarUrl} name={person.displayName} size={44} />
          <View style={{ flex: 1 }}>
            <ThemedText weight="semibold" size={15} numberOfLines={1}>
              {person.displayName ?? t("common.na")}
            </ThemedText>
            {person.username ? (
              <ThemedText muted size={12}>
                @{person.username}
              </ThemedText>
            ) : null}
          </View>
        </View>
      </PlayerLink>
      {action ? <View>{action}</View> : null}
    </View>
  );
}

function IncomingActions({ item }: { item: FriendRequestItem }) {
  const { t, dir } = useI18n();
  const c = useColors();
  const invalidate = useInvalidateSocial();
  const respond = useRespondFriendRequest({
    mutation: { onSuccess: () => invalidate(item.user.userId) },
  });
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View style={{ flexDirection: rowDir, flexWrap: "wrap", gap: 8 }}>
      <Button
        label={t("social.accept")}
        variant="secondary"
        fullWidth={false}
        disabled={respond.isPending}
        icon={<Feather name="check" size={16} color={c.secondaryForeground} />}
        onPress={() => respond.mutate({ requestId: item.id, data: { accept: true } })}
        testID={`button-accept-${item.id}`}
      />
      <Button
        label={t("social.decline")}
        variant="outline"
        fullWidth={false}
        disabled={respond.isPending}
        icon={<Feather name="x" size={16} color={c.foreground} />}
        onPress={() => respond.mutate({ requestId: item.id, data: { accept: false } })}
        testID={`button-decline-${item.id}`}
      />
    </View>
  );
}

function OutgoingActions({ item }: { item: FriendRequestItem }) {
  const { t } = useI18n();
  const c = useColors();
  const invalidate = useInvalidateSocial();
  const cancel = useCancelFriendRequest({
    mutation: { onSuccess: () => invalidate(item.user.userId) },
  });
  return (
    <Button
      label={t("social.cancelRequest")}
      variant="outline"
      fullWidth={false}
      disabled={cancel.isPending}
      icon={<Feather name="clock" size={16} color={c.foreground} />}
      onPress={() => cancel.mutate({ id: item.user.userId })}
      testID={`button-cancel-${item.id}`}
    />
  );
}

function SectionHeader({
  icon,
  title,
  count,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  count: number;
}) {
  const c = useColors();
  const { dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View
      style={{
        flexDirection: rowDir,
        alignItems: "center",
        gap: 8,
        marginTop: 22,
        marginBottom: 12,
      }}
    >
      <Feather name={icon} size={18} color={c.thaddiGold} />
      <ThemedText weight="bold" size={16}>
        {title}
      </ThemedText>
      {count > 0 ? <Pill tone="gold" label={formatNum(count)} /> : null}
    </View>
  );
}

export default function SocialScreen() {
  const { t, dir } = useI18n();
  const c = useColors();
  const socialQ = useGetMySocial();

  const backIcon = dir === "rtl" ? "chevron-right" : "chevron-left";
  const header = (
    <ScreenHeader
      title={t("social.title")}
      subtitle={t("social.subtitle")}
      left={
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Feather name={backIcon} size={24} color={c.foreground} />
        </Pressable>
      }
    />
  );

  if (socialQ.isLoading) {
    return (
      <Screen>
        {header}
        <LoadingState />
      </Screen>
    );
  }

  if (socialQ.isError || !socialQ.data) {
    return (
      <Screen>
        {header}
        <ErrorState
          message={t("gate.error.desc")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void socialQ.refetch()}
        />
      </Screen>
    );
  }

  const friends = socialQ.data.friends ?? [];
  const incoming = socialQ.data.incomingRequests ?? [];
  const outgoing = socialQ.data.outgoingRequests ?? [];

  return (
    <Screen scroll>
      {header}

      {/* incoming requests */}
      <SectionHeader icon="inbox" title={t("social.incoming")} count={incoming.length} />
      {incoming.length === 0 ? (
        <Card>
          <EmptyState title={t("social.noIncoming")} />
        </Card>
      ) : (
        <Card>
          <View style={{ gap: 18 }}>
            {incoming.map((item) => (
              <PersonRow
                key={item.id}
                person={item.user}
                action={<IncomingActions item={item} />}
              />
            ))}
          </View>
        </Card>
      )}

      {/* outgoing requests */}
      <SectionHeader icon="send" title={t("social.outgoing")} count={outgoing.length} />
      {outgoing.length === 0 ? (
        <Card>
          <EmptyState title={t("social.noOutgoing")} />
        </Card>
      ) : (
        <Card>
          <View style={{ gap: 18 }}>
            {outgoing.map((item) => (
              <PersonRow
                key={item.id}
                person={item.user}
                action={<OutgoingActions item={item} />}
              />
            ))}
          </View>
        </Card>
      )}

      {/* friends */}
      <SectionHeader icon="users" title={t("social.friends")} count={friends.length} />
      {friends.length === 0 ? (
        <Card>
          <EmptyState title={t("social.noFriends")} subtitle={t("social.empty")} />
        </Card>
      ) : (
        <Card>
          <View style={{ gap: 18 }}>
            {friends.map((friend) => (
              <PersonRow
                key={friend.userId}
                person={friend}
                action={<RelationshipButtons userId={friend.userId} viewer={friend.viewer} />}
              />
            ))}
          </View>
        </Card>
      )}

      <View style={{ height: 24 }} />
    </Screen>
  );
}
