import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { localeOf } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import { useGetMe, useGetMyGamification } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useClerk, useUser } from '@clerk/react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Shield, Trophy, Globe, Award, Medal, Crown, Star } from 'lucide-react';
import { ChangeEmailDialog } from '../components/account/change-email-dialog';
import { ChangePasswordDialog } from '../components/account/change-password-dialog';
import { ChangeMobileDialog } from '../components/account/change-mobile-dialog';

const LEVEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bronze: Medal,
  silver: Medal,
  gold: Trophy,
  elite: Star,
  legend: Crown,
};

export default function ProfilePage() {
  const { t, lang, setLang } = useI18n();
  const { data: me } = useGetMe();
  const { data: gam } = useGetMyGamification();
  const { signOut } = useClerk();
  const { user } = useUser();

  const [emailOpen, setEmailOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleLanguage = () => {
    setLang(lang === 'ar' ? 'en' : 'ar');
  };

  if (!me) return null;

  const hasPassword = Boolean(user?.passwordEnabled);

  const lp = gam?.levelProgress;
  const stats = gam?.stats;
  const LevelIcon = lp ? LEVEL_ICONS[lp.level] ?? Trophy : Trophy;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">{t('nav.profile')}</h1>

        <Card>
          <CardContent className="pt-6 flex flex-col md:flex-row items-center gap-6">
            <Avatar className="w-24 h-24 border-4 border-background shadow-sm">
              <AvatarImage src={me.avatarUrl || ''} />
              <AvatarFallback className="text-2xl bg-primary/10 text-primary">{me.displayName?.charAt(0) || 'U'}</AvatarFallback>
            </Avatar>

            <div className="text-center md:text-start flex-1">
              <h2 className="text-2xl font-bold">{me.realName}</h2>
              <p className="text-muted-foreground font-medium">@{me.username} • {me.displayName}</p>
            </div>
          </CardContent>
        </Card>

        {/* Level progress */}
        {lp && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <LevelIcon className="w-5 h-5 text-secondary" />
                {t('profile.level')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold capitalize text-secondary">
                  {lang === 'ar' ? lp.nameAr : lp.nameEn}
                </span>
                <span className="font-bold text-primary">{stats?.totalPoints ?? me.totalPoints}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, lp.progressPercent))}%` }}
                  data-testid="bar-level-progress"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {lp.nextLevel
                  ? t('gam.pointsToNext')
                      .replace('{points}', String(lp.pointsToNextLevel ?? 0))
                      .replace('{level}', lang === 'ar' ? (lp.nextLevelNameAr ?? '') : (lp.nextLevelNameEn ?? ''))
                  : t('gam.maxLevel')}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Stats grid */}
        {stats && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" />
                {t('gam.stats')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Stat label={t('gam.competitionsJoined')} value={stats.competitionsJoined} />
              <Stat label={t('gam.competitionsWon')} value={stats.competitionsWon} />
              <Stat label={t('gam.totalPredictions')} value={stats.totalPredictions} />
              <Stat label={t('gam.exactPredictions')} value={stats.exactPredictions} />
              <Stat label={t('gam.accuracy')} value={`${Math.round(stats.accuracy)}%`} />
            </CardContent>
          </Card>
        )}

        {/* Badges */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Award className="w-5 h-5 text-secondary" />
              {t('gam.badges')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {gam && gam.badges.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {gam.badges.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-3 text-center"
                    data-testid={`badge-${b.code}`}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/15 text-secondary">
                      <Award className="w-5 h-5" />
                    </div>
                    <span className="text-sm font-semibold leading-tight">
                      {lang === 'ar' ? b.nameAr : b.nameEn}
                    </span>
                    {(b.descriptionAr || b.descriptionEn) && (
                      <span className="text-xs text-muted-foreground leading-tight">
                        {lang === 'ar' ? b.descriptionAr : b.descriptionEn}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">{t('gam.noBadges')}</p>
            )}
          </CardContent>
        </Card>

        {/* Achievements */}
        {gam && gam.achievements.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Crown className="w-5 h-5 text-secondary" />
                {t('gam.achievements')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {gam.achievements.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-xl border border-border p-3"
                  data-testid={`achievement-${a.code}`}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary/15 text-secondary shrink-0">
                    <Trophy className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold leading-tight">{lang === 'ar' ? a.nameAr : a.nameEn}</p>
                    {(a.descriptionAr || a.descriptionEn) && (
                      <p className="text-xs text-muted-foreground leading-tight">
                        {lang === 'ar' ? a.descriptionAr : a.descriptionEn}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(a.awardedAt).toLocaleDateString(localeOf(lang))}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Account details */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              {t('profile.account')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <span className="text-muted-foreground block text-sm">{t('profile.email')}</span>
                  <span className="text-sm font-medium truncate block" dir="ltr">{me.email || t('common.na')}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEmailOpen(true)}
                  className="shrink-0"
                  data-testid="button-change-email"
                >
                  {t('account.change')}
                </Button>
              </div>

              <div className="flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <span className="text-muted-foreground block text-sm">{t('account.password')}</span>
                  <span className="text-sm font-medium block">
                    {hasPassword ? '••••••••' : t('account.passwordNotSet')}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPasswordOpen(true)}
                  className="shrink-0"
                  data-testid="button-change-password"
                >
                  {hasPassword ? t('account.change') : t('account.setPassword')}
                </Button>
              </div>

              <div className="flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <span className="text-muted-foreground block text-sm">{t('profile.mobile')}</span>
                  <span className="text-sm font-medium block" dir="ltr">{me.mobileNumber || t('common.na')}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMobileOpen(true)}
                  className="shrink-0"
                  data-testid="button-change-mobile"
                >
                  {t('account.change')}
                </Button>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">{t('profile.joined')}</span>
                <span className="text-sm font-medium">{new Date(me.createdAt).toLocaleDateString(localeOf(lang))}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="w-5 h-5" />
              {t('profile.settings')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <Button variant="outline" onClick={toggleLanguage} className="w-full sm:w-auto" data-testid="button-lang-toggle-profile">
              {t('common.switchTo')} {lang === 'ar' ? 'English' : 'العربية'}
            </Button>

            <Button variant="destructive" onClick={() => signOut()} className="w-full sm:w-auto" data-testid="button-signout">
              {t('auth.signOut')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <ChangeEmailDialog open={emailOpen} onOpenChange={setEmailOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <ChangeMobileDialog open={mobileOpen} onOpenChange={setMobileOpen} />
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3 text-center">
      <p className="text-2xl font-black text-primary">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</p>
    </div>
  );
}
