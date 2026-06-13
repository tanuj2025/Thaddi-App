import { Feather } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React from "react";
import { View } from "react-native";

import { Button, EmptyState, Screen } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

export default function NotFoundScreen() {
  const c = useColors();
  const { t } = useI18n();

  return (
    <>
      <Stack.Screen options={{ title: "404" }} />
      <Screen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            title={t("notFound.message")}
            icon={<Feather name="compass" size={26} color={c.mutedForeground} />}
            action={
              <Button
                label={t("nav.home")}
                onPress={() => router.replace("/")}
                fullWidth={false}
                icon={<Feather name="home" size={16} color={c.primaryForeground} />}
              />
            }
          />
        </View>
      </Screen>
    </>
  );
}
