import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetChallengeMessagesQueryKey,
  getGetChallengeParticipantsQueryKey,
  getGetChallengeQueryKey,
  getGetChallengeRankingQueryKey,
  getGetMyChallengesQueryKey,
  useGetChallenge,
  useGetChallengeMessages,
  useGetChallengeParticipants,
  useGetChallengeRanking,
  useLeaveChallenge,
  usePostChallengeMessage,
  type ChallengeMessage,
  type Participant,
  type RankingEntry,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, Pressable, Share, View } from "react-native";

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
  TextField,
  ThemedText,
} from "@/components/ui";
import { PlayerLink } from "@/components/social";
import { useColors } from "@/hooks/useColors";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function ChallengeDetailScreen() {
  const c = useColors();
  const { t, lang, dir, formatNum } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const cid = id ?? "";

  const q = useGetChallenge(cid, {
    query: { enabled: !!cid, queryKey: getGetChallengeQueryKey(cid) },
  });
  const ch = q.data;
  const isMember = !!(ch?.isOwner || ch?.isParticipant || ch?.isAssistant);
  const canManage = !!(ch?.isOwner || ch?.isAssistant);
  const leave = useLeaveChallenge();

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
        <ThemedText weight="bold" size={16} numberOfLines={1} style={{ marginHorizontal: 6, flex: 1 }}>
          {ch?.name ?? t("detail.title")}
        </ThemedText>
        {canManage ? (
          <Pressable
            onPress={() => router.push(`/challenge/${cid}/manage`)}
            hitSlop={8}
            style={{ padding: 4 }}
            accessibilityLabel={t("detail.settings")}
          >
            <Feather name="settings" size={22} color={c.foreground} />
          </Pressable>
        ) : null}
      </View>

      {q.isLoading ? (
        <LoadingState />
      ) : q.isError || !ch ? (
        <ErrorState
          message={t("common.loadError")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          {/* header card */}
          <Card>
            <ThemedText weight="extrabold" size={22} numberOfLines={2}>
              {ch.name}
            </ThemedText>
            {ch.description ? (
              <ThemedText muted size={14} style={{ marginTop: 6 }}>
                {ch.description}
              </ThemedText>
            ) : null}
            <View
              style={{
                flexDirection: rowDir,
                flexWrap: "wrap",
                gap: 8,
                marginTop: 12,
              }}
            >
              <Pill tone="gold" label={t(`type.${ch.type}`)} />
              <Pill
                tone={ch.visibility === "private" ? "neutral" : "green"}
                label={t(`visibility.${ch.visibility}`)}
              />
              <Pill tone="neutral" label={t(`pv.${ch.predictionVisibility}`)} />
            </View>
            <Divider />
            <View style={{ flexDirection: rowDir, alignItems: "center", gap: 18 }}>
              <PlayerLink
                userId={ch.owner.id}
                style={{ flexDirection: rowDir, alignItems: "center", gap: 8 }}
              >
                <Avatar uri={ch.owner.avatarUrl} name={ch.owner.displayName ?? "?"} size={28} />
                <View>
                  <ThemedText muted size={11}>
                    {t("detail.organizer")}
                  </ThemedText>
                  <ThemedText size={13} weight="semibold" numberOfLines={1}>
                    {ch.owner.displayName ?? "—"}
                  </ThemedText>
                </View>
              </PlayerLink>
              <View style={{ flexDirection: rowDir, alignItems: "center", gap: 6 }}>
                <Feather name="users" size={15} color={c.mutedForeground} />
                <ThemedText size={13} muted>
                  {ch.participantLimit != null
                    ? t("detail.inviteParticipants")
                        .replace("{count}", formatNum(ch.participantCount))
                        .replace("{limit}", formatNum(ch.participantLimit))
                    : t("detail.inviteParticipantsUnlimited").replace(
                        "{count}",
                        formatNum(ch.participantCount),
                      )}
                </ThemedText>
              </View>
            </View>
          </Card>

          {/* invite & share */}
          {isMember && ch.inviteCode ? (
            <InviteCard
              code={ch.inviteCode}
              link={ch.inviteLink ?? null}
              name={ch.name}
            />
          ) : null}

          {/* leaderboard */}
          <SectionTitle title={t("rankings.challengeStandings")} />
          <LeaderboardCard id={cid} />

          {/* participants */}
          <SectionTitle title={t("detail.participants")} />
          <ParticipantsCard id={cid} />

          {/* chat */}
          <SectionTitle title={t("chat.title")} />
          <ChatCard id={cid} />

          {/* leave */}
          {!ch.isOwner && ch.isParticipant ? (
            <View style={{ marginTop: 22 }}>
              <Button
                label={t("detail.leave")}
                variant="outline"
                onPress={() => confirmLeave()}
                icon={<Feather name="log-out" size={16} color={c.destructive} />}
              />
            </View>
          ) : null}

          <View style={{ height: 28 }} />
        </>
      )}
    </Screen>
  );

  function confirmLeave() {
    Alert.alert(t("detail.leaveConfirmTitle"), t("detail.leaveConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("detail.leave"),
        style: "destructive",
        onPress: () => doLeave(),
      },
    ]);
  }

  function doLeave() {
    leave.mutate(
      { id: cid },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          router.back();
        },
        onError: () => Alert.alert(t("detail.leaveError")),
      },
    );
  }
}

function SectionTitle({ title }: { title: string }) {
  return (
    <ThemedText weight="bold" size={16} style={{ marginTop: 24, marginBottom: 12 }}>
      {title}
    </ThemedText>
  );
}

function InviteCard({
  code,
  link,
  name,
}: {
  code: string;
  link: string | null;
  name: string;
}) {
  const c = useColors();
  const { t, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const onShare = async () => {
    const msg = `${t("detail.shareMessage")}\n${link ?? code}`;
    try {
      await Share.share({ message: msg });
    } catch {
      // user dismissed; no-op
    }
  };

  return (
    <Card style={{ marginTop: 16, borderColor: "rgba(232,180,48,0.3)" }}>
      <View style={{ flexDirection: rowDir, alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Feather name="share-2" size={16} color={c.thaddiGold} />
        <ThemedText weight="bold" size={15}>
          {t("detail.invite")}
        </ThemedText>
      </View>
      <ThemedText muted size={12} style={{ marginBottom: 6 }}>
        {t("detail.inviteCode")}
      </ThemedText>
      <View
        style={{
          backgroundColor: "rgba(232,180,48,0.10)",
          borderColor: "rgba(232,180,48,0.3)",
          borderWidth: 1,
          borderRadius: c.radius,
          paddingVertical: 14,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <ThemedText weight="extrabold" size={26} gold style={{ letterSpacing: 4 }}>
          {code}
        </ThemedText>
      </View>
      <Button
        label={t("detail.shareWhatsApp")}
        onPress={onShare}
        icon={<Feather name="share-2" size={16} color={c.primaryForeground} />}
      />
    </Card>
  );
}

function LeaderboardCard({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useGetChallengeRanking(id, {
    query: { enabled: !!id, queryKey: getGetChallengeRankingQueryKey(id) },
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={t("common.loadError")}
        retryLabel={t("common.tryAgain")}
        onRetry={() => void q.refetch()}
      />
    );
  const entries = q.data?.entries ?? [];
  if (entries.length === 0) return <Card><EmptyState title={t("rankings.empty")} /></Card>;
  return (
    <Card>
      {entries.map((e, i) => (
        <View key={e.userId}>
          {i > 0 ? <Divider /> : null}
          <RankRow e={e} />
        </View>
      ))}
    </Card>
  );
}

function RankRow({ e }: { e: RankingEntry }) {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const name = e.displayName ?? "—";
  return (
    <View
      style={{
        flexDirection: rowDir,
        alignItems: "center",
        gap: 12,
        backgroundColor: e.isCurrentUser ? "rgba(39,176,112,0.10)" : "transparent",
        borderRadius: c.radius,
        paddingVertical: 4,
      }}
    >
      <ThemedText
        weight="extrabold"
        size={16}
        gold={e.rank <= 3}
        style={{ minWidth: 28, textAlign: "center" }}
      >
        {formatNum(e.rank)}
      </ThemedText>
      <PlayerLink
        userId={e.userId}
        style={{ flexDirection: rowDir, alignItems: "center", gap: 12, flex: 1 }}
      >
        <Avatar uri={e.avatarUrl} name={name} size={34} />
        <View style={{ flex: 1 }}>
          <ThemedText size={14} weight="semibold" numberOfLines={1}>
            {name}
            {e.isCurrentUser ? ` · ${t("rankings.you")}` : ""}
          </ThemedText>
          {e.accuracy != null ? (
            <ThemedText muted size={12}>
              {t("rankings.accuracy")}: {formatNum(Math.round(e.accuracy * 100))}% ·{" "}
              {t("rankings.exact")}: {formatNum(e.exactPredictions)}
            </ThemedText>
          ) : null}
        </View>
      </PlayerLink>
      <ThemedText weight="bold" size={15} gold>
        {formatNum(e.points)}
      </ThemedText>
    </View>
  );
}

function ParticipantsCard({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useGetChallengeParticipants(id, {
    query: { enabled: !!id, queryKey: getGetChallengeParticipantsQueryKey(id) },
  });
  if (q.isLoading) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={t("common.loadError")}
        retryLabel={t("common.tryAgain")}
        onRetry={() => void q.refetch()}
      />
    );
  const list = q.data ?? [];
  if (list.length === 0) return <Card><EmptyState title={t("detail.participants.empty")} /></Card>;
  return (
    <Card>
      {list.map((p, i) => (
        <View key={p.userId}>
          {i > 0 ? <Divider /> : null}
          <ParticipantRow p={p} />
        </View>
      ))}
    </Card>
  );
}

function ParticipantRow({ p }: { p: Participant }) {
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const name = p.displayName ?? "—";
  return (
    <View style={{ flexDirection: rowDir, alignItems: "center", gap: 12 }}>
      <PlayerLink
        userId={p.userId}
        style={{ flexDirection: rowDir, alignItems: "center", gap: 12, flex: 1 }}
      >
        <Avatar uri={p.avatarUrl} name={name} size={36} />
        <View style={{ flex: 1 }}>
          <ThemedText size={14} weight="semibold" numberOfLines={1}>
            {name}
          </ThemedText>
          <View style={{ flexDirection: rowDir, gap: 6, marginTop: 2 }}>
            {p.isOwner ? <Pill tone="gold" label={t("detail.ownerBadge")} /> : null}
            {p.isAssistant ? <Pill tone="green" label={t("detail.assistantBadge")} /> : null}
          </View>
        </View>
      </PlayerLink>
      <View style={{ alignItems: dir === "rtl" ? "flex-start" : "flex-end" }}>
        <ThemedText weight="bold" size={15} gold>
          {formatNum(p.points)}
        </ThemedText>
        <ThemedText muted size={11}>
          {t("detail.points")}
        </ThemedText>
      </View>
    </View>
  );
}

function ChatCard({ id }: { id: string }) {
  const c = useColors();
  const { t, lang, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const queryClient = useQueryClient();

  const q = useGetChallengeMessages(id, undefined, {
    query: {
      enabled: !!id,
      refetchInterval: 15000,
      queryKey: getGetChallengeMessagesQueryKey(id),
    },
  });
  const post = usePostChallengeMessage();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const data = q.data;
  const canPost = data?.canPost ?? false;

  const send = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setError(null);
    post.mutate(
      { id, data: { body: trimmed } },
      {
        onSuccess: () => {
          setBody("");
          void queryClient.invalidateQueries({
            queryKey: getGetChallengeMessagesQueryKey(id),
          });
        },
        onError: () => setError(t("chat.sendError")),
      },
    );
  };

  if (q.isLoading) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={t("chat.loadError")}
        retryLabel={t("common.tryAgain")}
        onRetry={() => void q.refetch()}
      />
    );

  const messages = data?.messages ?? [];

  return (
    <Card>
      {messages.length === 0 ? (
        <EmptyState title={t("chat.empty")} />
      ) : (
        <View style={{ gap: 14 }}>
          {messages.map((m) => (
            <ChatBubble key={m.id} m={m} lang={lang} dir={dir} />
          ))}
        </View>
      )}

      {canPost ? (
        <>
          <Divider />
          <View style={{ flexDirection: rowDir, alignItems: "flex-end", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <TextField
                value={body}
                onChangeText={(v) => {
                  setBody(v);
                  if (error) setError(null);
                }}
                placeholder={t("chat.placeholder")}
                multiline
              />
            </View>
            <Pressable
              onPress={send}
              disabled={post.isPending || !body.trim()}
              style={({ pressed }) => ({
                width: 46,
                height: 46,
                borderRadius: 23,
                backgroundColor: c.primary,
                alignItems: "center",
                justifyContent: "center",
                opacity: post.isPending || !body.trim() ? 0.5 : pressed ? 0.8 : 1,
                marginBottom: 4,
              })}
            >
              <Feather
                name={dir === "rtl" ? "arrow-left" : "arrow-right"}
                size={20}
                color={c.primaryForeground}
              />
            </Pressable>
          </View>
          {error ? (
            <ThemedText size={12} color={c.destructive} style={{ marginTop: 6 }}>
              {error}
            </ThemedText>
          ) : null}
        </>
      ) : (
        <>
          <Divider />
          <ThemedText muted size={13} center>
            {t("chat.joinToChat")}
          </ThemedText>
        </>
      )}
    </Card>
  );
}

function ChatBubble({
  m,
  lang,
  dir,
}: {
  m: ChallengeMessage;
  lang: "ar" | "en";
  dir: "rtl" | "ltr";
}) {
  const { t } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const name = m.isOwnMessage ? t("chat.you") : m.author.displayName ?? "—";
  return (
    <View style={{ flexDirection: rowDir, gap: 10 }}>
      <PlayerLink userId={m.author.id}>
        <Avatar uri={m.author.avatarUrl} name={name} size={32} />
      </PlayerLink>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 8 }}>
          <PlayerLink userId={m.author.id}>
            <ThemedText size={13} weight="semibold" numberOfLines={1}>
              {name}
            </ThemedText>
          </PlayerLink>
          <ThemedText muted size={11}>
            {formatDateTime(m.createdAt, lang)}
          </ThemedText>
        </View>
        <ThemedText size={14} style={{ marginTop: 2 }}>
          {m.body}
        </ThemedText>
      </View>
    </View>
  );
}
