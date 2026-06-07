import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import {
  useGetMyChallenges,
  useDiscoverChallenges,
  getGetMyChallengesQueryKey,
} from '@workspace/api-client-react';
import type { ChallengeSummary } from '@workspace/api-client-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Users, Trophy, Search, Swords, Star } from 'lucide-react';

function ChallengeCard({ c }: { c: ChallengeSummary }) {
  const { t } = useI18n();
  return (
    <Link href={`/challenges/${c.id}`}>
      <Card
        className="card-premium cursor-pointer transition-all hover:border-secondary/50 hover:shadow-lg h-full group"
        data-testid={`card-challenge-${c.id}`}
      >
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold text-lg truncate group-hover:text-secondary transition-colors">{c.name}</h3>
              {c.ownerDisplayName && (
                <p className="text-xs text-muted-foreground truncate">
                  {t('challenges.hostedBy')} <span className="text-foreground/80">{c.ownerDisplayName}</span>
                </p>
              )}
            </div>
            <Badge variant="secondary" className="shrink-0 bg-secondary/10 text-secondary border border-secondary/20">{t(`type.${c.type}`)}</Badge>
          </div>
          {c.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
          )}
          <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-primary/70" />
              {c.participantCount}{c.participantLimit ? `/${c.participantLimit}` : ''}
            </span>
            {c.prizeCount > 0 && (
              <span className="flex items-center gap-1.5 text-secondary">
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
        <Card key={i} className="card-premium border-border/50">
          <CardContent className="p-5 space-y-3">
            <Skeleton className="h-6 w-2/3 bg-muted/50" />
            <Skeleton className="h-4 w-full bg-muted/50" />
            <Skeleton className="h-4 w-1/2 bg-muted/50" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ChallengesPage() {
  const { t } = useI18n();
  const { isSignedIn } = useUser();
  const { data: mine, isLoading: mineLoading } = useGetMyChallenges({
    query: { enabled: isSignedIn === true, queryKey: getGetMyChallengesQueryKey() },
  });
  const { data: discover, isLoading: discLoading } = useDiscoverChallenges();
  const { data: featured } = useDiscoverChallenges({ featured: true });
  const [q, setQ] = useState('');

  const owned = mine?.owned || [];
  const joined = mine?.joined || [];
  const filteredDiscover = (discover || []).filter((c) =>
    c.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const featuredList = featured || [];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-gold-gradient">{t('challenges.title')}</h1>
          <Link href="/challenges/new">
            <Button className="glow-green" data-testid="button-create-challenge">
              <Plus className="w-4 h-4 me-2" />
              <span className="hidden sm:inline">{t('challenges.create')}</span>
            </Button>
          </Link>
        </div>

        <Tabs defaultValue={isSignedIn ? 'mine' : 'discover'}>
          <TabsList className="bg-card/50 border border-border/50 p-1">
            {isSignedIn && (
              <TabsTrigger value="mine" data-testid="tab-mine" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">{t('challenges.mine')}</TabsTrigger>
            )}
            <TabsTrigger value="discover" data-testid="tab-discover" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">{t('challenges.discover')}</TabsTrigger>
          </TabsList>

          {isSignedIn && (
          <TabsContent value="mine" className="space-y-8 mt-6">
            {mineLoading ? (
              <CardGridSkeleton />
            ) : owned.length === 0 && joined.length === 0 ? (
              <Card className="card-premium border-border/50 border-dashed">
                <CardContent className="py-16 flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center glow-green">
                    <Swords className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-muted-foreground max-w-sm">{t('challenges.emptyMine')}</p>
                  <Link href="/challenges/new">
                    <Button data-testid="button-empty-create" className="glow-green">
                      <Plus className="w-4 h-4 me-2" />
                      {t('challenges.emptyMineCta')}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <>
                {owned.length > 0 && (
                  <section className="space-y-4">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary uppercase tracking-wide">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary"></div>
                      {t('challenges.owned')}
                    </h2>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {owned.map((c) => <ChallengeCard key={c.id} c={c} />)}
                    </div>
                  </section>
                )}
                {owned.length > 0 && joined.length > 0 && <div className="divider-gold h-px w-full my-6 opacity-30" />}
                {joined.length > 0 && (
                  <section className="space-y-4">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-primary uppercase tracking-wide">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
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
          )}

          <TabsContent value="discover" className="space-y-6 mt-6">
            {!q && featuredList.length > 0 && (
              <section className="space-y-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-secondary uppercase tracking-wide">
                  <Star className="w-4 h-4 text-secondary fill-secondary/20" />
                  {t('challenges.featured')}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {featuredList.map((c) => <ChallengeCard key={c.id} c={c} />)}
                </div>
              </section>
            )}
            
            {featuredList.length > 0 && !q && <div className="divider-gold h-px w-full my-6 opacity-30" />}

            <div className="relative max-w-md">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('challenges.search')}
                className="ps-9 bg-card/50 border-border/50 focus-visible:ring-secondary/50 focus-visible:border-secondary/50"
                data-testid="input-search-challenges"
              />
            </div>
            {discLoading ? (
              <CardGridSkeleton />
            ) : filteredDiscover.length === 0 ? (
              <Card className="card-premium border-border/50 border-dashed">
                <CardContent className="py-16 flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
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
