import React, { useEffect } from 'react';
import { Link } from 'wouter';
import { useGetSchedule, getGetScheduleQueryKey, useTrackPageView } from '@workspace/api-client-react';
import type { PublicMatch, PublicSchedule } from '@workspace/api-client-react';
import { useI18n } from '../lib/i18n';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '../components/theme-toggle';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  useCountdown,
  formatCountdown,
  formatKickoff,
  formatNum,
  localeOf,
  type Lang,
} from '../lib/matchUtils';
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Flag,
  Languages,
  Plus,
  Trophy,
  Filter,
  Search,
  X,
} from 'lucide-react';

const STAGE_ORDER = [
  'group',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
];

function TeamSide({ team, align }: { team?: PublicMatch['homeTeam']; align: 'start' | 'end' }) {
  const { lang } = useI18n();
  const name = team ? (lang === 'ar' ? team.nameAr : team.nameEn) : '—';
  return (
    <div className={`flex items-center gap-2 min-w-0 flex-1 ${align === 'end' ? 'flex-row-reverse text-end' : ''}`}>
      {team?.flagUrl ? (
        <img src={team.flagUrl} alt="" className="w-8 h-6 rounded-sm object-cover shrink-0 ring-1 ring-border" />
      ) : (
        <div className="w-8 h-6 rounded-sm bg-muted shrink-0 flex items-center justify-center ring-1 ring-border">
          <Flag className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      )}
      <span className="font-bold truncate text-sm md:text-base">{name}</span>
    </div>
  );
}

function CenterStatus({ m, lang }: { m: PublicMatch; lang: Lang }) {
  const { t } = useI18n();
  const isLive = m.status === 'live' || m.status === 'half_time';
  const isFinished = m.status === 'finished' || m.status === 'full_time';

  if (isLive || isFinished || m.hasKickedOff) {
    return (
      <div className="flex flex-col items-center px-2">
        <div className="flex items-center gap-2 text-2xl font-black tabular-nums" dir="ltr">
          <span>{formatNum(m.homeScore ?? 0, lang)}</span>
          <span className="text-muted-foreground/50 text-lg">-</span>
          <span>{formatNum(m.awayScore ?? 0, lang)}</span>
        </div>
      </div>
    );
  }

  return (
    <span className="text-xs font-black text-muted-foreground/50 tracking-widest px-2">{t('common.vs')}</span>
  );
}

function MatchRow({ m, lang }: { m: PublicMatch; lang: Lang }) {
  const { t } = useI18n();
  const cd = useCountdown(m.hasKickedOff ? null : m.kickoffAt);
  const stageLabel = m.stageType ? t(`stage.${m.stageType}`) : '';
  const isLive = m.status === 'live' || m.status === 'half_time';
  const isFinished = m.status === 'finished' || m.status === 'full_time';

  return (
    <div className="card-premium rounded-2xl p-5 hover:ring-1 hover:ring-secondary/30 transition-all" data-testid={`schedule-match-${m.id}`}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className="text-xs font-semibold tracking-wider uppercase text-secondary/80 truncate">
          {stageLabel}
          {m.venue ? ` · ${m.venue}` : ''}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium shrink-0">
          <CalendarClock className="w-3.5 h-3.5 opacity-70" />
          {formatKickoff(m.kickoffAt, lang)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-4" dir="ltr">
        <TeamSide team={m.homeTeam} align="start" />
        <CenterStatus m={m} lang={lang} />
        <TeamSide team={m.awayTeam} align="end" />
      </div>

      <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-center gap-2 text-center">
        {isLive ? (
          <span className="flex items-center gap-1.5 text-sm font-bold text-red-500">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            {t('schedule.live')}
            {m.minute != null && <span dir="ltr">{formatNum(m.minute, lang)}&apos;</span>}
          </span>
        ) : isFinished || m.hasKickedOff ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('schedule.finished')}
          </span>
        ) : cd && !cd.done ? (
          <>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('schedule.kicksOff')}</span>
            <span className="text-sm font-bold text-primary tabular-nums" dir="ltr">
              {formatCountdown(cd, lang, {
                days: t('match.days'),
                hours: t('match.hours'),
                minutes: t('match.minutes'),
                seconds: t('match.seconds'),
              })}
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-sm font-bold text-red-500">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            {t('landing.upcoming.live')}
          </span>
        )}
      </div>
    </div>
  );
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayHeading(iso: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(localeOf(lang), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function SchedulePage() {
  const { t, lang, setLang } = useI18n();
  const trackPageView = useTrackPageView();
  useEffect(() => {
    let sid: string | null = null;
    try {
      sid = sessionStorage.getItem('thaddi_sid');
      if (!sid) {
        sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem('thaddi_sid', sid);
      }
    } catch { /* sessionStorage unavailable (private browsing, test env) */ }
    trackPageView.mutate({ data: { path: '/schedule', referrer: document.referrer || null, sessionId: sid } });
  }, []);
  const { data, isLoading } = useGetSchedule({
    query: {
      queryKey: getGetScheduleQueryKey(),
      refetchInterval: (q) => {
        const matches = (q.state.data as PublicSchedule | undefined)?.matches ?? [];
        const hasLive = matches.some((m) => m.status === 'live' || m.status === 'half_time');
        // Poll fast while a match is live, slower otherwise so upcoming
        // matches still transition to live without a manual reload.
        return hasLive ? 15000 : 60000;
      },
      refetchIntervalInBackground: false,
    },
  });
  const toggleLanguage = () => setLang(lang === 'ar' ? 'en' : 'ar');

  const [stageFilter, setStageFilter] = React.useState('all');
  const [teamFilter, setTeamFilter] = React.useState('all');
  const [searchQuery, setSearchQuery] = React.useState('');

  const matches = data?.matches ?? [];

  // Stage options present in the schedule, in canonical tournament order.
  const stageOptions = React.useMemo(() => {
    const present = new Set<string>();
    for (const m of matches) {
      if (m.stageType) present.add(m.stageType);
    }
    return STAGE_ORDER.filter((s) => present.has(s));
  }, [matches]);

  // Team options present in the schedule, de-duplicated and sorted by localized name.
  const teamOptions = React.useMemo(() => {
    const byId = new Map<string, PublicMatch['homeTeam']>();
    for (const m of matches) {
      if (m.homeTeam) byId.set(m.homeTeam.id, m.homeTeam);
      if (m.awayTeam) byId.set(m.awayTeam.id, m.awayTeam);
    }
    return Array.from(byId.values())
      .filter((tm): tm is NonNullable<typeof tm> => tm != null)
      .sort((a, b) =>
        (lang === 'ar' ? a.nameAr : a.nameEn).localeCompare(
          lang === 'ar' ? b.nameAr : b.nameEn,
          localeOf(lang),
        ),
      );
  }, [matches, lang]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const hasFilters = stageFilter !== 'all' || teamFilter !== 'all' || trimmedQuery !== '';

  const filteredMatches = React.useMemo(
    () =>
      matches.filter((m) => {
        if (stageFilter !== 'all' && m.stageType !== stageFilter) return false;
        if (
          teamFilter !== 'all' &&
          m.homeTeam?.id !== teamFilter &&
          m.awayTeam?.id !== teamFilter
        ) {
          return false;
        }
        if (trimmedQuery !== '') {
          const teamName = (tm: PublicMatch['homeTeam']) =>
            (tm ? (lang === 'ar' ? tm.nameAr : tm.nameEn) : '').toLowerCase();
          if (
            !teamName(m.homeTeam).includes(trimmedQuery) &&
            !teamName(m.awayTeam).includes(trimmedQuery)
          ) {
            return false;
          }
        }
        return true;
      }),
    [matches, stageFilter, teamFilter, trimmedQuery, lang],
  );

  // Group matches by calendar day (already kickoff-ordered from the API).
  const groups: { key: string; iso: string; matches: PublicMatch[] }[] = [];
  for (const m of filteredMatches) {
    const key = dayKey(m.kickoffAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.matches.push(m);
    } else {
      groups.push({ key, iso: m.kickoffAt, matches: [m] });
    }
  }

  const clearFilters = () => {
    setStageFilter('all');
    setTeamFilter('all');
    setSearchQuery('');
  };

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col">
      {/* ===== NAV ===== */}
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
            <Link href="/sign-in">
              <Button size="sm" className="bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-gold gap-1.5" data-testid="button-signup-header">
                <Plus className="w-4 h-4" />
                <span>{t('landing.nav.createFree')}</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-10 md:py-14">
        <div className="container mx-auto max-w-4xl">
          <div className="mb-8">
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-secondary transition-colors mb-4" data-testid="link-back-home">
              <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
              {t('schedule.backHome')}
            </Link>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gold-gradient pb-1">{t('schedule.title')}</h1>
            <p className="text-base md:text-lg text-muted-foreground mt-2">{t('schedule.subtitle')}</p>
            <div className="divider-gold h-px w-24 mt-5" />
          </div>

          {isLoading ? (
            <div className="space-y-8">
              {[0, 1].map((g) => (
                <div key={g} className="space-y-4">
                  <div className="h-5 w-40 bg-muted rounded animate-pulse" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[0, 1].map((i) => (
                      <div key={i} className="card-premium rounded-2xl p-5 space-y-4 animate-pulse">
                        <div className="h-3 w-1/3 bg-muted rounded" />
                        <div className="h-6 w-full bg-muted rounded" />
                        <div className="h-4 w-2/3 bg-muted rounded mx-auto" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : matches.length === 0 ? (
            <div className="card-premium rounded-3xl py-16 flex flex-col items-center text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                <CalendarDays className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium max-w-sm">{t('schedule.tba')}</p>
              <Link href="/sign-in">
                <Button className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 glow-green gap-2 mt-2" data-testid="button-schedule-cta-empty">
                  <Plus className="w-4 h-4" />
                  {t('schedule.cta')}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-10">
              {data?.scheduleState === 'finished' && (
                <div className="card-premium rounded-2xl px-5 py-4 flex items-center gap-3 ring-1 ring-secondary/30" data-testid="banner-finished">
                  <Trophy className="w-5 h-5 text-secondary shrink-0" />
                  <p className="text-sm font-semibold">{t('schedule.finishedBanner')}</p>
                </div>
              )}

              {/* ===== FILTERS ===== */}
              <div className="card-premium rounded-2xl p-4 flex flex-col sm:flex-row sm:items-end gap-3" data-testid="schedule-filters">
                <div className="flex items-center gap-2 text-sm font-semibold text-secondary/90 sm:self-center">
                  <Filter className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('schedule.searchTeam')}</label>
                  <div className="relative">
                    <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t('schedule.searchPlaceholder')}
                      className="bg-background/50 ps-9 focus-visible:ring-secondary"
                      data-testid="input-search-team"
                    />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('schedule.filterStage')}</label>
                  <Select value={stageFilter} onValueChange={setStageFilter}>
                    <SelectTrigger className="bg-background/50 focus:ring-secondary" data-testid="select-filter-stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('schedule.allStages')}</SelectItem>
                      {stageOptions.map((s) => (
                        <SelectItem key={s} value={s}>{t(`stage.${s}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">{t('schedule.filterTeam')}</label>
                  <Select value={teamFilter} onValueChange={setTeamFilter}>
                    <SelectTrigger className="bg-background/50 focus:ring-secondary" data-testid="select-filter-team">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('schedule.allTeams')}</SelectItem>
                      {teamOptions.map((tm) => (
                        <SelectItem key={tm.id} value={tm.id}>{lang === 'ar' ? tm.nameAr : tm.nameEn}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="gap-1.5 font-semibold text-muted-foreground hover:text-foreground shrink-0"
                    data-testid="button-clear-filters"
                  >
                    <X className="w-4 h-4" />
                    {t('schedule.clearFilters')}
                  </Button>
                )}
              </div>

              {groups.length === 0 ? (
                <div className="card-premium rounded-3xl py-16 flex flex-col items-center text-center gap-4" data-testid="schedule-no-filtered">
                  <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                    <CalendarDays className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground font-medium max-w-sm">{t('schedule.noFiltered')}</p>
                  <Button
                    variant="outline"
                    onClick={clearFilters}
                    className="rounded-full gap-2 mt-2"
                    data-testid="button-clear-filters-empty"
                  >
                    <X className="w-4 h-4" />
                    {t('schedule.clearFilters')}
                  </Button>
                </div>
              ) : (
                groups.map((group) => (
                <section key={group.key} data-testid={`schedule-day-${group.key}`}>
                  <div className="flex items-center gap-3 mb-4">
                    <CalendarDays className="w-5 h-5 text-secondary shrink-0" />
                    <h2 className="text-lg md:text-xl font-black tracking-tight">{formatDayHeading(group.iso, lang)}</h2>
                    <span className="text-xs font-medium text-muted-foreground">
                      {formatNum(group.matches.length, lang)} {t('schedule.matchCount')}
                    </span>
                    <div className="flex-1 h-px bg-border/40" />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {group.matches.map((m) => (
                      <MatchRow key={m.id} m={m} lang={lang} />
                    ))}
                  </div>
                </section>
                ))
              )}

              <div className="text-center pt-4">
                <Link href="/sign-in">
                  <Button size="lg" className="rounded-full text-lg px-8 py-6 bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-gold gap-2" data-testid="button-schedule-cta">
                    <Plus className="w-5 h-5" />
                    {t('schedule.cta')}
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
