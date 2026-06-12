import React from "react";

import { EmptyState, Screen, ThemedText } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function RankingsScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <ThemedText weight="extrabold" size={26} style={{ marginBottom: 16 }}>
        {t("nav.rankings")}
      </ThemedText>
      <EmptyState title={t("nav.rankings")} subtitle={t("app.tagline")} />
    </Screen>
  );
}
