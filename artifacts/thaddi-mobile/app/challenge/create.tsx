import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  CreateChallengePredictionVisibility,
  CreateChallengeType,
  CreateChallengeVisibility,
  getGetMyChallengesQueryKey,
  getGetMySubscriptionQueryKey,
  useCreateChallenge,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, View } from "react-native";

import {
  Button,
  Card,
  PressableScale,
  Reveal,
  Screen,
  TextField,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

const TYPES = Object.values(CreateChallengeType);
const VISIBILITIES = Object.values(CreateChallengeVisibility);
const PREDICTION_VISIBILITIES = Object.values(CreateChallengePredictionVisibility);

export default function CreateChallengeScreen() {
  const c = useColors();
  const { t, dir } = useI18n();
  const queryClient = useQueryClient();
  const rowDir = dir === "rtl" ? "row-reverse" : "row";

  const create = useCreateChallenge();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("friends");
  const [visibility, setVisibility] = useState<(typeof VISIBILITIES)[number]>("private");
  const [predictionVisibility, setPredictionVisibility] =
    useState<(typeof PREDICTION_VISIBILITIES)[number]>("reveal_after_kickoff");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t("create.error"));
      return;
    }
    setError(null);
    create.mutate(
      {
        data: {
          name: trimmed,
          description: description.trim() || undefined,
          type,
          visibility,
          scope: "entire_tournament",
          predictionVisibility,
        },
      },
      {
        onSuccess: (created) => {
          void queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
          router.replace(`/challenge/${created.id}`);
        },
        onError: (err) =>
          setError(
            err?.data?.code === "owner_pool_full"
              ? t("create.poolFull")
              : err.data?.error || t("create.error"),
          ),
      },
    );
  };

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
        <ThemedText weight="extrabold" size={22} style={{ marginHorizontal: 6 }}>
          {t("create.title")}
        </ThemedText>
      </View>

      <Reveal>
      <Card>
        <TextField
          label={t("create.name")}
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (error) setError(null);
          }}
          placeholder={t("create.namePlaceholder")}
        />
        <TextField
          label={t("create.description")}
          value={description}
          onChangeText={setDescription}
          placeholder={t("create.descriptionPlaceholder")}
        />
      </Card>
      </Reveal>

      <View style={{ height: 16 }} />

      <Reveal delay={60}>
      <Card>
        <OptionGroup
          label={t("create.type")}
          options={TYPES}
          value={type}
          onChange={setType}
          render={(v) => t(`type.${v}`)}
        />
        <View style={{ height: 16 }} />
        <OptionGroup
          label={t("create.visibility")}
          options={VISIBILITIES}
          value={visibility}
          onChange={setVisibility}
          render={(v) => t(`visibility.${v}`)}
        />
        <View style={{ height: 16 }} />
        <OptionGroup
          label={t("create.predictionVisibility")}
          options={PREDICTION_VISIBILITIES}
          value={predictionVisibility}
          onChange={setPredictionVisibility}
          render={(v) => t(`pv.${v}`)}
        />
      </Card>
      </Reveal>

      <View style={{ height: 14 }} />
      <ThemedText muted size={12} style={{ marginBottom: 16 }}>
        {t("create.scopeHint")}
      </ThemedText>

      {error ? (
        <ThemedText size={13} color={c.destructive} center style={{ marginBottom: 12 }}>
          {error}
        </ThemedText>
      ) : null}

      <Button label={t("create.submit")} onPress={onSubmit} loading={create.isPending} />

      <View style={{ height: 32 }} />
    </Screen>
  );
}

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  const c = useColors();
  const { dir } = useI18n();
  return (
    <View>
      <ThemedText size={13} muted style={{ marginBottom: 8 }}>
        {label}
      </ThemedText>
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {options.map((opt) => {
          const active = opt === value;
          return (
            <PressableScale
              key={opt}
              onPress={() => onChange(opt)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? c.primary : c.border,
                backgroundColor: active ? "rgba(39,176,112,0.16)" : c.card,
              }}
            >
              <ThemedText
                size={13}
                weight={active ? "bold" : "regular"}
                color={active ? c.primary : c.foreground}
              >
                {render(opt)}
              </ThemedText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}
