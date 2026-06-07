import React from 'react';
import { useI18n } from '../lib/i18n';
import { localeOf } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import { useGetHallOfFame } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Link } from 'wouter';
import { Crown, Trophy } from 'lucide-react';

export default function HallOfFamePage() {
  const { t, lang } = useI18n();
  const { data, isLoading } = useGetHallOfFame();

  const entries = data?.entries ?? [];

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary/15 text-secondary">
            <Crown className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('hof.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('hof.subtitle')}</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground text-center py-12">{t('common.loading')}</p>
        ) : entries.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t('hof.empty')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {entries.map((e) => (
              <Card key={`${e.userId}-${e.achievementCode}-${e.awardedAt}`} className="overflow-hidden">
                <CardContent className="flex items-center gap-4 p-4">
                  <Avatar className="w-12 h-12 border-2 border-secondary/30">
                    <AvatarImage src={e.avatarUrl || ''} />
                    <AvatarFallback className="bg-secondary/10 text-secondary font-bold">
                      {e.displayName?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold truncate">{e.displayName || (e.username ? '@' + e.username : t('common.na'))}</p>
                    <p className="text-sm text-secondary font-semibold flex items-center gap-1.5">
                      <Trophy className="w-4 h-4 shrink-0" />
                      {lang === 'ar' ? e.achievementNameAr : e.achievementNameEn}
                    </p>
                    {e.challengeName && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {t('hof.in')}{' '}
                        {e.challengeId ? (
                          <Link href={`/challenges/${e.challengeId}`} className="hover:text-primary underline-offset-2 hover:underline">
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
      </div>
    </Layout>
  );
}
