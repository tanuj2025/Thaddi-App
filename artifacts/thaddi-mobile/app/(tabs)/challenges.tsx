import React from "react";

import { EmptyState, Screen, ThemedText } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function ChallengesScreen() {
  const { t } = useI18n();
  return (
    <Screen>
      <ThemedText weight="extrabold" size={26} style={{ marginBottom: 16 }}>
        {t("nav.challenges")}
      </ThemedText>
      <EmptyState title={t("nav.challenges")} subtitle={t("app.tagline")} />
    </Screen>
  );
}
