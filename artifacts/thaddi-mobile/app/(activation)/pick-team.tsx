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
  LoadingState,
  Pill,
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
      <Pressable
        onPress={() => setSelected(item.id)}
        style={{
          flexDirection: rowDir,
          alignItems: "center",
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          marginBottom: 8,
          borderRadius: c.radius,
          borderWidth: 1,
          borderColor: isSel ? c.primary : c.border,
          backgroundColor: isSel ? "rgba(39,176,112,0.10)" : c.card,
        }}
      >
        <TeamFlag uri={item.flagUrl} size={30} />
        <ThemedText weight="semibold" size={15} style={{ flex: 1 }}>
          {name}
        </ThemedText>
        {item.id === currentId ? <Pill tone="gold" label={t("pickTeam.current")} /> : null}
        {isSel ? <Feather name="check-circle" size={20} color={c.primary} /> : null}
      </Pressable>
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
          <LoadingState />
        ) : filtered.length === 0 ? (
          <EmptyState title={t("pickTeam.noResults")} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 12 }}
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
