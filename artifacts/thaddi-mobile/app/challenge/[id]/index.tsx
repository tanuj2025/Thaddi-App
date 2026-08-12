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
  useReportChallengeMessage,
  useBlockUser,
  type ChallengeMessage,
  type Participant,
  type RankingEntry,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, Image, Linking, Pressable, Share, View } from "react-native";

import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  GlowCard,
  ListSkeleton,
  Pill,
  Reveal,
  Screen,
  SectionTitle,
  Skeleton,
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
        <ChallengeDetailSkeleton />
      ) : q.isError || !ch ? (
        <ErrorState
          message={t("common.loadError")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          {/* header card */}
          <Reveal>
          <GlowCard tone="gold">
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
          </GlowCard>
          </Reveal>

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
  const { t, dir, lang } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const [qrOpen, setQrOpen] = useState(false);

  // Always use an absolute production URL so WhatsApp renders a tappable link
  // and the QR encodes a scannable address — even if the API returned a legacy
  // relative path from an older server.
  const canonicalLink =
    link && link.startsWith("https://")
      ? link
      : `https://thaddi.app/join/${code}`;

  const buildShareMessage = () =>
    lang === "ar"
      ? `🔥 ${t("detail.shareMessage")}\nاسم التحدي: ${name}\nرمز الانضمام: ${code}\n🔗 اضغط هنا للانضمام مباشرة: ${canonicalLink}`
      : `🔥 ${t("detail.shareMessage")}\nChallenge: ${name}\nCode: ${code}\n🔗 Tap here to join: ${canonicalLink}`;

  const onShareWhatsApp = async () => {
    // Use native whatsapp:// scheme so canOpenURL reliably detects installation.
    // LSApplicationQueriesSchemes includes "whatsapp" on iOS so this works there too.
    const msg = buildShareMessage();
    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    const canOpen = await Linking.canOpenURL(whatsappUrl);
    if (canOpen) {
      await Linking.openURL(whatsappUrl);
    } else {
      // Fallback to native share sheet when WhatsApp isn't installed
      try {
        await Share.share({ message: msg });
      } catch {
        // user dismissed; no-op
      }
    }
  };

  return (
    <>
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
        <View style={{ flexDirection: rowDir, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={t("detail.shareWhatsApp")}
              onPress={onShareWhatsApp}
              icon={<Feather name="share-2" size={16} color={c.primaryForeground} />}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t("detail.qrCode")}
              variant="outline"
              onPress={() => setQrOpen(true)}
              icon={<Feather name="image" size={16} color={c.secondary} />}
            />
          </View>
        </View>
      </Card>

      <BottomSheet visible={qrOpen} onClose={() => setQrOpen(false)} title={t("detail.qrTitle")}>
        <View style={{ alignItems: "center", padding: 24, gap: 16 }}>
          <ThemedText center muted size={14}>
            {t("detail.qrDesc")}
          </ThemedText>
          <View style={{ padding: 16, backgroundColor: "#ffffff", borderRadius: 16 }}>
            <Image
              source={{
                uri: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(canonicalLink)}`,
              }}
              style={{ width: 200, height: 200 }}
              resizeMode="contain"
            />
          </View>
        </View>
      </BottomSheet>
    </>
  );
}

function LeaderboardCard({ id }: { id: string }) {
  const c = useColors();
  const { t } = useI18n();
  const q = useGetChallengeRanking(id, {
    query: { enabled: !!id, queryKey: getGetChallengeRankingQueryKey(id) },
  });
  if (q.isLoading) return <Card><ListSkeleton rows={4} /></Card>;
  if (q.isError)
    return (
      <ErrorState
        message={t("common.loadError")}
        retryLabel={t("common.tryAgain")}
        onRetry={() => void q.refetch()}
      />
    );
  const entries = q.data?.entries ?? [];
  if (entries.length === 0)
    return (
      <Card>
        <EmptyState
          title={t("rankings.empty")}
          icon={<Feather name="bar-chart-2" size={26} color={c.mutedForeground} />}
        />
      </Card>
    );
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
  const c = useColors();
  const { t } = useI18n();
  const q = useGetChallengeParticipants(id, {
    query: { enabled: !!id, queryKey: getGetChallengeParticipantsQueryKey(id) },
  });
  if (q.isLoading) return <Card><ListSkeleton rows={4} /></Card>;
  if (q.isError)
    return (
      <ErrorState
        message={t("common.loadError")}
        retryLabel={t("common.tryAgain")}
        onRetry={() => void q.refetch()}
      />
    );
  const list = q.data ?? [];
  if (list.length === 0)
    return (
      <Card>
        <EmptyState
          title={t("detail.participants.empty")}
          icon={<Feather name="users" size={26} color={c.mutedForeground} />}
        />
      </Card>
    );
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
  const report = useReportChallengeMessage();
  const block = useBlockUser();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const data = q.data;
  const canPost = data?.canPost ?? false;

  const openMessageActions = (m: ChallengeMessage) => {
    const name = m.author.displayName ?? t("chat.thisUser");
    Alert.alert(t("chat.messageActions"), name, [
      { text: t("chat.reportMessage"), onPress: () => confirmReport(m) },
      {
        text: t("chat.blockUser"),
        style: "destructive",
        onPress: () => confirmBlock(m, name),
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const confirmReport = (m: ChallengeMessage) => {
    Alert.alert(t("chat.reportConfirmTitle"), t("chat.reportConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.reportSubmit"),
        onPress: () =>
          report.mutate(
            { id, messageId: m.id },
            {
              onSuccess: () => Alert.alert(t("chat.reported")),
              onError: () => Alert.alert(t("chat.reportError")),
            },
          ),
      },
    ]);
  };

  const confirmBlock = (m: ChallengeMessage, name: string) => {
    Alert.alert(
      t("chat.blockConfirmTitle").replace("{name}", name),
      t("chat.blockConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("chat.blockSubmit"),
          style: "destructive",
          onPress: () =>
            block.mutate(
              { id: m.author.id },
              {
                onSuccess: () => {
                  void queryClient.invalidateQueries({
                    queryKey: getGetChallengeMessagesQueryKey(id),
                  });
                  Alert.alert(t("chat.blocked"));
                },
                onError: () => Alert.alert(t("chat.blockError")),
              },
            ),
        },
      ],
    );
  };

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

  if (q.isLoading) return <Card><ListSkeleton rows={3} /></Card>;
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
        <EmptyState
          title={t("chat.empty")}
          icon={<Feather name="message-circle" size={26} color={c.mutedForeground} />}
        />
      ) : (
        <View style={{ gap: 14 }}>
          {messages.map((m) => (
            <ChatBubble
              key={m.id}
              m={m}
              lang={lang}
              dir={dir}
              onActions={openMessageActions}
            />
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
  onActions,
}: {
  m: ChallengeMessage;
  lang: "ar" | "en";
  dir: "rtl" | "ltr";
  onActions?: (m: ChallengeMessage) => void;
}) {
  const c = useColors();
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
      {!m.isOwnMessage && onActions ? (
        <Pressable
          onPress={() => onActions(m)}
          hitSlop={8}
          style={{ padding: 4 }}
          accessibilityLabel={t("chat.messageActions")}
        >
          <Feather name="more-vertical" size={18} color={c.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ChallengeDetailSkeleton() {
  return (
    <View style={{ gap: 22 }}>
      <Card>
        <Skeleton width="70%" height={22} />
        <View style={{ marginTop: 12, gap: 8 }}>
          <Skeleton width="100%" height={12} />
          <Skeleton width="50%" height={12} />
        </View>
      </Card>
      <View style={{ gap: 12 }}>
        <Skeleton width={150} height={16} />
        <Card>
          <ListSkeleton rows={4} />
        </Card>
      </View>
    </View>
  );
}
