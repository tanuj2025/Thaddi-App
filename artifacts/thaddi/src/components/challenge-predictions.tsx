import React from 'react';
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
import { Users, Crown, Lock } from 'lucide-react';
import { formatNum, outcomeStyles, type Lang } from '../lib/matchUtils';

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
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-background/30 px-2.5 py-2 min-w-[7.5rem]">
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <MatchFlag team={match.homeTeam} />
        <span className="truncate max-w-[3rem]">{teamCode(match.homeTeam, lang)}</span>
        <span className="text-muted-foreground/50">{t('matches.vs')}</span>
        <span className="truncate max-w-[3rem]">{teamCode(match.awayTeam, lang)}</span>
        <MatchFlag team={match.awayTeam} />
      </div>
      <div className="flex items-center justify-center gap-2">
        {entry ? (
          <>
            <span className="tabular-nums font-bold text-base" dir="ltr">
              {formatNum(entry.homeScore, lang)}-{formatNum(entry.awayScore, lang)}
            </span>
            {entry.outcome !== 'pending' && (
              <Badge
                variant="outline"
                className={`text-[10px] ${outcomeStyles[entry.outcome] || ''}`}
              >
                {entry.outcome === 'none'
                  ? t('outcome.none')
                  : `+${formatNum(entry.pointsAwarded, lang)}`}
              </Badge>
            )}
          </>
        ) : !match.revealed ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
            <Lock className="w-3 h-3" />
            {t('predictions.hidden')}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/60">{t('predictions.noPick')}</span>
        )}
      </div>
    </div>
  );
}

function ParticipantCard({
  participant,
  matches,
}: {
  participant: ChallengePredictionParticipant;
  matches: ChallengePredictionMatch[];
}) {
  const { t } = useI18n();

  return (
    <div
      className="rounded-xl border border-border/50 bg-background/30 p-4 space-y-3"
      data-testid={`prediction-player-${participant.userId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="w-9 h-9 border border-primary/20">
            <AvatarImage src={participant.avatarUrl || ''} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
              {participant.displayName?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold truncate">
                {participant.displayName || '—'}
              </span>
              {participant.isOwner && (
                <Badge
                  variant="secondary"
                  className="gap-1 bg-secondary/10 text-secondary border border-secondary/20 h-5 px-1.5"
                >
                  <Crown className="w-3 h-3" />
                  <span className="text-[10px]">{t('detail.ownerBadge')}</span>
                </Badge>
              )}
            </div>
            {participant.username && (
              <span className="text-xs text-muted-foreground truncate" dir="ltr">
                @{participant.username}
              </span>
            )}
          </div>
        </div>
        <span className="text-sm font-mono text-primary font-bold bg-primary/10 px-2.5 py-1 rounded-md border border-primary/20 shrink-0">
          {participant.points}{' '}
          <span className="font-sans font-medium text-xs text-primary/70">
            {t('detail.points')}
          </span>
        </span>
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('predictions.noPredictions')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {matches.map((m) => (
            <PredictionChip key={m.matchId} match={m} participant={participant} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChallengePredictions({ challengeId }: { challengeId: string }) {
  const { t } = useI18n();
  const { data, isLoading } = useGetChallengePredictions(challengeId);

  const note =
    data?.predictionVisibility === 'always_visible'
      ? t('predictions.noteAlways')
      : data?.predictionVisibility === 'hidden'
        ? t('predictions.noteHidden')
        : t('predictions.noteReveal');

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
          <div className="space-y-3">
            <Skeleton className="h-24 w-full bg-muted/50" />
            <Skeleton className="h-24 w-full bg-muted/50" />
          </div>
        ) : !data || data.participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('predictions.empty')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{note}</p>
            <div className="space-y-3">
              {data.participants.map((p) => (
                <ParticipantCard key={p.userId} participant={p} matches={data.matches} />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
