import React, { useEffect } from 'react';
import { Link } from 'wouter';
import { useI18n } from '../lib/i18n';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '../components/theme-toggle';
import { ArrowLeft, Languages, Mail } from 'lucide-react';

export interface LegalSection {
  title: string;
  body: string;
}

export function LegalPage({
  titleKey,
  introKey,
  sectionKeys,
}: {
  titleKey: string;
  introKey: string;
  sectionKeys: string[];
}) {
  const { t, lang, dir, setLang } = useI18n();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const toggleLanguage = () => setLang(lang === 'ar' ? 'en' : 'ar');

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col" dir={dir}>
      {/* ===== HEADER ===== */}
      <header className="border-b border-border bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 md:h-20 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0" data-testid="link-logo">
            <img src="/logo.png" alt="THADDI" className="h-12 sm:h-14 md:h-16 w-auto" />
          </Link>
          <div className="flex items-center gap-2 md:gap-3">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5 font-semibold" data-testid="button-lang-toggle">
              <Languages className="w-4 h-4" />
              {lang === 'ar' ? 'English' : 'العربية'}
            </Button>
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5 bg-card/50 border-secondary/30 hover:bg-secondary/10 hover:text-secondary" data-testid="button-back-home">
                <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                <span className="hidden sm:inline">{t('legal.backHome')}</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-12 md:py-16">
        <div className="container mx-auto max-w-3xl">
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gold-gradient pb-1" data-testid="text-legal-title">
              {t(titleKey)}
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-3">{t('legal.lastUpdated')}</p>
            <div className="divider-gold h-px w-24 mx-auto mt-6" />
          </div>

          <article className="card-premium rounded-3xl p-6 md:p-10">
            <p className="text-base text-muted-foreground leading-relaxed mb-8">{t(introKey)}</p>

            <div className="space-y-8">
              {sectionKeys.map((key) => (
                <section key={key} data-testid={`section-${key}`}>
                  <h2 className="text-lg md:text-xl font-bold mb-2 text-foreground">{t(`${key}.title`)}</h2>
                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed">{t(`${key}.body`)}</p>
                </section>
              ))}
            </div>

            <div className="divider-gold h-px w-full mt-10 mb-6" />
            <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5">
              <Mail className="w-4 h-4 text-secondary shrink-0" />
              {t('legal.questions')}{' '}
              <a href={`mailto:${t('legal.contactEmail')}`} className="font-semibold text-secondary hover:underline" dir="ltr">
                {t('legal.contactEmail')}
              </a>
            </p>
          </article>

          <div className="text-center mt-8">
            <Link href="/">
              <Button variant="ghost" className="gap-1.5 text-muted-foreground hover:text-secondary" data-testid="button-back-home-bottom">
                <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                {t('legal.backHome')}
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-border bg-card/60 backdrop-blur-xl px-4 py-8">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">THADDI · {t('landing.footer.rights')}</p>
          <nav className="flex items-center gap-x-6">
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-secondary transition-colors" data-testid="link-footer-terms">
              {t('landing.footer.terms')}
            </Link>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-secondary transition-colors" data-testid="link-footer-privacy">
              {t('landing.footer.privacy')}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
