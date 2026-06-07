import React from 'react';
import { useI18n } from '../../lib/i18n';
import { Link, useLocation, Redirect } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Trophy,
  CalendarDays,
  Users,
  Swords,
  CreditCard,
  ScrollText,
  Languages,
  ArrowLeft,
  ArrowRight,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { useGetMe } from '@workspace/api-client-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const adminNav = [
  { href: '/admin', icon: LayoutDashboard, label: 'admin.nav.overview', exact: true },
  { href: '/admin/tournaments', icon: Trophy, label: 'admin.nav.tournaments' },
  { href: '/admin/matches', icon: CalendarDays, label: 'admin.nav.matches' },
  { href: '/admin/teams', icon: Shield, label: 'admin.nav.teams' },
  { href: '/admin/users', icon: Users, label: 'admin.nav.users' },
  { href: '/admin/challenges', icon: Swords, label: 'admin.nav.challenges' },
  { href: '/admin/subscriptions', icon: CreditCard, label: 'admin.nav.subscriptions' },
  { href: '/admin/audit', icon: ScrollText, label: 'admin.nav.audit' },
];

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading, isError } = useGetMe();
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background text-muted-foreground">
        {t('admin.common.loading')}
      </div>
    );
  }

  if (isError || !me) {
    return <Redirect to="/sign-in" />;
  }

  // Non-admins (including admins whose account was just suspended/demoted) are
  // redirected away from the admin section rather than shown a denial page.
  if (me.role !== 'admin') {
    return <Redirect to="/home" />;
  }

  return <>{children}</>;
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t, lang, setLang, dir } = useI18n();
  const [location] = useLocation();

  const toggleLanguage = () => setLang(lang === 'ar' ? 'en' : 'ar');
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;

  const isActive = (href: string, exact?: boolean) =>
    exact ? location === href : location === href || location.startsWith(href + '/');

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col md:flex-row">
      <aside className="hidden md:flex flex-col w-64 border-e border-border bg-card/70 backdrop-blur-xl fixed inset-y-0 z-50">
        <div className="h-16 flex items-center gap-2 px-6 border-b border-border">
          <ShieldAlert className="w-5 h-5 text-secondary" />
          <span className="font-bold text-lg">{t('admin.title')}</span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {adminNav.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  data-testid={`link-admin-${item.label}`}
                  className={`relative flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-all ${
                    active
                      ? 'bg-primary/15 text-primary font-bold shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.3)] before:absolute before:inset-y-1.5 before:start-0 before:w-1 before:rounded-full before:bg-secondary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground font-medium'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{t(item.label)}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border space-y-2">
          <Link href="/home">
            <Button variant="outline" className="w-full justify-start" data-testid="button-back-to-app">
              <BackIcon className="w-4 h-4 me-2" />
              {t('admin.backToApp')}
            </Button>
          </Link>
          <Button
            variant="ghost"
            onClick={toggleLanguage}
            className="w-full justify-start font-semibold"
            data-testid="button-admin-lang"
          >
            <Languages className="w-4 h-4 me-2" />
            {lang === 'ar' ? 'English' : 'العربية'}
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col md:ms-64 min-h-[100dvh]">
        <header className="h-16 border-b border-border bg-card/80 backdrop-blur-xl flex items-center justify-between px-4 sticky top-0 z-40">
          <div className="flex items-center gap-2 md:hidden">
            <ShieldAlert className="w-5 h-5 text-secondary" />
            <span className="font-bold">{t('admin.title')}</span>
          </div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-1">
            <Link href="/home">
              <Button variant="ghost" size="sm" data-testid="button-back-to-app-mobile">
                <BackIcon className="w-4 h-4 me-1" />
                <span className="hidden sm:inline">{t('admin.backToApp')}</span>
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={toggleLanguage} data-testid="button-admin-lang-mobile">
              <Languages className="w-4 h-4" />
            </Button>
          </div>
        </header>

        {/* Mobile nav */}
        <nav className="md:hidden flex gap-1 overflow-x-auto border-b border-border bg-card/80 backdrop-blur-xl px-2 py-2">
          {adminNav.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap text-sm transition-colors ${
                    active ? 'bg-primary/15 text-primary font-bold shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.3)]' : 'text-muted-foreground'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{t(item.label)}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <main className="flex-1 p-4 md:p-8">
          <div className="max-w-6xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function AdminPage({ children }: { children: React.ReactNode }) {
  const { dir } = useI18n();
  return (
    <AdminGate>
      <div dir={dir}>
        <AdminLayout>{children}</AdminLayout>
      </div>
    </AdminGate>
  );
}
