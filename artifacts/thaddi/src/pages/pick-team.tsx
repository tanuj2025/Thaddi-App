import React, { useState, useMemo } from 'react';
import { useI18n } from '../lib/i18n';
import { useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import {
  useGetTeams,
  useUpdateFavoriteTeam,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Search, LogOut, Check, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function PickTeamPage() {
  const { t, lang, dir } = useI18n();
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetTeams();
  const mutation = useUpdateFavoriteTeam();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const teams = data?.teams ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return teams;
    const q = query.toLowerCase();
    return teams.filter(
      (team) => team.nameEn.toLowerCase().includes(q) || team.nameAr.includes(query),
    );
  }, [teams, query]);

  const handleSave = () => {
    if (!selectedId) return;
    mutation.mutate(
      { data: { teamId: selectedId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          setLocation('/');
        },
        onError: () => {
          toast({ title: t('account.changeError'), variant: 'destructive' });
        },
      },
    );
  };

  return (
    <div
      className="min-h-[100dvh] bg-stadium flex flex-col"
      dir={dir}
    >
      <header className="h-16 border-b border-border bg-card/80 backdrop-blur-xl flex items-center justify-between px-4 sticky top-0 z-40">
        <img src="/logo.png" alt={t('app.name')} className="h-14" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ redirectUrl: '/' })}
          className="text-muted-foreground"
        >
          <LogOut className="w-4 h-4 me-2" />
          {t('auth.signOut')}
        </Button>
      </header>

      <main className="flex-1 flex flex-col items-center px-4 py-8 gap-6">
        <Card className="w-full max-w-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{t('pickTeam.title')}</CardTitle>
            <CardDescription>{t('pickTeam.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('pickTeam.search')}
                className="ps-9"
                dir={dir}
              />
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="ms-2 text-sm text-muted-foreground">{t('pickTeam.loading')}</span>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                {t('pickTeam.noResults')}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[50vh] overflow-y-auto pe-1">
                {filtered.map((team) => {
                  const isSelected = team.id === selectedId;
                  const name = lang === 'ar' ? team.nameAr : team.nameEn;
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => setSelectedId(team.id)}
                      className={`relative flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-all cursor-pointer ${
                        isSelected
                          ? 'border-primary bg-primary/10 ring-1 ring-primary shadow-sm'
                          : 'border-border bg-card hover:border-primary/40 hover:bg-accent'
                      }`}
                    >
                      {isSelected && (
                        <span className="absolute top-1.5 end-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                          <Check className="w-2.5 h-2.5 text-primary-foreground" />
                        </span>
                      )}
                      {team.flagUrl ? (
                        <img
                          src={team.flagUrl}
                          alt={name}
                          className="w-10 h-7 rounded-sm object-cover"
                        />
                      ) : (
                        <Shield className="w-10 h-7 text-muted-foreground/50" />
                      )}
                      <span className="text-xs font-medium leading-tight line-clamp-2">
                        {name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <Button
              onClick={handleSave}
              disabled={!selectedId || mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin me-2" />
                  {t('pickTeam.saving')}
                </>
              ) : !selectedId ? (
                t('pickTeam.chooseFirst')
              ) : (
                t('pickTeam.save')
              )}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
