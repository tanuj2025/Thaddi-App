import React from 'react';
import { Link } from 'wouter';
import { useGetSchedule } from '@workspace/api-client-react';
import type { PublicMatch } from '@workspace/api-client-react';
import { useI18n } from '../lib/i18n';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';

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
    <span className="text-xs font-black text-muted-foreground/50 tracking-widest px-2">VS</span>
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

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-4">
        <TeamSide team={m.homeTeam} align="start" />
        <CenterStatus m={m} lang={lang} />
        <TeamSide team={m.awayTeam} align="end" />
      </div>

      <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-center gap-2 text-center">
        {isLive ? (
          <span className="flex items-center gap-1.5 text-sm font-bold text-red-500">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            {t('schedule.live')}
            {m.minute != null && <span dir="ltr">{m.minute}&apos;</span>}
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
  const { data, isLoading } = useGetSchedule();
  const toggleLanguage = () => setLang(lang === 'ar' ? 'en' : 'ar');

  const matches = data?.matches ?? [];

  // Group matches by calendar day (already kickoff-ordered from the API).
  const groups: { key: string; iso: string; matches: PublicMatch[] }[] = [];
  for (const m of matches) {
    const key = dayKey(m.kickoffAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.matches.push(m);
    } else {
      groups.push({ key, iso: m.kickoffAt, matches: [m] });
    }
  }

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col">
      {/* ===== NAV ===== */}
      <header className="border-b border-border bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0" data-testid="link-logo">
            <img src="/logo.svg" alt="THADDI" className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-2 md:gap-3">
            <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5 font-semibold" data-testid="button-lang-toggle">
              <Languages className="w-4 h-4" />
              {lang === 'ar' ? 'English' : 'العربية'}
            </Button>
            <Link href="/sign-up">
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
              <Link href="/sign-up">
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

              {groups.map((group) => (
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
              ))}

              <div className="text-center pt-4">
                <Link href="/sign-up">
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
