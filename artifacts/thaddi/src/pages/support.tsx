import React, { useEffect } from 'react';
import { Link } from 'wouter';
import { useI18n } from '../lib/i18n';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '../components/theme-toggle';
import { ArrowLeft, Languages, Mail, Flag, Ban, Trash2 } from 'lucide-react';

const SECTIONS: { key: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'support.s1', icon: Flag },
  { key: 'support.s2', icon: Ban },
  { key: 'support.s3', icon: Trash2 },
];

export default function SupportPage() {
  const { t, lang, dir, setLang } = useI18n();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const toggleLanguage = () => setLang(lang === 'ar' ? 'en' : 'ar');
  const email = t('legal.contactEmail');

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col" dir={dir}>
      {/* ===== HEADER ===== */}
      <header className="border-b border-border bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 md:h-20 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0" data-testid="link-logo">
            <img src="/logo.png" alt={t('app.name')} className="h-12 sm:h-14 md:h-16 w-auto" />
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
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gold-gradient pb-1" data-testid="text-support-title">
              {t('support.title')}
            </h1>
            <div className="divider-gold h-px w-24 mx-auto mt-6" />
          </div>

          <article className="card-premium rounded-3xl p-6 md:p-10">
            <p className="text-base text-muted-foreground leading-relaxed mb-8">{t('support.intro')}</p>

            {/* ===== CONTACT CARD ===== */}
            <div className="rounded-2xl border border-secondary/30 bg-secondary/5 p-5 md:p-6 mb-10">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/15 text-secondary shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-foreground">{t('support.contactTitle')}</h2>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{t('support.contactDesc')}</p>
                  <a href={`mailto:${email}`} className="mt-4 inline-flex" data-testid="link-support-email">
                    <Button className="gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/90">
                      <Mail className="w-4 h-4" />
                      {t('support.emailCta')}
                    </Button>
                  </a>
                  <p className="mt-3 text-sm font-semibold text-secondary" dir="ltr">{email}</p>
                </div>
              </div>
            </div>

            <div className="space-y-8">
              {SECTIONS.map(({ key, icon: Icon }) => (
                <section key={key} className="flex items-start gap-4" data-testid={`section-${key}`}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg md:text-xl font-bold mb-1.5 text-foreground">{t(`${key}.title`)}</h2>
                    <p className="text-sm md:text-base text-muted-foreground leading-relaxed">{t(`${key}.body`)}</p>
                  </div>
                </section>
              ))}
            </div>
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
          <p className="text-xs text-muted-foreground">{t('app.name')} · {t('landing.footer.rights')}</p>
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
