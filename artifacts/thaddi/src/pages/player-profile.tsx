import React, { useState } from 'react';
import { useParams, Link } from 'wouter';
import { useI18n } from '../lib/i18n';
import { formatNum, outcomeLabelKey } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import {
  useGetPlayerProfile,
  useGetUserFollowers,
  useGetUserFollowing,
  getGetPlayerProfileQueryKey,
  getGetUserFollowersQueryKey,
  getGetUserFollowingQueryKey,
} from '@workspace/api-client-react';
import type { ProfilePrediction, FavoriteTeamRef } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Trophy,
  Crown,
  Star,
  Medal,
  Award,
  EyeOff,
  Users,
  ShieldOff,
} from 'lucide-react';
import { FavoriteTeamFlag } from '../components/favorite-team-flag';
import { RelationshipButtons } from '../components/social/relationship-buttons';
import { PlayerCard } from '../components/social/player-card';

const LEVEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bronze: Medal,
  silver: Medal,
  gold: Trophy,
  elite: Star,
  legend: Crown,
};

function teamName(team: FavoriteTeamRef | null | undefined, lang: string): string {
  if (!team) return '';
  return lang === 'ar' ? team.nameAr : team.nameEn;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3 text-center">
      <p className="text-2xl font-black text-primary tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</p>
    </div>
  );
}

function outcomeBadgeClass(outcome: string): string {
  if (outcome === 'exact') return 'bg-secondary/15 text-secondary border-secondary/30';
  if (outcome === 'winner') return 'bg-primary/15 text-primary border-primary/30';
  return 'bg-muted/50 text-muted-foreground border-border/50';
}

function PredictionRow({ p }: { p: ProfilePrediction }) {
  const { t, lang } = useI18n();
  const settled = p.actualHome != null && p.actualAway != null;

  return (
    <Link href={`/matches/${p.matchId}`} className="block">
      <div
        className="flex items-center gap-3 rounded-xl border border-border/50 p-3 hover:bg-accent/30 transition-colors"
        data-testid={`profile-prediction-${p.matchId}`}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1.5 min-w-0 flex-1 justify-end">
            <span className="truncate font-medium">{teamName(p.homeTeam, lang)}</span>
            {p.homeTeam && <FavoriteTeamFlag team={p.homeTeam} size="sm" />}
          </span>
          <span className="font-black tabular-nums px-1.5 shrink-0" dir="ltr">
            {formatNum(p.predictedHome, lang)}
            <span aria-hidden className="mx-0.5 opacity-50">
              :
            </span>
            {formatNum(p.predictedAway, lang)}
          </span>
          <span className="flex items-center gap-1.5 min-w-0 flex-1">
            {p.awayTeam && <FavoriteTeamFlag team={p.awayTeam} size="sm" />}
            <span className="truncate font-medium">{teamName(p.awayTeam, lang)}</span>
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="outline" className={`text-[10px] py-0 ${outcomeBadgeClass(p.outcome)}`}>
            {t(outcomeLabelKey(p.outcome))}
          </Badge>
          {settled && (
            <span className="text-[11px] text-muted-foreground" dir="ltr">
              {t('player.result')}{' '}
              <span className="tabular-nums text-foreground">
                {formatNum(p.actualHome ?? 0, lang)}
                <span aria-hidden className="mx-0.5 opacity-50">
                  :
                </span>
                {formatNum(p.actualAway ?? 0, lang)}
              </span>
            </span>
          )}
        </div>
        <span className="w-12 text-end text-sm font-black tabular-nums text-primary shrink-0">
          {p.pointsAwarded > 0 ? `+${formatNum(p.pointsAwarded, lang)}` : formatNum(0, lang)}
        </span>
      </div>
    </Link>
  );
}

function PeopleDialog({
  userId,
  kind,
  count,
  label,
  testId,
}: {
  userId: string;
  kind: 'followers' | 'following';
  count: number;
  label: string;
  testId: string;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const followersQ = useGetUserFollowers(userId, undefined, {
    query: {
      enabled: open && kind === 'followers',
      queryKey: getGetUserFollowersQueryKey(userId),
    },
  });
  const followingQ = useGetUserFollowing(userId, undefined, {
    query: {
      enabled: open && kind === 'following',
      queryKey: getGetUserFollowingQueryKey(userId),
    },
  });
  const data = kind === 'followers' ? followersQ.data : followingQ.data;
  const isLoading = kind === 'followers' ? followersQ.isLoading : followingQ.isLoading;
  const entries = data?.entries ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex flex-col items-center px-3 py-1 rounded-lg hover:bg-accent/40 transition-colors"
          data-testid={testId}
        >
          <span className="text-lg font-black text-foreground tabular-nums">
            {formatNum(count, lang)}
          </span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-center text-muted-foreground py-8">{t('common.loading')}</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">{t('social.empty')}</p>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pe-3">
              {entries.map((p) => (
                <PlayerCard
                  key={p.userId}
                  player={p}
                  actions={
                    <RelationshipButtons userId={p.userId} viewer={p.viewer} size="sm" />
                  }
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PlayerProfilePage() {
  const { t, lang } = useI18n();
  const params = useParams<{ userId: string }>();
  const userId = params.userId ?? '';
  const { data: profile, isLoading, isError } = useGetPlayerProfile(userId, {
    query: { enabled: !!userId, queryKey: getGetPlayerProfileQueryKey(userId) },
  });

  if (isLoading) {
    return (
      <Layout>
        <p className="text-center text-muted-foreground py-16">{t('common.loading')}</p>
      </Layout>
    );
  }

  if (isError || !profile) {
    return (
      <Layout>
        <div className="max-w-md mx-auto text-center py-16 space-y-3">
          <Users className="w-12 h-12 mx-auto text-muted-foreground/40" />
          <p className="text-muted-foreground">{t('player.notFound')}</p>
        </div>
      </Layout>
    );
  }

  const lp = profile.levelProgress;
  const stats = profile.stats;
  const LevelIcon = LEVEL_ICONS[profile.level] ?? Medal;
  const accuracyPct =
    stats.accuracy != null ? `${formatNum(Math.round(stats.accuracy), lang)}%` : '—';

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <Card className="card-premium overflow-hidden">
          <CardContent className="p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <Avatar className="w-20 h-20 ring-2 ring-secondary/40 ring-offset-2 ring-offset-background">
                  <AvatarImage src={profile.avatarUrl || ''} />
                  <AvatarFallback className="bg-primary/10 text-primary text-2xl font-black">
                    {profile.displayName?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
                {profile.favoriteTeam && (
                  <span className="absolute -bottom-1 -end-1">
                    <FavoriteTeamFlag
                      team={profile.favoriteTeam}
                      size="md"
                      className="ring-2 ring-background rounded-md"
                    />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold tracking-tight truncate">
                  {profile.displayName ||
                    (profile.username ? '@' + profile.username : t('common.na'))}
                </h1>
                {profile.username && (
                  <p className="text-sm text-muted-foreground truncate" dir="ltr">
                    @{profile.username}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className="gap-1 bg-secondary/10 text-secondary border-secondary/30"
                  >
                    <LevelIcon className="w-3.5 h-3.5" />
                    {lang === 'ar' ? lp.nameAr : lp.nameEn}
                  </Badge>
                  {profile.viewer.followsYou && !profile.viewer.isSelf && (
                    <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">
                      {t('social.followsYou')}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Social counts */}
            <div className="flex items-center justify-center gap-2 border-y border-border/40 py-2">
              <PeopleDialog
                userId={profile.userId}
                kind="followers"
                count={profile.social.followerCount}
                label={t('social.followers')}
                testId="button-view-followers"
              />
              <span aria-hidden className="text-border">
                |
              </span>
              <PeopleDialog
                userId={profile.userId}
                kind="following"
                count={profile.social.followingCount}
                label={t('social.following')}
                testId="button-view-following"
              />
              <span aria-hidden className="text-border">
                |
              </span>
              <div className="flex flex-col items-center px-3 py-1">
                <span className="text-lg font-black text-foreground tabular-nums">
                  {formatNum(profile.social.friendCount, lang)}
                </span>
                <span className="text-xs text-muted-foreground">{t('social.friends')}</span>
              </div>
            </div>

            {/* Actions */}
            {profile.viewer.isSelf ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-4 py-3">
                <p className="text-sm text-muted-foreground">{t('player.isYou')}</p>
                <Link href="/profile">
                  <Button variant="outline" size="sm" data-testid="button-edit-profile">
                    {t('player.editProfile')}
                  </Button>
                </Link>
              </div>
            ) : (
              <RelationshipButtons userId={profile.userId} viewer={profile.viewer} />
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="text-lg">{t('gam.stats')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat
                label={t('gam.competitionsJoined')}
                value={formatNum(stats.competitionsJoined, lang)}
              />
              <Stat
                label={t('gam.competitionsWon')}
                value={formatNum(stats.competitionsWon, lang)}
              />
              <Stat
                label={t('gam.totalPredictions')}
                value={formatNum(stats.totalPredictions, lang)}
              />
              <Stat
                label={t('gam.exactPredictions')}
                value={formatNum(stats.exactPredictions, lang)}
              />
              <Stat label={t('gam.accuracy')} value={accuracyPct} />
              <Stat label={t('profile.level')} value={lang === 'ar' ? lp.nameAr : lp.nameEn} />
            </div>
          </CardContent>
        </Card>

        {/* Badges */}
        {profile.badges.length > 0 && (
          <Card className="card-premium">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Award className="w-5 h-5 text-secondary" />
                {t('gam.badges')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {profile.badges.map((b) => (
                  <Badge
                    key={b.id}
                    variant="outline"
                    className="gap-1.5 bg-secondary/10 text-secondary border-secondary/30 py-1"
                    data-testid={`profile-badge-${b.code}`}
                  >
                    <Trophy className="w-3.5 h-3.5" />
                    {lang === 'ar' ? b.nameAr : b.nameEn}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Achievements */}
        {profile.achievements.length > 0 && (
          <Card className="card-premium">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Crown className="w-5 h-5 text-secondary" />
                {t('gam.achievements')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {profile.achievements.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl border border-border/50 p-3"
                  data-testid={`profile-achievement-${a.code}`}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/15 text-secondary shrink-0">
                    <Trophy className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">
                      {lang === 'ar' ? a.nameAr : a.nameEn}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {lang === 'ar' ? a.descriptionAr : a.descriptionEn}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Current challenges */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              {t('player.currentChallenges')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {profile.challenges.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">
                {t('player.noChallenges')}
              </p>
            ) : (
              profile.challenges.map((c) => (
                <Link key={c.id} href={`/challenges/${c.id}`} className="block">
                  <div
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/50 p-3 hover:bg-accent/30 transition-colors"
                    data-testid={`profile-challenge-${c.id}`}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNum(c.participantCount, lang)} {t('player.members')}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="shrink-0 text-[10px] py-0 border-primary/30 text-primary bg-primary/10"
                    >
                      {c.role === 'owner' ? t('player.role.owner') : t('player.role.participant')}
                    </Badge>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent predictions */}
        <Card className="card-premium">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-primary" />
              {t('player.recentPredictions')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {profile.predictionsHidden ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <ShieldOff className="w-8 h-8 opacity-40" />
                <p className="text-sm">{t('player.predictionsHidden')}</p>
              </div>
            ) : profile.recentPredictions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">
                {t('player.noPredictions')}
              </p>
            ) : (
              profile.recentPredictions.map((p) => (
                <PredictionRow key={p.matchId} p={p} />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
