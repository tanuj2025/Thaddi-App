import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  useGetMe,
  useGetTeams,
  useUpdateFavoriteTeam,
  type CurrentUser,
  type GetTeams200TeamsItem,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import {
  Button,
  EmptyState,
  LangToggle,
  ListSkeleton,
  Pill,
  PressableScale,
  Screen,
  ScreenHeader,
  TeamFlag,
  TextField,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { nextActivationRoute } from "@/lib/activation";
import { useI18n } from "@/lib/i18n";

export default function PickTeamScreen() {
  const c = useColors();
  const { t, lang, dir } = useI18n();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ change?: string }>();
  const isChange = params.change === "1";

  const { data: me } = useGetMe();
  const teamsQ = useGetTeams();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  // In change mode, pre-select the current favourite once it resolves.
  useEffect(() => {
    if (isChange && me?.favoriteTeam?.id) setSelected(me.favoriteTeam.id);
  }, [isChange, me?.favoriteTeam?.id]);

  const save = useUpdateFavoriteTeam({
    mutation: {
      onSuccess: (updated: CurrentUser) => {
        queryClient.setQueryData(getGetMeQueryKey(), updated);
        if (isChange) router.back();
        // Offer the optional favourite-club step right after the national team,
        // before exiting onboarding. It is skippable and never blocks the gate.
        else if (!updated.favoriteClubSelected) router.replace("/(activation)/pick-club");
        else router.replace(nextActivationRoute(updated));
      },
    },
  });

  const teams = teamsQ.data?.teams ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((tm) => {
      return (
        tm.nameEn.toLowerCase().includes(q) ||
        tm.nameAr.toLowerCase().includes(q) ||
        (tm.code ?? "").toLowerCase().includes(q)
      );
    });
  }, [teams, query]);

  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const currentId = me?.favoriteTeam?.id ?? null;

  const renderItem = ({ item }: { item: GetTeams200TeamsItem }) => {
    const isSel = selected === item.id;
    const name = lang === "ar" ? item.nameAr : item.nameEn;
    return (
      <PressableScale
        onPress={() => setSelected(item.id)}
        testID={`team-option-${item.id}`}
        style={{
          flex: 1,
          minHeight: 116,
          borderRadius: 16,
          borderWidth: isSel ? 2 : 1,
          borderColor: isSel ? c.primary : c.border,
          backgroundColor: isSel ? "rgba(39,176,112,0.12)" : c.card,
          paddingVertical: 14,
          paddingHorizontal: 10,
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          shadowColor: isSel ? c.primary : "#000",
          shadowOpacity: isSel ? 0.15 : 0.04,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: isSel ? 3 : 1,
        }}
      >
        {/* Check/checkbox indicator on the right side of the card */}
        <View
          style={{
            position: "absolute",
            top: 8,
            right: dir === "rtl" ? undefined : 8,
            left: dir === "rtl" ? 8 : undefined,
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 1.5,
            borderColor: isSel ? c.primary : c.border,
            backgroundColor: isSel ? c.primary : "transparent",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
          }}
        >
          {isSel && <Feather name="check" size={12} color="#FFFFFF" />}
        </View>

        {item.id === currentId ? (
          <View
            style={{
              position: "absolute",
              top: 8,
              left: dir === "rtl" ? undefined : 8,
              right: dir === "rtl" ? 8 : undefined,
              zIndex: 5,
            }}
          >
            <Pill tone="gold" label={t("pickTeam.current")} />
          </View>
        ) : null}

        {/* Team logo centered horizontally at the top */}
        <TeamFlag uri={item.flagUrl} size={42} />

        {/* Team name directly below the logo and centered */}
        <ThemedText
          weight="bold"
          size={13}
          center
          numberOfLines={2}
          style={{ marginTop: 8, textAlign: "center", minHeight: 34 }}
        >
          {name}
        </ThemedText>
      </PressableScale>
    );
  };

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title={isChange ? t("pickTeam.changeTitle") : t("pickTeam.title")}
        subtitle={isChange ? t("pickTeam.changeSubtitle") : t("pickTeam.subtitle")}
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
        placeholder={t("pickTeam.search")}
        autoCapitalize="none"
      />

      <View style={{ flex: 1 }}>
        {teamsQ.isLoading ? (
          <ListSkeleton rows={7} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t("pickTeam.noResults")}
            icon={<Feather name="search" size={26} color={c.mutedForeground} />}
          />
        ) : (
          <FlatList
            key="team-grid-2col"
            data={filtered}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={{ gap: 10 }}
            contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>

      <View style={{ paddingTop: 8 }}>
        <Button
          label={isChange ? t("pickTeam.save") : t("pickTeam.save")}
          onPress={() => selected && save.mutate({ data: { teamId: selected } })}
          loading={save.isPending}
          disabled={!selected}
        />
      </View>
    </Screen>
  );
}
