import React from "react";

import { EmptyState, Screen, ThemedText } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function MatchesScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <ThemedText weight="extrabold" size={26} style={{ marginBottom: 16 }}>
        {t("nav.matches")}
      </ThemedText>
      <EmptyState title={t("nav.matches")} subtitle={t("app.tagline")} />
    </Screen>
  );
}
