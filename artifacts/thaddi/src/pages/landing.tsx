import React from 'react';
import { useI18n } from '../lib/i18n';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { useGetPlatformStats } from '@workspace/api-client-react';
import { SiWhatsapp } from 'react-icons/si';

export default function LandingPage() {
  const { t, lang, setLang } = useI18n();
  const { data: stats } = useGetPlatformStats();

  const toggleLanguage = () => {
    setLang(lang === 'ar' ? 'en' : 'ar');
  };

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col">
      <header className="border-b border-border bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="THADDI Logo" className="h-8 w-auto" />
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={toggleLanguage} className="font-semibold" data-testid="button-lang-toggle">
              {lang === 'ar' ? 'English' : 'العربية'}
            </Button>
            <Link href="/sign-in" className="text-sm font-medium hover:text-secondary transition-colors">
              {t('auth.signIn')}
            </Link>
            <Link href="/sign-up">
              <Button className="bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-gold" data-testid="button-signup-header">{t('auth.signUp')}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20">
        <div className="max-w-4xl mx-auto mb-6 relative">
          <div className="absolute inset-0 glow-gold opacity-20 blur-3xl rounded-full"></div>
          <h1 className="relative text-5xl md:text-7xl font-black tracking-tight text-gold-gradient pb-2">
            {t('hero.title')}
          </h1>
        </div>
        <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-12">
          {t('hero.subtitle')}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link href="/sign-up">
            <Button size="lg" className="text-lg px-8 py-6 rounded-full w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 glow-green transition-all" data-testid="button-start-hero">
              {t('hero.cta')}
            </Button>
          </Link>
          <Button size="lg" variant="outline" className="text-lg px-8 py-6 rounded-full w-full sm:w-auto gap-2 bg-card/50 backdrop-blur-sm border-border hover:bg-card/80 transition-all" data-testid="button-share-whatsapp-hero">
            <SiWhatsapp className="w-5 h-5 text-[#25D366]" />
            {t('home.shareWhatsApp')}
          </Button>
        </div>

        {stats && (
          <div className="mt-20 grid grid-cols-1 sm:grid-cols-3 gap-8 w-full max-w-4xl mx-auto">
            <div className="card-premium p-6 rounded-2xl text-center">
              <div className="text-4xl font-black text-primary mb-2">{stats.totalUsers.toLocaleString()}</div>
              <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t('landing.stats.users')}</div>
            </div>
            <div className="card-premium p-6 rounded-2xl text-center relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-1 bg-secondary glow-gold"></div>
              <div className="text-4xl font-black text-secondary mb-2">{stats.totalChallenges.toLocaleString()}</div>
              <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t('landing.stats.challenges')}</div>
            </div>
            <div className="card-premium p-6 rounded-2xl text-center">
              <div className="text-4xl font-black text-foreground mb-2">{stats.totalPredictions.toLocaleString()}</div>
              <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{t('landing.stats.predictions')}</div>
            </div>
          </div>
        )}

        <div className="mt-32 w-full max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-black mb-12 text-center text-gold-gradient">{t('pricing.title')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="card-premium p-8 rounded-3xl flex flex-col items-center text-center">
              <h3 className="text-xl font-bold mb-2">{t('pricing.free.name')}</h3>
              <div className="text-3xl font-black mb-4">{t('pricing.free.price')}</div>
              <p className="text-muted-foreground">{t('pricing.free.desc')}</p>
            </div>
            <div className="card-premium p-8 rounded-3xl flex flex-col items-center text-center transform md:-translate-y-4 relative overflow-hidden ring-1 ring-primary glow-green">
              <div className="absolute top-0 inset-x-0 h-1 bg-primary"></div>
              <h3 className="text-xl font-bold mb-2 text-primary">{t('pricing.pro.name')}</h3>
              <div className="text-3xl font-black mb-4">{t('pricing.pro.price')}</div>
              <p className="text-muted-foreground">{t('pricing.pro.desc')}</p>
            </div>
            <div className="card-premium p-8 rounded-3xl flex flex-col items-center text-center transform md:-translate-y-8 relative overflow-hidden ring-2 ring-secondary glow-gold">
              <div className="absolute top-0 inset-x-0 h-2 bg-secondary"></div>
              <h3 className="text-xl font-bold mb-2 text-secondary">{t('pricing.legend.name')}</h3>
              <div className="text-3xl font-black mb-4 text-gold-gradient">{t('pricing.legend.price')}</div>
              <p className="text-muted-foreground">{t('pricing.legend.desc')}</p>
            </div>
            <div className="card-premium p-8 rounded-3xl flex flex-col items-center text-center opacity-80">
              <h3 className="text-xl font-bold mb-2">{t('pricing.business.name')}</h3>
              <div className="text-3xl font-black mb-4 text-muted-foreground">{t('pricing.business.price')}</div>
              <p className="text-muted-foreground">{t('pricing.business.desc')}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
