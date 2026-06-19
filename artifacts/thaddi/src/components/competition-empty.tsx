import React from 'react';
import { useI18n } from '../lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock } from 'lucide-react';

// Shown when the selected competition's current season has no published fixtures
// yet (comingSoon). Keeps scoped surfaces from rendering blank or an ended
// season's matches. Reused across match-center, schedule, rankings and home.
export function CompetitionComingSoon() {
  const { t } = useI18n();
  return (
    <Card className="card-premium border-border/50 border-dashed" data-testid="competition-coming-soon">
      <CardContent className="py-16 flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-secondary/10 flex items-center justify-center ring-1 ring-secondary/20">
          <CalendarClock className="w-8 h-8 text-secondary" />
        </div>
        <div className="space-y-1.5 max-w-sm">
          <p className="text-lg font-bold text-foreground">{t('competition.comingSoonTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('competition.comingSoonDesc')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
