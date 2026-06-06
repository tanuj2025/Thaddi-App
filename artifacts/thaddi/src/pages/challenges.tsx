import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Link } from 'wouter';
import { useGetMyChallenges, useDiscoverChallenges } from '@workspace/api-client-react';
import type { ChallengeSummary } from '@workspace/api-client-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Users, Trophy, Search, Swords } from 'lucide-react';

function ChallengeCard({ c }: { c: ChallengeSummary }) {
  const { t } = useI18n();
  return (
    <Link href={`/challenges/${c.id}`}>
      <Card
        className="cursor-pointer transition-all border-border hover:border-primary/50 hover:shadow-md h-full"
        data-testid={`card-challenge-${c.id}`}
      >
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold text-lg truncate">{c.name}</h3>
              {c.ownerDisplayName && (
                <p className="text-xs text-muted-foreground truncate">
                  {t('challenges.hostedBy')} {c.ownerDisplayName}
                </p>
              )}
            </div>
            <Badge variant="secondary" className="shrink-0">{t(`type.${c.type}`)}</Badge>
          </div>
          {c.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
          )}
          <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              {c.participantCount}{c.participantLimit ? `/${c.participantLimit}` : ''}
            </span>
            {c.prizeCount > 0 && (
              <span className="flex items-center gap-1.5 text-amber-500">
                <Trophy className="w-4 h-4" />
                {c.prizeCount} {t('challenges.prizes')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="border-border">
          <CardContent className="p-5 space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ChallengesPage() {
  const { t } = useI18n();
  const { data: mine, isLoading: mineLoading } = useGetMyChallenges();
  const { data: discover, isLoading: discLoading } = useDiscoverChallenges();
  const [q, setQ] = useState('');

  const owned = mine?.owned || [];
  const joined = mine?.joined || [];
  const filteredDiscover = (discover || []).filter((c) =>
    c.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">{t('challenges.title')}</h1>
          <Link href="/challenges/new">
            <Button data-testid="button-create-challenge">
              <Plus className="w-4 h-4 me-2" />
              <span className="hidden sm:inline">{t('challenges.create')}</span>
            </Button>
          </Link>
        </div>

        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine" data-testid="tab-mine">{t('challenges.mine')}</TabsTrigger>
            <TabsTrigger value="discover" data-testid="tab-discover">{t('challenges.discover')}</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="space-y-8 mt-6">
            {mineLoading ? (
              <CardGridSkeleton />
            ) : owned.length === 0 && joined.length === 0 ? (
              <Card className="border-border">
                <CardContent className="py-16 flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Swords className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-muted-foreground max-w-sm">{t('challenges.emptyMine')}</p>
                  <Link href="/challenges/new">
                    <Button data-testid="button-empty-create">
                      <Plus className="w-4 h-4 me-2" />
                      {t('challenges.emptyMineCta')}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <>
                {owned.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      {t('challenges.owned')}
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {owned.map((c) => <ChallengeCard key={c.id} c={c} />)}
                    </div>
                  </section>
                )}
                {joined.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      {t('challenges.joined')}
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {joined.map((c) => <ChallengeCard key={c.id} c={c} />)}
                    </div>
                  </section>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="discover" className="space-y-4 mt-6">
            <div className="relative max-w-md">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('challenges.search')}
                className="ps-9"
                data-testid="input-search-challenges"
              />
            </div>
            {discLoading ? (
              <CardGridSkeleton />
            ) : filteredDiscover.length === 0 ? (
              <Card className="border-border">
                <CardContent className="py-16 flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                    <Search className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground">
                    {q ? t('challenges.noResults') : t('challenges.emptyDiscover')}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {filteredDiscover.map((c) => <ChallengeCard key={c.id} c={c} />)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
