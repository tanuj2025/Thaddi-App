import React, { useState, useMemo } from 'react';
import { useI18n } from '../lib/i18n';
import { useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import {
  useGetMe,
  useGetClubs,
  useUpdateFavoriteClub,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Search, LogOut, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function PickClubPage() {
  const { t, lang, dir } = useI18n();
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetClubs();
  const { data: me } = useGetMe();
  const mutation = useUpdateFavoriteClub();
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const groups = data?.groups ?? [];
  const currentClubId = me?.favoriteClub?.id ?? null;
  // When the user already has a club, this screen acts as a "change club" flow:
  // it returns to the profile afterwards instead of the onboarding exit.
  const isChange = Boolean(me?.favoriteClub);
  const skipTo = isChange ? '/profile' : '/';

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        clubs: q
          ? g.clubs.filter(
              (c) => c.nameEn.toLowerCase().includes(q) || c.nameAr.includes(query),
            )
          : g.clubs,
      }))
      .filter((g) => g.clubs.length > 0);
  }, [groups, query]);

  const handleTap = (clubId: string) => {
    if (mutation.isPending) return;
    setPendingId(clubId);
    mutation.mutate(
      { data: { teamId: clubId } },
      {
        onSuccess: (updatedUser) => {
          // Seed the /me cache so any club-aware UI updates without a refetch.
          queryClient.setQueryData(getGetMeQueryKey(), updatedUser);
          if (isChange) {
            toast({ title: t('pickClub.changeSuccess') });
            setLocation('/profile');
          } else {
            setLocation('/');
          }
        },
        onError: () => {
          setPendingId(null);
          toast({ title: t('account.changeError'), variant: 'destructive' });
        },
      },
    );
  };

  const hasResults = filteredGroups.length > 0;

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col" dir={dir}>
      <header className="h-16 border-b border-border bg-card/80 backdrop-blur-xl flex items-center justify-between px-4 sticky top-0 z-40">
        <img src="/logo.png" alt={t('app.name')} className="h-14" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ redirectUrl: '/' })}
          className="text-muted-foreground"
          disabled={mutation.isPending}
        >
          <LogOut className="w-4 h-4 me-2" />
          {t('auth.signOut')}
        </Button>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-8 gap-6">
        <Card className="w-full max-w-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{isChange ? t('pickClub.changeTitle') : t('pickClub.title')}</CardTitle>
            <CardDescription>{isChange ? t('pickClub.changeSubtitle') : t('pickClub.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('pickClub.search')}
                className="ps-9"
                dir={dir}
                disabled={mutation.isPending}
              />
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ms-2 text-sm text-muted-foreground">{t('pickClub.loading')}</span>
              </div>
            ) : !hasResults ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                {t('pickClub.noResults')}
              </p>
            ) : (
              <div className="space-y-6 max-h-[50vh] overflow-y-auto pe-1">
                {filteredGroups.map((group) => (
                  <div
                    key={`${group.competitionSlug ?? group.nameEn}-${group.displayOrder}`}
                    className="space-y-2"
                  >
                    <h3 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {lang === 'ar' ? group.nameAr : group.nameEn}
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {group.clubs.map((club) => {
                        const isSaving = club.id === pendingId && mutation.isPending;
                        const isCurrent = club.id === currentClubId;
                        const name = lang === 'ar' ? club.nameAr : club.nameEn;
                        return (
                          <button
                            key={club.id}
                            type="button"
                            onClick={() => handleTap(club.id)}
                            disabled={mutation.isPending}
                            className={`relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all ${
                              isSaving
                                ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-sm cursor-wait'
                                : mutation.isPending
                                ? 'border-border bg-card opacity-50 cursor-not-allowed'
                                : isCurrent
                                ? 'border-secondary bg-secondary/10 ring-1 ring-secondary/40 hover:border-secondary cursor-pointer'
                                : 'border-border bg-card hover:border-primary/40 hover:bg-accent cursor-pointer'
                            }`}
                          >
                            {isSaving && (
                              <span className="absolute top-1.5 end-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                                <Loader2 className="w-2.5 h-2.5 animate-spin text-primary-foreground" />
                              </span>
                            )}
                            {isCurrent && !isSaving && (
                              <span className="absolute top-1.5 start-1.5 rounded-full bg-secondary/20 px-1.5 py-0.5 text-[9px] font-bold text-secondary">
                                {t('pickClub.current')}
                              </span>
                            )}
                            {club.crestUrl ? (
                              <img
                                src={club.crestUrl}
                                alt={name}
                                className="w-10 h-10 object-contain"
                              />
                            ) : (
                              <Shield className="w-10 h-10 text-muted-foreground/50" />
                            )}
                            <span className="text-xs font-medium leading-tight line-clamp-2">
                              {name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-center pt-2">
              <Button
                variant="ghost"
                onClick={() => setLocation(skipTo)}
                disabled={mutation.isPending}
                className="text-muted-foreground hover:text-foreground"
                data-testid="button-skip-club"
              >
                {isChange ? t('common.cancel') : t('pickClub.skip')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
