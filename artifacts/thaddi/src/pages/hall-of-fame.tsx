import React from 'react';
import { useI18n } from '../lib/i18n';
import { localeOf, formatNum } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import { useGetHallOfFame, useGetTopPlayers } from '@workspace/api-client-react';
import type { TopPlayerEntry } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { FavoriteTeamFlag } from '../components/favorite-team-flag';
import { Link } from 'wouter';
import { Crown, Trophy, Users } from 'lucide-react';

function rankBadge(rank: number): string {
  if (rank === 1)
    return 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-white shadow-[0_0_15px_rgba(234,179,8,0.4)] border-none ring-1 ring-yellow-400/50';
  if (rank === 2)
    return 'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-[0_0_10px_rgba(148,163,184,0.3)] border-none';
  if (rank === 3)
    return 'bg-gradient-to-br from-orange-400 to-orange-700 text-white shadow-[0_0_10px_rgba(249,115,22,0.3)] border-none';
  return 'bg-muted/50 text-muted-foreground border-border/50';
}

function TopPlayerRow({ entry }: { entry: TopPlayerEntry }) {
  const { t, lang } = useI18n();
  const accuracy =
    entry.accuracy != null
      ? `${formatNum(Math.round(entry.accuracy * 100), lang)}%`
      : '—';
  const isFirst = entry.rank === 1;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-all border-b border-border/20 last:border-0 ${
        entry.isCurrentUser
          ? 'bg-primary/5 ring-1 ring-primary/30 relative z-10 shadow-sm'
          : 'hover:bg-accent/30'
      } ${isFirst ? 'ltr:bg-gradient-to-r rtl:bg-gradient-to-l from-secondary/5 to-transparent' : ''}`}
      data-testid={`top-player-row-${entry.userId}`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black tabular-nums ${rankBadge(
          entry.rank,
        )}`}
      >
        {entry.rank <= 3 ? (
          <Crown className="w-5 h-5 drop-shadow-sm" />
        ) : (
          formatNum(entry.rank, lang)
        )}
      </div>

      <div className="relative shrink-0">
        <Avatar
          className={`w-11 h-11 ${
            isFirst
              ? 'ring-2 ring-secondary ring-offset-1 ring-offset-background'
              : 'ring-1 ring-border'
          }`}
        >
          <AvatarImage src={entry.avatarUrl || ''} />
          <AvatarFallback className="bg-muted text-foreground text-sm font-bold">
            {entry.displayName?.charAt(0) || 'U'}
          </AvatarFallback>
        </Avatar>
        {entry.favoriteTeam && (
          <span className="absolute -bottom-1 -end-1">
            <FavoriteTeamFlag
              team={entry.favoriteTeam}
              size="sm"
              className="ring-1 ring-background rounded-sm"
            />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`font-bold truncate ${
              isFirst ? 'text-secondary text-base' : 'text-foreground'
            }`}
          >
            {entry.displayName || (entry.username ? '@' + entry.username : t('common.na'))}
          </span>
          {entry.isCurrentUser && (
            <Badge
              variant="outline"
              className="text-[10px] py-0 border-primary/30 text-primary bg-primary/10"
            >
              {t('rankings.you')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span className="font-medium">
            {t('rankings.accuracy')} <span dir="ltr">{accuracy}</span>
          </span>
          <span aria-hidden className="opacity-50">
            ·
          </span>
          <span dir="ltr" className="font-medium">
            <span className="text-foreground">
              {formatNum(entry.exactPredictions, lang)}
            </span>{' '}
            {t('rankings.exact')}
          </span>
        </div>
        {entry.challenges.length > 0 && (
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground mt-1">
            <Users className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-70" />
            <span className="min-w-0">
              <span className="opacity-70">{t('hof.playsIn')} </span>
              {entry.challenges.map((c, i) => (
                <React.Fragment key={c.id}>
                  {i > 0 && <span aria-hidden>{lang === 'ar' ? '، ' : ', '}</span>}
                  <Link
                    href={`/challenges/${c.id}`}
                    className="font-medium text-foreground/80 hover:text-primary underline-offset-2 hover:underline"
                  >
                    {c.name}
                  </Link>
                </React.Fragment>
              ))}
            </span>
          </div>
        )}
      </div>

      <span
        className={`shrink-0 text-end text-xl font-black tabular-nums ${
          isFirst ? 'text-secondary drop-shadow-sm' : 'text-primary'
        }`}
      >
        {formatNum(entry.points, lang)}
      </span>
    </div>
  );
}

export default function HallOfFamePage() {
  const { t, lang } = useI18n();
  const { data: topData, isLoading: topLoading } = useGetTopPlayers();
  const { data: hofData, isLoading: hofLoading } = useGetHallOfFame();

  const players = topData?.entries ?? [];
  const achievements = hofData?.entries ?? [];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary/15 text-secondary">
            <Crown className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('hof.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('hof.subtitle')}</p>
          </div>
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{t('hof.topPlayers')}</h2>
            <p className="text-sm text-muted-foreground">{t('hof.topPlayersSubtitle')}</p>
          </div>
          {topLoading ? (
            <p className="text-muted-foreground text-center py-12">{t('common.loading')}</p>
          ) : players.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {t('hof.noPlayers')}
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-col">
                  {players.map((e) => (
                    <TopPlayerRow key={e.userId} entry={e} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold tracking-tight">{t('hof.achievementsTitle')}</h2>
          {hofLoading ? (
            <p className="text-muted-foreground text-center py-12">{t('common.loading')}</p>
          ) : achievements.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {t('hof.empty')}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {achievements.map((e) => (
                <Card key={`${e.userId}-${e.achievementCode}-${e.awardedAt}`} className="overflow-hidden">
                  <CardContent className="flex items-center gap-4 p-4">
                    <Avatar className="w-12 h-12 border-2 border-secondary/30">
                      <AvatarImage src={e.avatarUrl || ''} />
                      <AvatarFallback className="bg-secondary/10 text-secondary font-bold">
                        {e.displayName?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold truncate">
                        {e.displayName || (e.username ? '@' + e.username : t('common.na'))}
                      </p>
                      <p className="text-sm text-secondary font-semibold flex items-center gap-1.5">
                        <Trophy className="w-4 h-4 shrink-0" />
                        {lang === 'ar' ? e.achievementNameAr : e.achievementNameEn}
                      </p>
                      {e.challengeName && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {t('hof.in')}{' '}
                          {e.challengeId ? (
                            <Link
                              href={`/challenges/${e.challengeId}`}
                              className="hover:text-primary underline-offset-2 hover:underline"
                            >
                              {e.challengeName}
                            </Link>
                          ) : (
                            e.challengeName
                          )}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(e.awardedAt).toLocaleDateString(localeOf(lang))}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
