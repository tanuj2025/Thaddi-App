import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  useGetClubs,
  useGetMe,
  useUpdateFavoriteClub,
  type ClubRef,
  type CurrentUser,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, SectionList, View } from "react-native";

import {
  EmptyState,
  LangToggle,
  ListSkeleton,
  Pill,
  PressableScale,
  Screen,
  ScreenHeader,
  TextField,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

function ClubCrest({ uri, size }: { uri?: string | null; size: number }) {
  const c = useColors();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, resizeMode: "contain" }}
      />
    );
  }
  return <Feather name="shield" size={size} color={c.mutedForeground} />;
}

/**
 * Optional favourite-club picker. Additive to the national favourite team and
 * never part of activation: this screen is reachable from the post-team chain and
 * the profile, but is always skippable and never blocks the gate. One tap saves
 * (mirrors the web pick-club one-tap UX) instead of a select-then-confirm step.
 */
export default function PickClubScreen() {
  const c = useColors();
  const { t, lang, dir } = useI18n();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ change?: string }>();

  const { data: me } = useGetMe();
  const clubsQ = useGetClubs();
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  // When the user already has a club, this screen acts as a "change club" flow:
  // it returns to the previous screen afterwards instead of advancing onboarding.
  const isChange = params.change === "1" || Boolean(me?.favoriteClub);
  const currentClubId = me?.favoriteClub?.id ?? null;

  const save = useUpdateFavoriteClub({
    mutation: {
      onSuccess: (updated: CurrentUser) => {
        // Seed the /me cache so any club-aware UI updates without a refetch.
        queryClient.setQueryData(getGetMeQueryKey(), updated);
        if (isChange) router.back();
        else router.replace("/(tabs)");
      },
      onError: () => setPendingId(null),
    },
  });

  const groups = clubsQ.data?.groups ?? [];
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        title: lang === "ar" ? g.nameAr : g.nameEn,
        key: `${g.competitionSlug ?? g.nameEn}-${g.displayOrder}`,
        data: q
          ? g.clubs.filter(
              (club) =>
                club.nameEn.toLowerCase().includes(q) || club.nameAr.includes(query.trim()),
            )
          : g.clubs,
      }))
      .filter((g) => g.data.length > 0);
  }, [groups, query, lang]);

  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const handleTap = (clubId: string) => {
    if (save.isPending) return;
    setPendingId(clubId);
    save.mutate({ data: { teamId: clubId } });
  };

  const exit = () => {
    if (isChange) router.back();
    else router.replace("/(tabs)");
  };

  const renderItem = ({ item }: { item: ClubRef }) => {
    const name = lang === "ar" ? item.nameAr : item.nameEn;
    const isSaving = item.id === pendingId && save.isPending;
    const isCurrent = item.id === currentClubId;
    return (
      <PressableScale
        onPress={() => handleTap(item.id)}
        disabled={save.isPending}
        style={{
          flexDirection: rowDir,
          alignItems: "center",
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          marginBottom: 8,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: isCurrent ? c.secondary : c.border,
          backgroundColor: isCurrent ? c.secondary + "1A" : c.card,
          opacity: save.isPending && !isSaving ? 0.5 : 1,
        }}
      >
        <ClubCrest uri={item.crestUrl} size={30} />
        <ThemedText weight="semibold" size={15} style={{ flex: 1 }} numberOfLines={1}>
          {name}
        </ThemedText>
        {isCurrent ? <Pill tone="gold" label={t("pickClub.current")} /> : null}
        {isSaving ? <ActivityIndicator size="small" color={c.primary} /> : null}
      </PressableScale>
    );
  };

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title={isChange ? t("pickClub.changeTitle") : t("pickClub.title")}
        subtitle={isChange ? t("pickClub.changeSubtitle") : t("pickClub.subtitle")}
        right={<LangToggle />}
        left={
          isChange ? (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Feather
                name={dir === "rtl" ? "chevron-right" : "chevron-left"}
                size={26}
                color={c.foreground}
              />
            </Pressable>
          ) : undefined
        }
      />

      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder={t("pickClub.search")}
        autoCapitalize="none"
      />

      <View style={{ flex: 1 }}>
        {clubsQ.isLoading ? (
          <ListSkeleton rows={7} />
        ) : sections.length === 0 ? (
          <EmptyState
            title={t("pickClub.noResults")}
            icon={<Feather name="search" size={26} color={c.mutedForeground} />}
          />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            renderSectionHeader={({ section }) => (
              <ThemedText
                muted
                weight="bold"
                size={12}
                style={{
                  marginTop: 6,
                  marginBottom: 8,
                  textAlign: dir === "rtl" ? "right" : "left",
                  textTransform: "uppercase",
                }}
              >
                {section.title}
              </ThemedText>
            )}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 12 }}
          />
        )}
      </View>

      <View style={{ paddingTop: 8, alignItems: "center" }}>
        <Pressable onPress={exit} hitSlop={8} disabled={save.isPending}>
          <ThemedText muted size={14}>
            {isChange ? t("common.cancel") : t("pickClub.skip")}
          </ThemedText>
        </Pressable>
      </View>
    </Screen>
  );
}
