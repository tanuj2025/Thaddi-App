import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getGetSuggestedDisplayNamesQueryKey,
  useGetSuggestedDisplayNames,
  useUpdateProfile,
  type CurrentUser,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useState } from "react";
import { Platform, Pressable, View } from "react-native";

import {
  Button,
  Card,
  LangToggle,
  Reveal,
  Screen,
  ScreenHeader,
  TextField,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { nextActivationRoute } from "@/lib/activation";
import { useI18n } from "@/lib/i18n";

const WEB_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

export default function OnboardingScreen() {
  const c = useColors();
  const { t, dir } = useI18n();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  const [realName, setRealName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [terms, setTerms] = useState(false);

  const suggest = useGetSuggestedDisplayNames({
    query: { enabled: false, queryKey: getGetSuggestedDisplayNamesQueryKey() },
  });
  const update = useUpdateProfile({
    mutation: {
      onSuccess: (updated: CurrentUser) => {
        queryClient.setQueryData(getGetMeQueryKey(), updated);
        router.replace(nextActivationRoute(updated));
      },
    },
  });

  const rowDir = dir === "rtl" ? "row-reverse" : "row";
  const canSubmit =
    realName.trim().length > 0 &&
    displayName.trim().length >= 2 &&
    username.trim().length >= 3 &&
    terms;

  const onSuggest = async () => {
    const res = await suggest.refetch();
    const first = res.data?.suggestions?.[0];
    if (first) setDisplayName(first);
  };

  const onSubmit = () => {
    if (!canSubmit) return;
    update.mutate({
      data: {
        realName: realName.trim(),
        displayName: displayName.trim(),
        username: username.trim().replace(/^@/, ""),
        termsAccepted: true,
      },
    });
  };

  const openLink = (path: string) => {
    if (WEB_BASE) void WebBrowser.openBrowserAsync(`${WEB_BASE}${path}`);
  };

  return (
    <Screen scroll>
      <ScreenHeader
        title={t("onboarding.title")}
        right={<LangToggle />}
      />

      <Reveal>
      <Card>
        <TextField
          label={t("onboarding.realName")}
          value={realName}
          onChangeText={setRealName}
          placeholder={t("onboarding.realNamePlaceholder")}
          autoCapitalize="words"
        />

        <View>
          <View
            style={{
              flexDirection: rowDir,
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <ThemedText size={13} muted>
              {t("onboarding.displayName")}
            </ThemedText>
            <Pressable
              onPress={() => void onSuggest()}
              style={{ flexDirection: rowDir, alignItems: "center", gap: 4 }}
            >
              <Feather name="refresh-cw" size={12} color={c.thaddiGold} />
              <ThemedText size={12} gold>
                {t("onboarding.suggest")}
              </ThemedText>
            </Pressable>
          </View>
          <TextField
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t("onboarding.displayNamePlaceholder")}
          />
        </View>

        <TextField
          label={t("onboarding.username")}
          value={username}
          onChangeText={setUsername}
          placeholder={t("onboarding.usernamePlaceholder")}
          autoCapitalize="none"
          error={username.length > 0 && username.trim().length < 3 ? t("onboarding.usernameRule") : undefined}
        />
        <ThemedText size={12} muted style={{ marginTop: -6, marginBottom: 4 }}>
          {t("onboarding.usernameRule")}
        </ThemedText>
      </Card>
      </Reveal>

      {/* consent */}
      <Pressable
        onPress={() => setTerms((v) => !v)}
        style={{ flexDirection: rowDir, alignItems: "flex-start", gap: 10, marginTop: 18 }}
      >
        <Feather
          name={terms ? "check-square" : "square"}
          size={22}
          color={terms ? c.primary : c.mutedForeground}
        />
        <ThemedText size={13} muted style={{ flex: 1 }}>
          {t("onboarding.consent.pre")}{" "}
          <ThemedText size={13} gold onPress={() => openLink("/terms")}>
            {t("onboarding.consent.terms")}
          </ThemedText>{" "}
          {t("onboarding.consent.and")}{" "}
          <ThemedText size={13} gold onPress={() => openLink("/privacy")}>
            {t("onboarding.consent.privacy")}
          </ThemedText>
        </ThemedText>
      </Pressable>

      {update.isError ? (
        <ThemedText size={13} color={c.destructive} style={{ marginTop: 12 }}>
          {t("onboarding.saveError")}
        </ThemedText>
      ) : null}

      <View style={{ marginTop: 22, gap: 12 }}>
        <Button
          label={t("onboarding.submit")}
          onPress={onSubmit}
          loading={update.isPending}
          disabled={!canSubmit}
        />
        <Button
          label={t("auth.signOut")}
          variant="ghost"
          onPress={() => void signOut()}
        />
      </View>
    </Screen>
  );
}
