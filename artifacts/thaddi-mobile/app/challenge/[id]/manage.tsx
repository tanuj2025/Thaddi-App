import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetChallengeJoinRequestsQueryKey,
  getGetChallengeParticipantsQueryKey,
  getGetChallengeQueryKey,
  getGetMyChallengesQueryKey,
  useDeleteChallenge,
  useDemoteAssistant,
  useGetChallenge,
  useGetChallengeJoinRequests,
  useGetChallengeParticipants,
  usePromoteAssistant,
  useRegenerateInvite,
  useRemoveParticipant,
  useResolveJoinRequest,
  useUpdateChallenge,
  UpdateChallengePredictionVisibility,
  UpdateChallengeVisibility,
  type Challenge,
  type ChallengePrizeInput,
  type JoinRequest,
  type Participant,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Alert, Image, Linking, Pressable, Share, View } from "react-native";

import { PlayerLink } from "@/components/social";
import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Pill,
  Screen,
  Skeleton,
  TextField,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

export default function ChallengeManageScreen() {
  const c = useColors();
  const { t, dir } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const cid = id ?? "";

  const q = useGetChallenge(cid, {
    query: { enabled: !!cid, queryKey: getGetChallengeQueryKey(cid) },
  });
  const ch = q.data;
  const isOwner = !!ch?.isOwner;
  const canManage = !!(ch?.isOwner || ch?.isAssistant);

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
        <ThemedText
          weight="bold"
          size={16}
          numberOfLines={1}
          style={{ marginHorizontal: 6, flex: 1 }}
        >
          {t("detail.settings")}
        </ThemedText>
      </View>

      {q.isLoading ? (
        <Card><ListSkeleton rows={5} /></Card>
      ) : q.isError || !ch ? (
        <ErrorState
          message={t("common.loadError")}
          retryLabel={t("common.tryAgain")}
          onRetry={() => void q.refetch()}
        />
      ) : !canManage ? (
        <ErrorState
          message={t("manage.notAllowed")}
          retryLabel={t("common.back")}
          onRetry={() => router.back()}
        />
      ) : (
        <>
          {isOwner ? <EditSection ch={ch} /> : null}
          {isOwner ? <JoinRequestsSection id={cid} /> : null}
          <ParticipantsSection id={cid} isOwner={isOwner} />
          <InviteSection ch={ch} isOwner={isOwner} />
          {isOwner ? <DeleteSection ch={ch} /> : null}
          <View style={{ height: 28 }} />
        </>
      )}
    </Screen>
  );
}

function SectionTitle({ icon, title }: { icon: keyof typeof Feather.glyphMap; title: string }) {
  const c = useColors();
  const { dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View
      style={{
        flexDirection: rowDir,
        alignItems: "center",
        gap: 8,
        marginTop: 24,
        marginBottom: 12,
      }}
    >
      <Feather name={icon} size={16} color={c.thaddiGold} />
      <ThemedText weight="bold" size={16}>
        {title}
      </ThemedText>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit (owner only)                                                          */
/* -------------------------------------------------------------------------- */

function Selector<T extends string>({
  label,
  value,
  options,
  getLabel,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  getLabel: (opt: T) => string;
  onChange: (opt: T) => void;
}) {
  const c = useColors();
  const { dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  return (
    <View style={{ marginBottom: 14 }}>
      <ThemedText size={13} muted style={{ marginBottom: 6 }}>
        {label}
      </ThemedText>
      <View style={{ flexDirection: rowDir, flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={({ pressed }) => ({
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: selected ? c.primary : c.border,
                backgroundColor: selected ? c.primary : "transparent",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <ThemedText
                size={13}
                weight="semibold"
                color={selected ? c.primaryForeground : c.foreground}
              >
                {getLabel(opt)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function EditSection({ ch }: { ch: Challenge }) {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const qc = useQueryClient();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const [name, setName] = useState(ch.name);
  const [description, setDescription] = useState(ch.description ?? "");
  const [visibility, setVisibility] = useState<UpdateChallengeVisibility>(
    ch.visibility as UpdateChallengeVisibility,
  );
  const [predictionVisibility, setPredictionVisibility] =
    useState<UpdateChallengePredictionVisibility>(
      ch.predictionVisibility as UpdateChallengePredictionVisibility,
    );
  const [prizes, setPrizes] = useState<ChallengePrizeInput[]>(
    (ch.prizes ?? []).map((p) => ({
      place: p.place,
      titleAr: p.titleAr ?? "",
      titleEn: p.titleEn ?? "",
      value: p.value ?? "",
    })),
  );

  const update = useUpdateChallenge();

  const addPrize = () =>
    setPrizes((prev) => [...prev, { place: prev.length + 1, titleAr: "", titleEn: "", value: "" }]);
  const removePrize = (idx: number) =>
    setPrizes((prev) =>
      prev.filter((_, i) => i !== idx).map((pr, i) => ({ ...pr, place: i + 1 })),
    );
  const updatePrize = (idx: number, patch: Partial<ChallengePrizeInput>) =>
    setPrizes((prev) => prev.map((pr, i) => (i === idx ? { ...pr, ...patch } : pr)));

  const save = () => {
    const cleanPrizes: ChallengePrizeInput[] = prizes
      .filter((p) => `${p.titleAr ?? ""}${p.titleEn ?? ""}${p.value ?? ""}`.trim())
      .map((p, i) => ({
        place: i + 1,
        titleAr: p.titleAr?.trim() || undefined,
        titleEn: p.titleEn?.trim() || undefined,
        value: p.value?.trim() || undefined,
        currency: p.value?.trim() ? "SAR" : undefined,
      }));

    update.mutate(
      {
        id: ch.id,
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          visibility,
          predictionVisibility,
          prizes: cleanPrizes,
        },
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetChallengeQueryKey(ch.id) });
          Alert.alert(t("detail.saved"));
        },
        onError: () => Alert.alert(t("detail.saveError")),
      },
    );
  };

  return (
    <>
      <SectionTitle icon="settings" title={t("detail.settings")} />
      <Card>
        <TextField label={t("create.name")} value={name} onChangeText={setName} />
        <TextField
          label={t("create.description")}
          value={description}
          onChangeText={setDescription}
          multiline
        />
        <Selector
          label={t("create.visibility")}
          value={visibility}
          options={Object.values(UpdateChallengeVisibility)}
          getLabel={(opt) => t(`visibility.${opt}`)}
          onChange={setVisibility}
        />
        <Selector
          label={t("create.predictionVisibility")}
          value={predictionVisibility}
          options={Object.values(UpdateChallengePredictionVisibility)}
          getLabel={(opt) => t(`pv.${opt}`)}
          onChange={setPredictionVisibility}
        />

        <Divider />

        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Feather name="award" size={15} color={c.thaddiGold} />
          <ThemedText weight="semibold" size={14}>
            {t("create.prizes")}
          </ThemedText>
        </View>

        {prizes.map((p, idx) => (
          <View
            key={idx}
            style={{
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: c.radius,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <View
              style={{
                flexDirection: rowDir,
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <Pill tone="gold" label={`${t("create.place")} ${formatNum(idx + 1)}`} />
              <Pressable onPress={() => removePrize(idx)} hitSlop={8} style={{ padding: 4 }}>
                <Feather name="trash-2" size={18} color={c.destructive} />
              </Pressable>
            </View>
            <TextField
              placeholder={t("create.prizeTitleAr")}
              value={p.titleAr ?? ""}
              onChangeText={(v) => updatePrize(idx, { titleAr: v })}
            />
            <TextField
              placeholder={t("create.prizeTitleEn")}
              value={p.titleEn ?? ""}
              onChangeText={(v) => updatePrize(idx, { titleEn: v })}
            />
            <TextField
              placeholder={t("create.prizeValue")}
              value={p.value ?? ""}
              onChangeText={(v) => updatePrize(idx, { value: v })}
              keyboardType="numeric"
            />
          </View>
        ))}

        <Button
          label={t("create.addPrize")}
          variant="outline"
          onPress={addPrize}
          icon={<Feather name="plus" size={16} color={c.foreground} />}
        />

        <View style={{ height: 14 }} />
        <Button
          label={t("detail.save")}
          onPress={save}
          loading={update.isPending}
          icon={<Feather name="check" size={16} color={c.primaryForeground} />}
        />
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Join requests (owner only)                                                 */
/* -------------------------------------------------------------------------- */

function JoinRequestsSection({ id }: { id: string }) {
  const c = useColors();
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useGetChallengeJoinRequests(id, {
    query: {
      enabled: !!id,
      queryKey: getGetChallengeJoinRequestsQueryKey(id),
      refetchInterval: 30_000,
    },
  });
  const resolve = useResolveJoinRequest();

  const act = (requestId: string, action: "approve" | "decline") => {
    resolve.mutate(
      { id, requestId, data: { action } },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getGetChallengeJoinRequestsQueryKey(id) });
          if (action === "approve") {
            void qc.invalidateQueries({ queryKey: getGetChallengeParticipantsQueryKey(id) });
            void qc.invalidateQueries({ queryKey: getGetChallengeQueryKey(id) });
          }
        },
        onError: () => Alert.alert(t("common.loadError")),
      },
    );
  };

  const requests = q.data?.requests ?? [];

  return (
    <>
      <SectionTitle icon="user-plus" title={t("detail.joinRequests")} />
      <Card>
        {q.isLoading ? (
          <ListSkeleton rows={3} />
        ) : requests.length === 0 ? (
          <EmptyState
            title={t("detail.joinRequestsEmpty")}
            icon={<Feather name="user-plus" size={26} color={c.mutedForeground} />}
          />
        ) : (
          requests.map((req, i) => (
            <View key={req.id}>
              {i > 0 ? <Divider /> : null}
              <JoinRequestRow
                req={req}
                pending={resolve.isPending}
                onApprove={() => act(req.id, "approve")}
                onDecline={() => act(req.id, "decline")}
              />
            </View>
          ))
        )}
      </Card>
    </>
  );
}

function JoinRequestRow({
  req,
  pending,
  onApprove,
  onDecline,
}: {
  req: JoinRequest;
  pending: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const c = useColors();
  const { t, dir } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const name = req.displayName ?? "—";
  return (
    <View style={{ gap: 10 }}>
      <PlayerLink
        userId={req.requesterId}
        style={{ flexDirection: rowDir, alignItems: "center", gap: 12 }}
      >
        <Avatar uri={req.avatarUrl} name={name} size={36} />
        <View style={{ flex: 1 }}>
          <ThemedText size={14} weight="semibold" numberOfLines={1}>
            {name}
          </ThemedText>
          {req.username ? (
            <ThemedText muted size={12} numberOfLines={1}>
              @{req.username}
            </ThemedText>
          ) : null}
          {req.message ? (
            <ThemedText muted size={12} numberOfLines={2} style={{ marginTop: 2 }}>
              {req.message}
            </ThemedText>
          ) : null}
        </View>
      </PlayerLink>
      <View style={{ flexDirection: rowDir, gap: 8 }}>
        <Button
          label={t("detail.joinRequestApprove")}
          variant="secondary"
          fullWidth={false}
          disabled={pending}
          onPress={onApprove}
          icon={<Feather name="check" size={16} color={c.secondaryForeground} />}
        />
        <Button
          label={t("detail.joinRequestDecline")}
          variant="outline"
          fullWidth={false}
          disabled={pending}
          onPress={onDecline}
          icon={<Feather name="x" size={16} color={c.foreground} />}
        />
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Participants                                                                */
/* -------------------------------------------------------------------------- */

function ParticipantsSection({ id, isOwner }: { id: string; isOwner: boolean }) {
  const c = useColors();
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useGetChallengeParticipants(id, {
    query: { enabled: !!id, queryKey: getGetChallengeParticipantsQueryKey(id) },
  });
  const remove = useRemoveParticipant();
  const promote = usePromoteAssistant();
  const demote = useDemoteAssistant();

  const invalidateMembers = () => {
    void qc.invalidateQueries({ queryKey: getGetChallengeParticipantsQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetChallengeQueryKey(id) });
  };

  const doRemove = (p: Participant) => {
    const name = p.displayName ?? "—";
    Alert.alert(t("detail.remove"), `${name}\n${t("detail.removeImpact")}`, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("detail.remove"),
        style: "destructive",
        onPress: () =>
          remove.mutate(
            { id, data: { userId: p.userId } },
            {
              onSuccess: invalidateMembers,
              onError: () => Alert.alert(t("detail.saveError")),
            },
          ),
      },
    ]);
  };

  const doPromote = (p: Participant) => {
    Alert.alert(t("detail.promoteConfirmTitle"), t("detail.promoteConfirmDesc"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("detail.promote"),
        onPress: () =>
          promote.mutate(
            { id, data: { userId: p.userId } },
            {
              onSuccess: invalidateMembers,
              onError: () => Alert.alert(t("detail.saveError")),
            },
          ),
      },
    ]);
  };

  const doDemote = (p: Participant) => {
    Alert.alert(t("detail.demoteConfirmTitle"), t("detail.demoteConfirmDesc"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("detail.demote"),
        style: "destructive",
        onPress: () =>
          demote.mutate(
            { id, data: { userId: p.userId } },
            {
              onSuccess: invalidateMembers,
              onError: () => Alert.alert(t("detail.saveError")),
            },
          ),
      },
    ]);
  };

  const list = q.data ?? [];
  const pending = remove.isPending || promote.isPending || demote.isPending;

  return (
    <>
      <SectionTitle icon="users" title={t("detail.participants")} />
      <Card>
        {q.isLoading ? (
          <ListSkeleton rows={4} />
        ) : list.length === 0 ? (
          <EmptyState
            title={t("detail.participants.empty")}
            icon={<Feather name="users" size={26} color={c.mutedForeground} />}
          />
        ) : (
          list.map((p, i) => (
            <View key={p.userId}>
              {i > 0 ? <Divider /> : null}
              <ParticipantRow
                p={p}
                isOwner={isOwner}
                pending={pending}
                onRemove={() => doRemove(p)}
                onPromote={() => doPromote(p)}
                onDemote={() => doDemote(p)}
              />
            </View>
          ))
        )}
      </Card>
    </>
  );
}

function ParticipantRow({
  p,
  isOwner,
  pending,
  onRemove,
  onPromote,
  onDemote,
}: {
  p: Participant;
  isOwner: boolean;
  pending: boolean;
  onRemove: () => void;
  onPromote: () => void;
  onDemote: () => void;
}) {
  const c = useColors();
  const { t, dir, formatNum } = useI18n();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const name = p.displayName ?? "—";

  // The owner cannot be removed/demoted/promoted. Assistants must be demoted
  // before they can be removed (matches the server's member-management rules).
  const canRemove = !p.isOwner && !p.isAssistant;
  const showPromote = isOwner && !p.isOwner && !p.isAssistant;
  const showDemote = isOwner && !p.isOwner && p.isAssistant;

  return (
    <View style={{ gap: 10 }}>
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

      {showPromote || showDemote || canRemove ? (
        <View style={{ flexDirection: rowDir, flexWrap: "wrap", gap: 8 }}>
          {showPromote ? (
            <Button
              label={t("detail.promote")}
              variant="outline"
              fullWidth={false}
              disabled={pending}
              onPress={onPromote}
              icon={<Feather name="shield" size={15} color={c.foreground} />}
            />
          ) : null}
          {showDemote ? (
            <Button
              label={t("detail.demote")}
              variant="outline"
              fullWidth={false}
              disabled={pending}
              onPress={onDemote}
              icon={<Feather name="shield-off" size={15} color={c.foreground} />}
            />
          ) : null}
          {canRemove ? (
            <Button
              label={t("detail.remove")}
              variant="outline"
              fullWidth={false}
              disabled={pending}
              onPress={onRemove}
              icon={<Feather name="user-x" size={15} color={c.destructive} />}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Invite                                                                      */
/* -------------------------------------------------------------------------- */

function InviteSection({ ch, isOwner }: { ch: Challenge; isOwner: boolean }) {
  const c = useColors();
  const { t, dir, lang } = useI18n();
  const qc = useQueryClient();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const regenerate = useRegenerateInvite();
  const [qrOpen, setQrOpen] = useState(false);

  const code = ch.inviteCode ?? "";
  if (!code) return null;

  const link = ch.inviteLink ?? null;

  // Always use an absolute production URL so WhatsApp renders a tappable link
  // and the QR encodes a scannable address.
  const canonicalLink =
    link && link.startsWith("https://")
      ? link
      : `https://thaddi.app/join/${code}`;

  const buildShareMessage = () =>
    lang === "ar"
      ? `🔥 ${t("detail.shareMessage")}\nاسم التحدي: ${ch.name}\nرمز الانضمام: ${code}\n🔗 اضغط هنا للانضمام مباشرة: ${canonicalLink}`
      : `🔥 ${t("detail.shareMessage")}\nChallenge: ${ch.name}\nCode: ${code}\n🔗 Tap here to join: ${canonicalLink}`;

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

  const confirmRegenerate = () => {
    Alert.alert(
      t("detail.regenerateConfirmTitle"),
      t("detail.regenerateConfirmBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("detail.regenerateConfirmCta"),
          style: "destructive",
          onPress: () =>
            regenerate.mutate(
              { id: ch.id },
              {
                onSuccess: () => {
                  void qc.invalidateQueries({ queryKey: getGetChallengeQueryKey(ch.id) });
                  Alert.alert(t("detail.regenerated"));
                },
                onError: () => Alert.alert(t("detail.saveError")),
              },
            ),
        },
      ],
    );
  };

  return (
    <>
      <SectionTitle icon="share-2" title={t("detail.invite")} />
      <Card>
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
        <View style={{ flexDirection: rowDir, gap: 8, marginBottom: isOwner ? 10 : 0 }}>
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
        {isOwner ? (
          <Button
            label={t("detail.regenerate")}
            variant="outline"
            loading={regenerate.isPending}
            onPress={confirmRegenerate}
            icon={<Feather name="refresh-cw" size={16} color={c.foreground} />}
          />
        ) : null}
      </Card>

      <BottomSheet visible={qrOpen} onClose={() => setQrOpen(false)} title={t("detail.qrTitle")}>
        <View style={{ alignItems: "center", padding: 20, gap: 14 }}>
          <ThemedText weight="bold" size={17} center>
            {ch.name}
          </ThemedText>
          <ThemedText center muted size={13}>
            {t("detail.qrDesc")}
          </ThemedText>
          <View
            style={{
              padding: 16,
              backgroundColor: "#ffffff",
              borderRadius: 20,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 10,
              elevation: 4,
            }}
          >
            <Image
              source={{
                uri: `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(canonicalLink)}&margin=8`,
              }}
              style={{ width: 200, height: 200 }}
              resizeMode="contain"
            />
          </View>
          <View
            style={{
              backgroundColor: "rgba(232,180,48,0.12)",
              paddingHorizontal: 20,
              paddingVertical: 8,
              borderRadius: 12,
              alignItems: "center",
              marginTop: 2,
            }}
          >
            <ThemedText weight="extrabold" size={20} gold style={{ letterSpacing: 3 }}>
              {code}
            </ThemedText>
          </View>
          <View style={{ alignSelf: "stretch", marginTop: 8 }}>
            <Button
              label={t("detail.shareWhatsApp")}
              onPress={() => {
                setQrOpen(false);
                void onShareWhatsApp();
              }}
              icon={<Feather name="share-2" size={16} color={c.primaryForeground} />}
            />
          </View>
        </View>
      </BottomSheet>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete (owner only)                                                        */
/* -------------------------------------------------------------------------- */

function DeleteSection({ ch }: { ch: Challenge }) {
  const c = useColors();
  const { t } = useI18n();
  const qc = useQueryClient();
  const del = useDeleteChallenge();

  const confirmDelete = () => {
    Alert.alert(t("detail.deleteConfirmTitle"), t("detail.deleteConfirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("detail.deleteChallenge"),
        style: "destructive",
        onPress: () =>
          del.mutate(
            { id: ch.id },
            {
              onSuccess: () => {
                void qc.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
                router.replace("/(tabs)/challenges");
              },
              onError: () => Alert.alert(t("detail.deleteError")),
            },
          ),
      },
    ]);
  };

  return (
    <>
      <SectionTitle icon="alert-triangle" title={t("detail.deleteChallenge")} />
      <Card style={{ borderColor: "rgba(220,40,40,0.35)" }}>
        <ThemedText muted size={13} style={{ marginBottom: 12 }}>
          {t("detail.deleteHint")}
        </ThemedText>
        <Button
          label={t("detail.deleteChallenge")}
          variant="outline"
          loading={del.isPending}
          onPress={confirmDelete}
          icon={<Feather name="trash-2" size={16} color={c.destructive} />}
        />
      </Card>
    </>
  );
}
