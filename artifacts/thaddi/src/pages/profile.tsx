import React from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { useGetMe } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useClerk } from '@clerk/react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Shield, Trophy, Globe } from 'lucide-react';

export default function ProfilePage() {
  const { t, lang, setLang } = useI18n();
  const { data: me } = useGetMe();
  const { signOut } = useClerk();

  const toggleLanguage = () => {
    setLang(lang === 'ar' ? 'en' : 'ar');
  };

  if (!me) return null;

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
            
            <div className="text-center md:text-left flex-1">
              <h2 className="text-2xl font-bold">{me.realName}</h2>
              <p className="text-muted-foreground font-medium">@{me.username} • {me.displayName}</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Trophy className="w-5 h-5 text-secondary" /> 
                {t('profile.status')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('profile.level')}</span>
                  <span className="font-semibold capitalize text-secondary">{me.level}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('profile.points')}</span>
                  <span className="font-bold text-primary">{me.totalPoints}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('profile.role')}</span>
                  <span className="font-medium capitalize">{me.role}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                {t('profile.account')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('profile.email')}</span>
                  <span className="text-sm font-medium">{me.email || t('common.na')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('profile.mobile')}</span>
                  <span className="text-sm font-medium" dir="ltr">{me.mobileNumber || t('common.na')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('profile.joined')}</span>
                  <span className="text-sm font-medium">{new Date(me.createdAt).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US')}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
    </Layout>
  );
}
