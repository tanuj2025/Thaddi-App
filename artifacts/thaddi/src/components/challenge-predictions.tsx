import React, { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { useGetChallengePredictions } from '@workspace/api-client-react';
import type {
  ChallengePredictionMatch,
  ChallengePredictionParticipant,
  TeamRef,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Crown, Lock, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { formatNum, outcomeBadgeStyle, type Lang } from '../lib/matchUtils';

function teamCode(team: TeamRef | null | undefined, lang: Lang): string {
  if (!team) return '—';
  return team.code || (lang === 'ar' ? team.nameAr : team.nameEn) || '—';
}

function MatchFlag({ team }: { team: TeamRef | null | undefined }) {
  return team?.flagUrl ? (
    <img
      src={team.flagUrl}
      alt=""
      className="w-5 h-3.5 rounded-sm object-cover ring-1 ring-border shrink-0"
    />
  ) : (
    <div className="w-5 h-3.5 rounded-sm bg-muted shrink-0" />
  );
}

function PredictionChip({
  match,
  participant,
}: {
  match: ChallengePredictionMatch;
  participant: ChallengePredictionParticipant;
}) {
  const { t, lang } = useI18n();
  const entry = participant.predictions.find((e) => e.matchId === match.matchId);

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-background/30 p-2.5">
      <div className="flex items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground" dir="ltr">
        <MatchFlag team={match.homeTeam} />
        <span className="truncate max-w-[2.5rem]">{teamCode(match.homeTeam, lang)}</span>
        <span className="text-muted-foreground/40">-</span>
        <span className="truncate max-w-[2.5rem]">{teamCode(match.awayTeam, lang)}</span>
        <MatchFlag team={match.awayTeam} />
      </div>
      <div className="flex items-center justify-center gap-1.5">
        {entry ? (
          <>
            <span className="tabular-nums font-bold text-sm" dir="ltr">
              {formatNum(entry.homeScore, lang)}-{formatNum(entry.awayScore, lang)}
            </span>
            {entry.outcome !== 'pending' && (
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 h-4 ${outcomeBadgeStyle(entry.outcome)}`}
              >
                {entry.pointsAwarded > 0
                  ? `+${formatNum(entry.pointsAwarded, lang)}`
                  : t('outcome.none')}
              </Badge>
            )}
          </>
        ) : !match.revealed ? (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <Lock className="w-2.5 h-2.5" />
            {t('predictions.hidden')}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/50">{t('predictions.noPick')}</span>
        )}
      </div>
    </div>
  );
}

function ParticipantAccordion({
  participant,
  matches,
  isExpanded,
  onToggle,
}: {
  participant: ChallengePredictionParticipant;
  matches: ChallengePredictionMatch[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { t, lang } = useI18n();

  const sortedMatches = [...matches].sort(
    (a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
  );

  const predictedMatches = sortedMatches.filter((m) =>
    participant.predictions.find((p) => p.matchId === m.matchId),
  );

  const predictedCount = predictedMatches.length;

  return (
    <div
      className="rounded-xl border border-border/50 bg-background/30 overflow-hidden"
      data-testid={`prediction-player-${participant.userId}`}
    >
      <button
        type="button"
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/20 transition-colors text-start"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <Avatar className="w-9 h-9 border border-primary/20 shrink-0">
          <AvatarImage src={participant.avatarUrl || ''} />
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
            {participant.displayName?.charAt(0) || 'U'}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">
              {participant.displayName || '—'}
            </span>
            {participant.isOwner && (
              <Badge
                variant="secondary"
                className="gap-1 bg-secondary/10 text-secondary border border-secondary/20 h-5 px-1.5 shrink-0"
              >
                <Crown className="w-3 h-3" />
                <span className="text-[10px]">{t('detail.ownerBadge')}</span>
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {participant.username && (
              <span className="text-xs text-muted-foreground" dir="ltr">
                @{participant.username}
              </span>
            )}
            <span className="text-xs text-muted-foreground/70">
              <span dir="ltr">{formatNum(predictedCount, lang)} / {formatNum(sortedMatches.length, lang)}</span>
              {' '}{t('predictions.countLabel')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-mono text-primary font-bold bg-primary/10 px-2.5 py-1 rounded-md border border-primary/20">
            {formatNum(participant.points, lang)}{' '}
            <span className="font-sans font-medium text-xs text-primary/70">
              {t('detail.points')}
            </span>
          </span>
          <span className="text-muted-foreground">
            {isExpanded
              ? <ChevronUp className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border/40 p-4">
          {predictedMatches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">{t('predictions.noPredictions')}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {predictedMatches.map((m) => (
                <PredictionChip key={m.matchId} match={m} participant={participant} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChallengePredictions({ challengeId }: { challengeId: string }) {
  const { t } = useI18n();
  const { data, isLoading } = useGetChallengePredictions(challengeId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (data?.participants && data.participants.length > 0 && expanded.size === 0) {
      setExpanded(new Set([data.participants[0].userId]));
    }
  }, [data?.participants]);

  function toggle(userId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  const predVis = data?.predictionVisibility ?? 'reveal_after_kickoff';
  const note =
    predVis === 'always_visible'
      ? t('predictions.noteAlways')
      : predVis === 'hidden'
        ? t('predictions.noteHidden')
        : t('predictions.noteReveal');
  const visChipCls =
    predVis === 'always_visible'
      ? 'border-primary/30 bg-primary/5 text-primary'
      : predVis === 'hidden'
        ? 'border-border/50 bg-muted/20 text-muted-foreground'
        : 'border-secondary/30 bg-secondary/5 text-secondary';
  const VisIcon = predVis === 'hidden' ? EyeOff : Eye;

  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          {t('predictions.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full bg-muted/50 rounded-xl" />
            ))}
          </div>
        ) : !data || data.participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('predictions.empty')}</p>
        ) : (
          <>
            <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${visChipCls}`}>
              <VisIcon className="w-4 h-4 shrink-0" />
              <span>{note}</span>
            </div>
            <div className="space-y-2">
              {data.participants.map((p) => (
                <ParticipantAccordion
                  key={p.userId}
                  participant={p}
                  matches={data.matches}
                  isExpanded={expanded.has(p.userId)}
                  onToggle={() => toggle(p.userId)}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
