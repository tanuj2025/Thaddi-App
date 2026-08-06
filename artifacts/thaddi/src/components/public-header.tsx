import { Link } from 'wouter';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from './theme-toggle';
import { useI18n } from '../lib/i18n';

export function PublicHeader({ children }: { children?: React.ReactNode }) {
  const { t, lang, setLang } = useI18n();

  const toggleLanguage = () => setLang(lang === 'ar' ? 'en' : 'ar');

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="container mx-auto px-4 h-14 md:h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0" data-testid="link-logo">
          <img src="/logo.png" alt={t('app.name')} className="h-9 sm:h-11 md:h-12 w-auto" />
        </Link>

        <div className="flex items-center gap-2 md:gap-3">
          {children}
          <ThemeToggle testId="button-theme-toggle-nav" />
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLanguage}
            className="gap-1.5 font-semibold"
            data-testid="button-lang-toggle"
          >
            <Languages className="w-4 h-4" />
            {lang === 'ar' ? 'English' : 'العربية'}
          </Button>
        </div>
      </div>
    </header>
  );
}
