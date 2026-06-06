import React from 'react';
import { useI18n } from '../lib/i18n';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Trophy, Home, Swords, User, CalendarDays, LogOut, Languages } from 'lucide-react';
import { useGetMe } from '@workspace/api-client-react';
import { useClerk } from '@clerk/react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type AccountMenuProps = {
  align?: 'start' | 'end';
  me?: { displayName?: string | null; username?: string | null; avatarUrl?: string | null } | null;
  t: (key: string) => string;
  lang: string;
  onToggleLanguage: () => void;
  onSignOut: () => void;
};

function AccountMenu({ align = 'start', me, t, lang, onToggleLanguage, onSignOut }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex items-center gap-2 px-2 h-auto py-2"
          data-testid="button-account-menu"
        >
          <Avatar className="w-8 h-8">
            <AvatarImage src={me?.avatarUrl || ''} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm">
              {me?.displayName?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="hidden md:flex flex-col items-start leading-tight max-w-[8rem]">
            <span className="text-sm font-semibold truncate w-full">
              {me?.displayName || t('common.account')}
            </span>
            {me?.username && (
              <span className="text-xs text-muted-foreground truncate w-full" dir="ltr">
                @{me.username}
              </span>
            )}
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56">
        <DropdownMenuLabel>{me?.displayName || t('common.account')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Link href="/profile">
          <DropdownMenuItem className="cursor-pointer" data-testid="menu-profile">
            <User className="w-4 h-4 me-2" />
            {t('nav.profile')}
          </DropdownMenuItem>
        </Link>
        <DropdownMenuItem className="cursor-pointer" onClick={onToggleLanguage} data-testid="menu-lang">
          <Languages className="w-4 h-4 me-2" />
          {lang === 'ar' ? 'English' : 'العربية'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-destructive focus:text-destructive"
          onClick={onSignOut}
          data-testid="menu-signout"
        >
          <LogOut className="w-4 h-4 me-2" />
          {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const [location] = useLocation();
  const { data: me } = useGetMe();
  const { signOut } = useClerk();

  const toggleLanguage = () => {
    setLang(lang === 'ar' ? 'en' : 'ar');
  };

  const navItems = [
    { href: '/home', icon: Home, label: 'nav.home' },
    { href: '/challenges', icon: Swords, label: 'nav.challenges' },
    { href: '/rankings', icon: Trophy, label: 'nav.rankings' },
    { href: '/matches', icon: CalendarDays, label: 'nav.matches' },
    { href: '/profile', icon: User, label: 'nav.profile' },
  ];

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-e border-border bg-card fixed inset-y-0 z-50">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <img src="/logo.svg" alt="THADDI" className="h-8" />
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-bold'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground font-medium'
                }`}>
                  <item.icon className="w-5 h-5" />
                  <span>{t(item.label)}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border space-y-2">
          <AccountMenu me={me} t={t} lang={lang} onToggleLanguage={toggleLanguage} onSignOut={() => signOut()} />
          <Button variant="ghost" onClick={toggleLanguage} className="w-full justify-start font-semibold">
            <Languages className="w-4 h-4 me-2" />
            {lang === 'ar' ? 'English' : 'العربية'}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ms-64 pb-20 md:pb-0 min-h-[100dvh]">
        {/* Mobile Header */}
        <header className="md:hidden h-16 border-b border-border bg-card flex items-center justify-between px-4 sticky top-0 z-40">
          <img src="/logo.svg" alt="THADDI" className="h-8" />
          <AccountMenu align="end" me={me} t={t} lang={lang} onToggleLanguage={toggleLanguage} onSignOut={() => signOut()} />
        </header>

        <main className="flex-1 p-4 md:p-8">
          <div className="max-w-6xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-card border-t border-border flex items-center justify-around px-2 pb-safe z-50">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div className={`flex flex-col items-center justify-center w-16 h-full cursor-pointer transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}>
                <item.icon className={`w-5 h-5 mb-1 ${isActive ? 'fill-primary/20' : ''}`} />
                <span className="text-[10px] font-medium">{t(item.label)}</span>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
