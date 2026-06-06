import React from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGetMe, useTrackAnalyticsEvent } from '@workspace/api-client-react';
import { SiWhatsapp } from 'react-icons/si';

export default function HomePage() {
  const { t } = useI18n();
  const { data: me } = useGetMe();
  const trackEvent = useTrackAnalyticsEvent();

  const shareWhatsApp = () => {
    const base = import.meta.env.BASE_URL;
    const url = `${window.location.origin}${base}`;
    // Best-effort analytics; never block the share action on the request.
    trackEvent.mutate({ data: { type: 'whatsapp_share', entityType: 'app' } });
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${t('home.shareMessage')} ${url}`)}`,
      '_blank',
    );
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t('home.welcome')}, {me?.displayName || me?.realName || '@' + me?.username}!
            </h1>
            <p className="text-muted-foreground mt-1">Level: <span className="font-semibold capitalize text-secondary">{me?.level}</span> | Points: <span className="font-semibold text-primary">{me?.totalPoints}</span></p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/challenges/new">
              <Button className="gap-2" data-testid="button-create-challenge">
                {t('home.createChallenge')}
              </Button>
            </Link>
            <Button variant="outline" className="gap-2" onClick={shareWhatsApp} data-testid="button-share-whatsapp-home">
              <SiWhatsapp className="w-5 h-5 text-[#25D366]" />
              {t('home.shareWhatsApp')}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
          <Card className="border-dashed border-2 bg-transparent shadow-none">
            <CardHeader>
              <CardTitle className="text-muted-foreground">{t('nav.challenges')}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center h-32">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider bg-muted px-3 py-1 rounded-full">{t('home.comingSoon')}</span>
            </CardContent>
          </Card>
          
          <Card className="border-dashed border-2 bg-transparent shadow-none">
            <CardHeader>
              <CardTitle className="text-muted-foreground">{t('nav.rankings')}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center h-32">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider bg-muted px-3 py-1 rounded-full">{t('home.comingSoon')}</span>
            </CardContent>
          </Card>

          <Card className="border-dashed border-2 bg-transparent shadow-none">
            <CardHeader>
              <CardTitle className="text-muted-foreground">{t('nav.matches')}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center h-32">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider bg-muted px-3 py-1 rounded-full">{t('home.comingSoon')}</span>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
