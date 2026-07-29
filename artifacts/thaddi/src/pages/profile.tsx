import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { localeOf, formatNum } from '../lib/matchUtils';
import { Layout } from '../components/layout';
import {
  useGetMe,
  useGetMyGamification,
  useGetMySocial,
  useUpdatePreferences,
  useDeleteAccount,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useClerk, useUser } from '@clerk/react';
import { Link } from 'wouter';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Shield, Trophy, Globe, Award, Medal, Crown, Star, Users, EyeOff, Flag, Trash2, AlertTriangle, LifeBuoy, ChevronRight, Calendar } from 'lucide-react';
import { FavoriteTeamFlag } from '../components/favorite-team-flag';
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5 flex flex-col justify-between space-y-2 shadow-sm">
      <p className="text-3xl font-extrabold text-foreground tabular-nums tracking-tight">{value}</p>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}

function SettingRow({ label, sub, action }: { label: string; sub?: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-border/60 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono" dir="ltr">{sub}</p>}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export default function ProfilePage() {
  const { t, lang, setLang } = useI18n();
  const { data: me } = useGetMe();
  const { data: gam } = useGetMyGamification();
  const { data: social } = useGetMySocial();
  const { signOut } = useClerk();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updatePrefs = useUpdatePreferences({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }),
    },
  });
  const deleteAccount = useDeleteAccount();

  const [emailOpen, setEmailOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const doDeleteAccount = () => {
    deleteAccount.mutate(undefined, {
      onSuccess: async () => {
        await signOut();
      },
      onError: (err) =>
        toast({ title: err.data?.error || t('account.delete.error'), variant: 'destructive' }),
    });
  };

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
      <div className="max-w-6xl mx-auto space-y-8 pb-16 px-2 sm:px-4">
        
        {/* Dedicated Top Page Header */}
        <div className="border-b border-border/70 pb-6 space-y-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">{t('nav.profile')}</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Manage your player identity, competition statistics, and security preferences.</p>
        </div>

        {/* Clean Tabs System */}
        <Tabs defaultValue="profile" dir={lang === 'ar' ? 'rtl' : 'ltr'} className="space-y-8">
          <TabsList className="bg-muted/50 border border-border/70 p-1.5 rounded-xl h-auto inline-flex gap-1">
            <TabsTrigger
              value="profile"
              className="py-2 px-6 rounded-lg font-semibold text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
              data-testid="tab-profile"
            >
              <User className="w-4 h-4 me-2 text-primary" />
              {t('profile.tabProfile')}
            </TabsTrigger>
            <TabsTrigger
              value="account"
              className="py-2 px-6 rounded-lg font-semibold text-sm data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm transition-all"
              data-testid="tab-account"
            >
              <Shield className="w-4 h-4 me-2 text-primary" />
              {t('profile.tabAccount')}
            </TabsTrigger>
          </TabsList>

          {/* ── PROFILE TAB CONTENT ── */}
          <TabsContent value="profile" className="space-y-8 pt-2">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column (4 cols): Player Card & Friends Module */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* Player Identity Card */}
                <Card className="border-border/80 shadow-sm overflow-hidden bg-card">
                  <div className="bg-muted/30 border-b border-border/60 p-8 flex flex-col items-center text-center">
                    <Avatar className="w-28 h-28 border-2 border-border shadow-md mb-4">
                      <AvatarImage src={me.avatarUrl || ''} className="object-cover" />
                      <AvatarFallback className="text-3xl bg-primary/15 text-primary font-bold">
                        {me.displayName?.charAt(0) || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <h2 className="text-2xl font-bold text-foreground tracking-tight w-full truncate">{me.realName}</h2>
                    <p className="text-sm font-semibold text-primary mt-0.5">@{me.username}</p>
                    
                    <div className="flex items-center justify-center gap-2 mt-5 pt-4 border-t border-border/50 w-full text-xs text-muted-foreground font-medium">
                      <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>{t('profile.joined')} {new Date(me.createdAt).toLocaleDateString(localeOf(lang))}</span>
                    </div>
                  </div>

                  <CardContent className="p-6 space-y-5">
                    <div>
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-3">
                        Favorite Affiliations
                      </span>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3 py-2 border-b border-border/40">
                          <div className="flex items-center gap-2.5 text-foreground font-medium text-sm">
                            <Flag className="w-4 h-4 text-muted-foreground" />
                            <span>National Team</span>
                          </div>
                          {me.favoriteTeam ? (
                            <FavoriteTeamFlag team={me.favoriteTeam} size="md" />
                          ) : (
                            <span className="text-xs text-muted-foreground font-medium">None set</span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-3 py-2">
                          <div className="flex items-center gap-2.5 text-foreground font-medium text-sm">
                            <Shield className="w-4 h-4 text-muted-foreground" />
                            <span>Football Club</span>
                          </div>
                          {me.favoriteClub?.crestUrl ? (
                            <img
                              src={me.favoriteClub.crestUrl}
                              alt={lang === 'ar' ? me.favoriteClub.nameAr : me.favoriteClub.nameEn}
                              className="w-7 h-7 object-contain drop-shadow-sm"
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground font-medium">None set</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                      <Link href="/pick-team" data-testid="link-change-team" className="flex-1">
                        <Button variant="outline" size="sm" className="w-full justify-center font-semibold text-xs h-9">
                          <Flag className="w-3.5 h-3.5 me-2 text-primary" />
                          {me.favoriteTeam ? t('profile.changeTeam') : t('profile.chooseTeam')}
                        </Button>
                      </Link>
                      <Link href="/pick-club" data-testid="link-change-club" className="flex-1">
                        <Button variant="outline" size="sm" className="w-full justify-center font-semibold text-xs h-9">
                          <Shield className="w-3.5 h-3.5 me-2 text-primary" />
                          {me.favoriteClub ? t('profile.changeClub') : t('profile.chooseClub')}
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>

                {/* Friends & Social Module */}
                <Card className="border-border/80 shadow-sm bg-card">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 shrink-0">
                        <Users className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-bold text-foreground">{t('social.friends')}</p>
                        <p className="text-xs font-semibold text-muted-foreground mt-0.5">
                          <span className="text-foreground">{formatNum(social?.friends.length ?? 0, lang)}</span> {t('social.friends')}
                          {social && social.incomingRequests.length > 0 && (
                            <span className="text-primary font-bold ms-1.5">
                              • {formatNum(social.incomingRequests.length, lang)} pending
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <Link href="/social" className="block">
                      <Button variant="outline" size="sm" className="w-full font-semibold text-xs h-9 justify-between" data-testid="link-social">
                        <span>{t('social.manageCta')}</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>

              {/* Right Column (8 cols): Gamification, Stats, & Achievements */}
              <div className="lg:col-span-8 space-y-6">
                
                {/* Level Track Card */}
                {lp && (
                  <Card className="border-border/80 shadow-sm bg-card">
                    <CardHeader className="pb-4 border-b border-border/60">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <LevelIcon className="w-4 h-4" />
                          </div>
                          <CardTitle className="text-lg font-bold">{t('profile.level')}</CardTitle>
                        </div>
                        <span className="text-xs font-mono font-black px-3 py-1 rounded-md bg-primary/15 text-primary">
                          {formatNum(stats?.totalPoints ?? me.totalPoints, lang)} PTS
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-2xl font-bold uppercase text-foreground">
                          {lang === 'ar' ? lp.nameAr : lp.nameEn}
                        </span>
                        <span className="text-xs text-muted-foreground font-semibold">
                          {lp.nextLevel
                            ? t('gam.pointsToNext')
                                .replace('{points}', String(lp.pointsToNextLevel ?? 0))
                                .replace('{level}', lang === 'ar' ? (lp.nextLevelNameAr ?? '') : (lp.nextLevelNameEn ?? ''))
                            : t('gam.maxLevel')}
                        </span>
                      </div>
                      <div className="h-3 w-full overflow-hidden rounded-full bg-muted p-0.5 border border-border/50">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(3, lp.progressPercent))}%` }}
                          data-testid="bar-level-progress"
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Statistics Grid */}
                {stats && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">{t('gam.stats')}</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <Stat label={t('gam.competitionsJoined')} value={stats.competitionsJoined} />
                      <Stat label={t('gam.competitionsWon')} value={stats.competitionsWon} />
                      <Stat label={t('gam.totalPredictions')} value={stats.totalPredictions} />
                      <Stat label={t('gam.exactPredictions')} value={stats.exactPredictions} />
                      <Stat label={t('gam.accuracy')} value={`${Math.round(stats.accuracy)}%`} />
                    </div>
                  </div>
                )}

                {/* Badges Collection */}
                <Card className="border-border/80 shadow-sm bg-card">
                  <CardHeader className="pb-4 border-b border-border/60">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg font-bold flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-foreground">
                          <Award className="w-4 h-4" />
                        </div>
                        <span>{t('gam.badges')}</span>
                      </CardTitle>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {formatNum(gam?.badges.length ?? 0, lang)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    {gam && gam.badges.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                        {gam.badges.map((b) => (
                          <div
                            key={b.id}
                            className="flex flex-col items-center gap-2.5 rounded-2xl border border-border/70 bg-muted/20 p-4 text-center"
                            data-testid={`badge-${b.code}`}
                          >
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground border border-border/50">
                              <Award className="w-6 h-6" />
                            </div>
                            <span className="text-sm font-bold text-foreground leading-tight mt-1">
                              {lang === 'ar' ? b.nameAr : b.nameEn}
                            </span>
                            {(b.descriptionAr || b.descriptionEn) && (
                              <span className="text-xs text-muted-foreground leading-snug line-clamp-2">
                                {lang === 'ar' ? b.descriptionAr : b.descriptionEn}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 space-y-2">
                        <Award className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                        <p className="text-sm font-semibold text-foreground">{t('gam.noBadges')}</p>
                        <p className="text-xs text-muted-foreground max-w-xs mx-auto">Make predictions on matches and participate in challenges to earn player badges!</p>
                        <div className="pt-2">
                          <Link href="/matches" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
                            <span>{t('gam.noBadgesCta')}</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Achievements Table */}
                {gam && gam.achievements.length > 0 && (
                  <Card className="border-border/80 shadow-sm bg-card">
                    <CardHeader className="pb-4 border-b border-border/60">
                      <CardTitle className="text-lg font-bold flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-foreground">
                          <Crown className="w-4 h-4" />
                        </div>
                        <span>{t('gam.achievements')}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y divide-border/60">
                        {gam.achievements.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between gap-4 p-4 hover:bg-muted/20 transition-colors"
                            data-testid={`achievement-${a.code}`}
                          >
                            <div className="flex items-center gap-3.5 min-w-0">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground shrink-0 border border-border/50">
                                <Trophy className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-sm sm:text-base text-foreground truncate">{lang === 'ar' ? a.nameAr : a.nameEn}</p>
                                {(a.descriptionAr || a.descriptionEn) && (
                                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                    {lang === 'ar' ? a.descriptionAr : a.descriptionEn}
                                  </p>
                                )}
                              </div>
                            </div>
                            <span className="text-xs font-mono font-medium text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md shrink-0">
                              {new Date(a.awardedAt).toLocaleDateString(localeOf(lang))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── ACCOUNT TAB CONTENT ── */}
          <TabsContent value="account" className="space-y-6 max-w-3xl pt-2">
            <Card className="border-border/80 shadow-sm bg-card">
              <CardHeader className="pb-4 border-b border-border/60">
                <CardTitle className="text-lg font-bold flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Shield className="w-4 h-4" />
                  </div>
                  <span>{t('profile.account')}</span>
                </CardTitle>
                <CardDescription>Manage your authentication sign-in credentials.</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-1">
                <SettingRow
                  label={t('profile.email')}
                  sub={me.email || t('common.na')}
                  action={
                    <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)} data-testid="button-change-email" className="font-semibold text-xs">
                      {t('account.change')}
                    </Button>
                  }
                />
                <SettingRow
                  label={t('account.password')}
                  sub={hasPassword ? '••••••••' : t('account.passwordNotSet')}
                  action={
                    <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)} data-testid="button-change-password" className="font-semibold text-xs">
                      {hasPassword ? t('account.change') : t('account.setPassword')}
                    </Button>
                  }
                />
                <SettingRow
                  label={t('profile.mobile')}
                  sub={me.mobileNumber || t('common.na')}
                  action={
                    <Button variant="outline" size="sm" onClick={() => setMobileOpen(true)} data-testid="button-change-mobile" className="font-semibold text-xs">
                      {t('account.change')}
                    </Button>
                  }
                />
              </CardContent>
            </Card>

            {/* Privacy Controls */}
            <Card className="border-border/80 shadow-sm bg-card">
              <CardHeader className="pb-4 border-b border-border/60">
                <CardTitle className="text-lg font-bold flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <EyeOff className="w-4 h-4" />
                  </div>
                  <span>{t('profile.privacy')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm sm:text-base">{t('profile.hidePredictions')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('profile.hidePredictionsDesc')}</p>
                  </div>
                  <Switch
                    checked={me.hidePredictions}
                    disabled={updatePrefs.isPending}
                    onCheckedChange={(checked) =>
                      updatePrefs.mutate({ data: { hidePredictions: checked } })
                    }
                    data-testid="switch-hide-predictions"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Settings & Support Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <Card className="border-border/80 shadow-sm bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Globe className="w-4 h-4 text-muted-foreground" />
                    <span>{t('profile.settings')}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-1">
                  <Button variant="outline" className="w-full justify-between font-semibold text-xs h-10" onClick={toggleLanguage} data-testid="button-lang-toggle-profile">
                    <span>{t('common.switchTo')} {lang === 'ar' ? 'English' : 'العربية'}</span>
                    <Globe className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  <Button variant="destructive" className="w-full font-semibold text-xs h-10" onClick={() => signOut()} data-testid="button-signout">
                    {t('auth.signOut')}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-sm bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <LifeBuoy className="w-4 h-4 text-muted-foreground" />
                    <span>{t('support.title')}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-1">
                  <p className="text-xs text-muted-foreground">{t('support.contactDesc')}</p>
                  <Link href="/support" className="block">
                    <Button variant="outline" className="w-full justify-between font-semibold text-xs h-10" data-testid="link-support">
                      <span>{t('support.open')}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Danger Zone */}
            <Card className="border-destructive/40 shadow-sm bg-destructive/5">
              <CardHeader className="pb-4 border-b border-destructive/20">
                <CardTitle className="text-base font-bold flex items-center gap-2.5 text-destructive">
                  <div className="w-8 h-8 rounded-lg bg-destructive/15 flex items-center justify-center text-destructive">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <span>{t('account.delete.title')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">{t('account.delete.desc')}</p>
                <AlertDialog
                  open={deleteOpen}
                  onOpenChange={(o) => {
                    setDeleteOpen(o);
                    if (!o) setConfirmText('');
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="shrink-0 gap-2 font-semibold text-xs h-9" data-testid="button-delete-account">
                      <Trash2 className="w-4 h-4" />
                      {t('account.delete.button')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-card border-border">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-destructive font-bold flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" />
                        {t('account.delete.confirmTitle')}
                      </AlertDialogTitle>
                      <AlertDialogDescription className="text-muted-foreground text-sm">
                        {t('account.delete.confirmBody')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2 py-2">
                      <label htmlFor="delete-confirm" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t('account.delete.confirmLabel')}
                      </label>
                      <Input
                        id="delete-confirm"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={t('account.delete.confirmWord')}
                        autoComplete="off"
                        data-testid="input-delete-confirm"
                        className="font-mono text-center font-bold"
                      />
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="font-semibold text-xs">{t('common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          doDeleteAccount();
                        }}
                        disabled={
                          confirmText.trim() !== t('account.delete.confirmWord') || deleteAccount.isPending
                        }
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold text-xs"
                        data-testid="button-confirm-delete-account"
                      >
                        {t('account.delete.submit')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ChangeEmailDialog open={emailOpen} onOpenChange={setEmailOpen} />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
      <ChangeMobileDialog open={mobileOpen} onOpenChange={setMobileOpen} />
    </Layout>
  );
}
