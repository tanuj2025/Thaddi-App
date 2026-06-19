import { Feather } from "@expo/vector-icons";
import React from "react";

import { Card, EmptyState } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

/**
 * Shown when the selected competition's current season has no published fixtures
 * yet (comingSoon). Keeps scoped surfaces — matches, rankings, home — from
 * rendering blank or an ended season's matches. Mirrors the web CompetitionComingSoon.
 */
export function CompetitionComingSoon() {
  const c = useColors();
  const { t } = useI18n();
  return (
    <Card>
      <EmptyState
        title={t("competition.comingSoonTitle")}
        subtitle={t("competition.comingSoonDesc")}
        icon={<Feather name="calendar" size={26} color={c.secondary} />}
      />
    </Card>
  );
}
