import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView } from 'framer-motion';
import { useI18n } from '../lib/i18n';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import {
  useGetPlatformStats,
  useGetUpcomingMatches,
  getGetUpcomingMatchesQueryKey,
  useGetCompetitionRanking,
  getGetCompetitionRankingQueryKey,
  useTrackAnalyticsEvent,
  useTrackPageView,
  useGetClubs,
  type ClubGroup,
  type ClubRef,
  type RankingEntry,
  type UpcomingMatch,
  type UpcomingMatches,
  type Competition,
} from '@workspace/api-client-react';
import { useCompetition, labelCompetition } from '../lib/competition';
import { CompetitionSwitcher } from '../components/competition-switcher';
import { Leaderboard } from '../components/leaderboard';
import { ThemeToggle } from '../components/theme-toggle';
import { useCountdown, formatCountdown, formatKickoff, formatNum, type Lang } from '../lib/matchUtils';
import { SiWhatsapp, SiX, SiTiktok } from 'react-icons/si';
import {
  Trophy,
  Users,
  Share2,
  Activity,
  Shield,
  ShieldCheck,
  Infinity as InfinityIcon,
  Languages,
  Plus,
  ArrowRight,
  Check,
  ChevronDown,
  Medal,
  Award,
  Globe,
  Target,
  Flag,
  CalendarClock,
  CalendarDays,
} from 'lucide-react';

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

function CountUp({ value }: { value: number }) {
  const { lang } = useI18n();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration: 1.6,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.floor(v)),
    });
    return () => controls.stop();
  }, [inView, value]);

  return <span ref={ref}>{formatNum(display, lang)}</span>;
}

function CtaButtons({ size = 'lg', className = '' }: { size?: 'lg' | 'default'; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={`flex flex-col sm:flex-row gap-3.5 justify-center items-stretch sm:items-center ${className}`}>
      <Link href="/sign-in" className="w-full sm:w-auto">
        <Button
          className={`w-full sm:w-auto rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 glow-green transition-all gap-2 font-bold ${size === 'lg' ? 'text-base h-12 px-7' : 'text-sm h-10 px-5'
            }`}
          data-testid="button-create-challenge"
        >
          <Plus className="w-4 h-4" />
          {t('landing.hero.ctaCreate')}
        </Button>
      </Link>
      <Link href="/challenges" className="w-full sm:w-auto">
        <Button
          variant="outline"
          className={`w-full sm:w-auto rounded-xl bg-card/50 backdrop-blur-sm border-secondary/30 hover:bg-secondary/10 hover:text-secondary transition-all gap-2 font-bold ${size === 'lg' ? 'text-base h-12 px-7' : 'text-sm h-10 px-5'
            }`}
          data-testid="button-join-challenge"
        >
          <Trophy className="w-4 h-4" />
          {t('landing.hero.ctaJoin')}
        </Button>
      </Link>
    </div>
  );
}

// ---------- Hero constellation: layout slots + live club crests ----------
// A slot is pure presentation: where the badge floats, how big it is, how it
// animates, and the fallback palette used when a club has no crest artwork.
// The clubs that fill the slots come from the public /clubs endpoint, so the
// hero always reflects the competitions the platform actually runs.
// Every badge is the same diameter — the constellation reads as one set of
// clubs rather than a depth effect, and no club looks more important than
// another. Position and animation are what make it feel alive.
const HERO_BADGE_SIZE = 64;

type HeroSlot = {
  // position within the container (percentage)
  top: number;
  left: number;
  // animation
  dur: number;
  delay: number;
  // hide on small screens?
  mobileHide?: boolean;
  // fallback palette — only rendered when the club has no usable crest
  from: string;
  to: string;
  ring: string;
  shadow: string;
};

const HERO_SLOTS: HeroSlot[] = [
  {
    top: 0, left: 3, dur: 4.2, delay: 0,
    from: '#003DA5', to: '#0066E0',
    ring: 'rgba(0,102,224,0.55)', shadow: 'rgba(0,70,180,0.6)',
  },
  {
    top: 4, left: 54, dur: 3.8, delay: 0.7,
    from: '#D4A017', to: '#F5C840',
    ring: 'rgba(245,200,64,0.55)', shadow: 'rgba(200,155,0,0.6)',
  },
  {
    top: 50, left: 0, dur: 4.5, delay: 1.4,
    from: '#181818', to: '#2e2e2e',
    ring: 'rgba(220,180,0,0.5)', shadow: 'rgba(180,140,0,0.45)',
  },
  {
    top: 60, left: 62, dur: 4.0, delay: 2.1,
    from: '#004d20', to: '#007732',
    ring: 'rgba(0,120,50,0.5)', shadow: 'rgba(0,100,40,0.5)',
  },
  {
    top: 24, left: 36, dur: 4.8, delay: 0.3,
    from: '#5BBFE4', to: '#2A9DC8',
    ring: 'rgba(91,191,228,0.45)', shadow: 'rgba(42,157,200,0.45)',
  },
  {
    top: 46, left: 30, dur: 3.6, delay: 1.1,
    from: '#C0151C', to: '#8A0008',
    ring: 'rgba(192,21,28,0.45)', shadow: 'rgba(138,0,8,0.45)',
  },
  {
    top: 12, left: 72, dur: 4.3, delay: 1.8,
    from: '#B3102A', to: '#7A0018',
    ring: 'rgba(179,16,42,0.45)', shadow: 'rgba(122,0,24,0.45)',
  },
  {
    top: 70, left: 20, dur: 3.9, delay: 0.5,
    from: '#023D7A', to: '#0153A8',
    ring: 'rgba(2,61,122,0.5)', shadow: 'rgba(1,83,168,0.45)',
  },
  {
    top: 76, left: 50, dur: 4.1, delay: 2.5, mobileHide: true,
    from: '#145214', to: '#1E7A1E',
    ring: 'rgba(30,122,30,0.4)', shadow: 'rgba(20,82,20,0.4)',
  },
  {
    top: 38, left: 68, dur: 3.7, delay: 0.9, mobileHide: true,
    from: '#0D47A1', to: '#1565C0',
    ring: 'rgba(13,71,161,0.4)', shadow: 'rgba(21,101,192,0.4)',
  },
  {
    top: 84, left: 76, dur: 4.6, delay: 1.6, mobileHide: true,
    from: '#B71C1C', to: '#7F0000',
    ring: 'rgba(183,28,28,0.4)', shadow: 'rgba(127,0,0,0.4)',
  },
  {
    top: 30, left: 8, dur: 4.0, delay: 2.2, mobileHide: true,
    from: '#E65100', to: '#BF360C',
    ring: 'rgba(230,81,0,0.4)', shadow: 'rgba(191,54,12,0.4)',
  },
];

// Recognition hints only — clubs a football fan spots instantly get first call
// on a slot. This never *adds* a club: a name here that is absent from the API
// response is simply skipped, and clubs missing from this list still fill the
// remaining slots. So the hero keeps following the live data.
const FEATURED_CLUB_HINTS = [
  'alhilal', 'alnassr', 'alittihad', 'alahli', 'alqadsiah', 'alshabab', 'neomsc',
  'manchestercity', 'arsenal', 'liverpool', 'chelsea', 'manchesterunited',
  'tottenhamhotspur', 'newcastleunited',
  'realmadrid', 'barcelona', 'atleticomadrid', 'athleticclub',
  'acmilan', 'intermilan', 'internazionale', 'juventus', 'napoli', 'asroma',
  'bayernmunich', 'borussiadortmund', 'bayerleverkusen',
];
const FEATURED_RANK = new Map(FEATURED_CLUB_HINTS.map((k, i) => [k, i]));

function clubKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Legal-form suffixes carry no identity: "Al Hilal SFC" and "Al Hilal" are the
// same club, and a competition catalogue may spell them either way.
const CLUB_NAME_SUFFIXES = ['fc', 'sfc', 'sc', 'cf', 'afc', 'ac', 'club', 'saudiclub'];

function clubNameKey(club: ClubRef): string {
  let key = clubKey(club.nameEn);
  for (const suffix of CLUB_NAME_SUFFIXES) {
    if (key.length > suffix.length && key.endsWith(suffix)) {
      key = key.slice(0, -suffix.length);
      break;
    }
  }
  return key;
}

// A club that plays in both a league and its domestic cup is stored as two
// separate rows (one per competition), so identity has to be matched on the
// club itself rather than the row id — otherwise the same crest floats twice.
// Both signals are checked independently: a shared crest means the same club
// even when the two rows are named differently, and a shared name means the
// same club even when one row's artwork was refreshed to a new URL.
function clubIdentities(club: ClubRef): string[] {
  const keys = [`name:${clubNameKey(club)}`];
  if (club.crestUrl) keys.push(`crest:${club.crestUrl}`);
  return keys;
}

// Deterministically choose the clubs that fill the constellation: walk the
// competitions in their configured display order and take one club from each
// in turn, so the hero always shows a spread across leagues rather than a
// dozen clubs from whichever competition sorts first.
function pickHeroClubs(groups: ClubGroup[] | undefined, count: number): ClubRef[] {
  if (!groups || groups.length === 0) return [];

  const queues = [...groups]
    .sort((a, b) =>
      a.displayOrder !== b.displayOrder
        ? a.displayOrder - b.displayOrder
        : a.nameEn < b.nameEn ? -1 : a.nameEn > b.nameEn ? 1 : 0,
    )
    .map((g) =>
      g.clubs
        .filter((c) => !!c.crestUrl)
        .sort((a, b) => {
          const ra = FEATURED_RANK.get(clubKey(a.nameEn)) ?? Number.MAX_SAFE_INTEGER;
          const rb = FEATURED_RANK.get(clubKey(b.nameEn)) ?? Number.MAX_SAFE_INTEGER;
          if (ra !== rb) return ra - rb;
          return a.nameEn < b.nameEn ? -1 : a.nameEn > b.nameEn ? 1 : 0;
        }),
    );

  const picked: ClubRef[] = [];
  const seen = new Set<string>();
  let progressed = true;

  while (picked.length < count && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (picked.length >= count) break;
      while (queue.length > 0) {
        const club = queue.shift()!;
        const identities = clubIdentities(club);
        if (identities.some((id) => seen.has(id))) continue;
        for (const id of identities) seen.add(id);
        picked.push(club);
        progressed = true;
        break;
      }
    }
  }

  return picked;
}

function ClubBadge({
  slot,
  club,
  isMobile,
}: {
  slot: HeroSlot;
  club: ClubRef | undefined;
  isMobile: boolean;
}) {
  const { lang, t } = useI18n();
  const [crestFailed, setCrestFailed] = useState(false);

  if (isMobile && slot.mobileHide) return null;
  const scale = isMobile ? 0.82 : 1;
  const sz = Math.round(HERO_BADGE_SIZE * scale);
  const name = club ? (lang === 'ar' ? club.nameAr : club.nameEn) : '';
  const showCrest = !!club?.crestUrl && !crestFailed;

  return (
    <div
      dir="ltr"
      className="absolute flex flex-col items-center gap-1 select-none"
      style={{
        top: `${slot.top}%`,
        insetInlineStart: `${slot.left}%`,
        animation: `float-badge ${slot.dur}s ease-in-out ${slot.delay}s infinite`,
      }}
    >
      {showCrest ? (
        // No disc behind the crest: the artwork floats free on the hero. The
        // crest fills the whole slot so the badge keeps the footprint it had
        // when it sat inside a disc. A faint halo plus a drop shadow keeps
        // dark-inked transparent PNGs legible against the OLED background.
        <img
          src={club!.crestUrl!}
          alt={`${t('pickClub.crestOf')} ${name}`}
          title={name}
          loading="eager"
          decoding="async"
          onError={() => setCrestFailed(true)}
          className="object-contain shrink-0"
          style={{
            width: sz,
            height: sz,
            filter:
              'drop-shadow(0 0 1.5px rgba(255,255,255,0.85)) drop-shadow(0 4px 10px rgba(0,0,0,0.55))',
          }}
        />
      ) : (
        <div
          className="rounded-full flex items-center justify-center shrink-0 overflow-hidden"
          style={{
            width: sz,
            height: sz,
            background: `linear-gradient(135deg, ${slot.from}, ${slot.to})`,
            boxShadow: `0 0 ${Math.round(sz * 0.3)}px ${slot.shadow}, inset 0 1px 0 rgba(255,255,255,0.18)`,
            outline: `2px solid ${slot.ring}`,
            outlineOffset: 1,
          }}
        >
          {name ? (
            <span
              className="font-black text-white/95 leading-none tracking-tight text-center px-1"
              style={{ fontSize: sz <= 46 ? 9 : sz <= 58 ? 10 : sz <= 70 ? 11 : 12 }}
            >
              {sz <= 58 ? (club?.code || name) : name}
            </span>
          ) : (
            // Pre-load placeholder: holds the slot so the constellation never
            // pops into place once the clubs arrive.
            <Shield
              aria-hidden="true"
              className="text-white/35"
              style={{ width: Math.round(sz * 0.42), height: Math.round(sz * 0.42) }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function HeroClubsFloat() {
  const { data } = useGetClubs();
  const clubs = React.useMemo(
    () => pickHeroClubs(data?.groups, HERO_SLOTS.length),
    [data],
  );

  return (
    <>
      {/* Desktop constellation — dir="ltr" so absolute left% coords are intentionally physical */}
      <div dir="ltr" className="relative w-full hidden lg:block" style={{ height: 480 }}>
        {/* Ambient glows */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 start-1/3 w-64 h-64 rounded-full blur-[80px] opacity-20"
            style={{ background: 'radial-gradient(circle, #003DA5 0%, transparent 70%)' }} />
          <div className="absolute bottom-1/4 end-1/4 w-56 h-56 rounded-full blur-[70px] opacity-18"
            style={{ background: 'radial-gradient(circle, #D4A017 0%, transparent 70%)' }} />
        </div>
        {HERO_SLOTS.map((slot, i) => (
          <ClubBadge key={i} slot={slot} club={clubs[i]} isMobile={false} />
        ))}
      </div>

      {/* Mobile compact strip — dir="ltr" so absolute left% coords are intentionally physical */}
      <div dir="ltr" className="lg:hidden relative w-full overflow-hidden py-6" style={{ minHeight: 340 }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 start-1/3 w-48 h-48 rounded-full blur-[60px] opacity-15"
            style={{ background: 'radial-gradient(circle, #003DA5 0%, transparent 70%)' }} />
        </div>
        <div className="relative" style={{ height: 320 }}>
          {HERO_SLOTS.map((slot, i) => (
            <ClubBadge key={i} slot={slot} club={clubs[i]} isMobile={true} />
          ))}
        </div>
      </div>
    </>
  );
}

function StatCard({ value, label, accent }: { value: number; label: string; accent: 'green' | 'gold' | 'plain' }) {
  const color = accent === 'green' ? 'text-primary' : accent === 'gold' ? 'text-secondary' : 'text-foreground';
  const cardCls = accent === 'gold' ? 'card-glass-gold' : accent === 'green' ? 'card-glass-green' : 'card-glass';
  return (
    <div className={`${cardCls} p-6 rounded-2xl text-center relative overflow-hidden`}>
      {accent === 'gold' && <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-secondary to-transparent" />}
      {accent === 'green' && <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent" />}
      <div className={`text-4xl md:text-5xl font-black mb-2 tabular-nums ${color}`}>
        <CountUp value={value} />
      </div>
      <div className="text-xs md:text-sm font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}

function StepCard({ index, title, desc, icon: Icon }: { index: number; title: string; desc: string; icon: React.ElementType }) {
  const { lang } = useI18n();
  return (
    <div className="card-glass p-6 rounded-2xl relative h-full hover:ring-1 hover:ring-secondary/30 transition-all hover-lift">
      <div className="absolute top-4 end-4 text-5xl font-black text-secondary/8 tabular-nums select-none">
        {formatNum(index, lang)}
      </div>
      <div className="w-12 h-12 rounded-xl bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center mb-4 shadow-[0_0_16px_hsl(var(--primary)/0.25)]">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function WhyCard({ title, desc, icon: Icon }: { title: string; desc: string; icon: React.ElementType }) {
  return (
    <div className="card-glass p-6 rounded-2xl h-full hover:ring-1 hover:ring-secondary/25 transition-all group hover-lift">
      <div className="w-12 h-12 rounded-xl bg-secondary/10 ring-1 ring-secondary/20 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:shadow-[0_0_16px_hsl(var(--secondary)/0.35)] transition-all">
        <Icon className="w-6 h-6 text-secondary" />
      </div>
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-glass rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-start hover:bg-white/[0.03] transition-colors"
        data-testid="faq-toggle"
      >
        <span className="font-bold text-base">{q}</span>
        <ChevronDown className={`w-5 h-5 shrink-0 text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="overflow-hidden"
      >
        <p className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{a}</p>
      </motion.div>
    </div>
  );
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  const { lang } = useI18n();
  return (
    <div className="card-glass rounded-2xl p-4 md:p-6 min-w-[72px] md:min-w-[110px] text-center">
      <div className="text-3xl md:text-5xl font-black text-gold-gradient tabular-nums">
        {formatNum(value, lang)}
      </div>
      <div className="text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Reveal className="text-center max-w-2xl mx-auto mb-12">
      <h2 className="text-3xl md:text-5xl font-black tracking-tight text-gold-gradient pb-1">{title}</h2>
      {subtitle && <p className="text-base md:text-lg text-muted-foreground mt-3">{subtitle}</p>}
      <div className="divider-gold h-px w-24 mx-auto mt-6" />
    </Reveal>
  );
}

function RewardCard({
  place,
  prize,
  rank,
  icon: Icon,
  iconClass,
  ringClass,
}: {
  place: string;
  prize: string;
  rank: number;
  icon: React.ElementType;
  iconClass: string;
  ringClass: string;
}) {
  const { lang } = useI18n();
  return (
    <div className={`card-glass rounded-2xl p-6 text-center ring-1 ${ringClass}`}>
      <div className={`w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4 ${iconClass}`}>
        <Icon className="w-7 h-7 text-white" />
      </div>
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
        {place} · {formatNum(rank, lang)}
      </div>
      <div className="text-lg font-black">{prize}</div>
    </div>
  );
}

function UpcomingTeam({ team, align }: { team?: UpcomingMatch['homeTeam']; align: 'start' | 'end' }) {
  const { lang } = useI18n();
  const name = team ? (lang === 'ar' ? team.nameAr : team.nameEn) : '—';
  return (
    <div className={`flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 ${align === 'end' ? 'flex-row-reverse text-end' : ''}`}>
      {team?.flagUrl ? (
        <img src={team.flagUrl} alt="" className="w-7 h-5 sm:w-8 sm:h-6 rounded-sm object-cover shrink-0 ring-1 ring-border" />
      ) : (
        <div className="w-7 h-5 sm:w-8 sm:h-6 rounded-sm bg-muted shrink-0 flex items-center justify-center ring-1 ring-border">
          <Flag className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-muted-foreground" />
        </div>
      )}
      <span className="font-bold truncate text-xs sm:text-sm md:text-base">{name}</span>
    </div>
  );
}

function UpcomingMatchRow({ m, lang }: { m: UpcomingMatch; lang: Lang }) {
  const { t } = useI18n();
  const cd = useCountdown(m.kickoffAt);
  const stageLabel = m.stageType ? t(`stage.${m.stageType}`) : '';

  return (
    <div className="card-glass rounded-2xl p-4 sm:p-5 hover:ring-1 hover:ring-secondary/30 transition-all" data-testid={`upcoming-match-${m.id}`}>
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

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3 md:gap-4" dir="ltr">
        <UpcomingTeam team={m.homeTeam} align="start" />
        <span className="text-xs font-black text-muted-foreground/50 tracking-widest px-1 sm:px-2">{t('common.vs')}</span>
        <UpcomingTeam team={m.awayTeam} align="end" />
      </div>

      <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-center gap-2 text-center">
        {cd && !cd.done ? (
          <>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('landing.upcoming.kicksOff')}</span>
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

function ShowcaseTeamName({ team, align }: { team?: UpcomingMatch['homeTeam']; align: 'start' | 'end' }) {
  const { lang } = useI18n();
  const name = team ? (lang === 'ar' ? team.nameAr : team.nameEn) : '—';
  return <span className={`truncate flex-1 min-w-0 text-xs sm:text-sm font-bold ${align === 'end' ? 'text-end' : 'text-start'}`}>{name}</span>;
}

function CompetitionShowcaseCard({ competition }: { competition: Competition }) {
  const { t, lang } = useI18n();
  const slug = competition.competitionSlug;
  const season = competition.currentSeason?.season ?? null;
  const comingSoon = !!competition.currentSeason?.comingSoon || !competition.currentSeason;

  const upcomingParams = { limit: 1, competitionSlug: slug, season: season ?? undefined };
  const { data: upcoming } = useGetUpcomingMatches(upcomingParams, {
    query: { queryKey: getGetUpcomingMatchesQueryKey(upcomingParams), enabled: !comingSoon },
  });
  const rankingParams = { season: season ?? undefined, limit: 1 };
  const { data: ranking } = useGetCompetitionRanking(slug, rankingParams, {
    query: { queryKey: getGetCompetitionRankingQueryKey(slug, rankingParams), enabled: !comingSoon },
  });

  const nextMatch = upcoming?.matches?.[0];
  const topPredictor = ranking?.entries?.[0];

  return (
    <Link href="/sign-in" className="block">
      <div
        className="card-glass rounded-2xl p-5 flex flex-col gap-4 h-full hover:ring-1 hover:ring-secondary/30 transition-all"
        data-testid={`competition-card-${slug}`}
      >
        <div className="flex items-center gap-3">
          {competition.logoUrl ? (
            <img src={competition.logoUrl} alt={labelCompetition(competition, lang)} className="w-10 h-10 object-contain shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-secondary/10 ring-1 ring-secondary/25 flex items-center justify-center shrink-0">
              <Trophy className="w-5 h-5 text-secondary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-bold truncate text-sm sm:text-base">{labelCompetition(competition, lang)}</h3>
            {season && (
              <span className="text-xs text-muted-foreground" dir="ltr">
                {season}
              </span>
            )}
          </div>
        </div>

        {comingSoon ? (
          <div className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
            <CalendarClock className="w-4 h-4 shrink-0" />
            <span>{t('landing.competitions.comingSoon')}</span>
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-background/50 ring-1 ring-border/50 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {t('landing.competitions.nextMatch')}
              </div>
              {nextMatch ? (
                <>
                  <div className="flex items-center justify-between gap-1 sm:gap-2 min-w-0 w-full" dir="ltr">
                    <ShowcaseTeamName team={nextMatch.homeTeam} align="start" />
                    <span className="text-xs text-muted-foreground px-1 shrink-0">{t('common.vs')}</span>
                    <ShowcaseTeamName team={nextMatch.awayTeam} align="end" />
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-2">
                    <CalendarClock className="w-3.5 h-3.5 opacity-70" />
                    {formatKickoff(nextMatch.kickoffAt, lang)}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">{t('landing.competitions.noMatches')}</div>
              )}
            </div>

            {topPredictor && (
              <div className="flex items-center gap-2 rounded-xl bg-secondary/10 ring-1 ring-secondary/25 px-3 py-2.5">
                <Trophy className="w-4 h-4 text-secondary shrink-0" />
                <span className="text-xs text-muted-foreground">{t('landing.competitions.topPredictor')}</span>
                <span className="text-sm font-bold truncate flex-1">{topPredictor.displayName ?? t('landing.board.you')}</span>
                <span className="text-sm font-black text-secondary tabular-nums">{formatNum(topPredictor.points, lang)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </Link>
  );
}

function CompetitionTabs() {
  const { lang, t } = useI18n();
  const { competitions, selectedSlug, setCompetition, isLoading } = useCompetition();

  if (isLoading) {
    return (
      <div className="flex flex-nowrap overflow-x-auto gap-2 justify-start md:justify-center w-full max-w-4xl mx-auto px-4 pb-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 w-28 bg-muted rounded-xl animate-pulse shrink-0" />
        ))}
      </div>
    );
  }

  if (competitions.length === 0) return null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 overflow-hidden">
      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
      <div className="flex flex-nowrap md:flex-wrap overflow-x-auto md:overflow-visible gap-3 py-2 px-2 no-scrollbar justify-start md:justify-center items-center w-full">
        {competitions.map((c) => {
          const isSelected = c.competitionSlug === selectedSlug;
          const isComingSoon = !!c.currentSeason?.comingSoon;
          return (
            <button
              key={c.competitionSlug}
              type="button"
              onClick={() => setCompetition(c.competitionSlug)}
              className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-bold border transition-all duration-200 active:scale-95 shrink-0 ${isSelected
                  ? 'bg-secondary text-secondary-foreground border-secondary shadow-[0_0_15px_rgba(234,179,8,0.3)]'
                  : 'bg-card/45 backdrop-blur-sm border-border/40 text-muted-foreground hover:text-foreground hover:bg-card/85'
                }`}
              style={{ minHeight: 44 }}
              data-testid={`competition-tab-${c.competitionSlug}`}
            >
              {c.logoUrl ? (
                <img src={c.logoUrl} alt="" className="w-5 h-5 object-contain shrink-0" />
              ) : (
                <Trophy className={`w-4 h-4 shrink-0 ${isSelected ? 'text-secondary-foreground' : 'text-secondary'}`} />
              )}
              <span>{labelCompetition(c, lang)}</span>
              {isComingSoon && (
                <span className="text-[9px] uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md">
                  {t('competition.comingSoon')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MatchCenterCountdown() {
  const { t } = useI18n();
  const { selectedSlug, selectedSeason, isReady, comingSoon } = useCompetition();

  const params = {
    limit: 1,
    competitionSlug: selectedSlug ?? undefined,
    season: selectedSeason ?? undefined,
  };
  const { data } = useGetUpcomingMatches(params, {
    query: {
      queryKey: getGetUpcomingMatchesQueryKey(params),
      enabled: isReady && !!selectedSlug && !comingSoon,
    },
  });

  const nextKickoff = data?.matches?.[0]?.kickoffAt ?? null;
  const cd = useCountdown(nextKickoff);

  return (
    <div className="mb-14 relative overflow-hidden">
      <Reveal>
        {comingSoon ? (
          <div className="text-center text-xl font-bold text-gold-gradient flex items-center justify-center gap-2">
            <CalendarClock className="w-5 h-5 text-secondary" />
            {t('landing.countdown.tba')}
          </div>
        ) : cd && !cd.done ? (
          <div className="flex justify-center gap-3 md:gap-5 flex-wrap" dir="ltr">
            <CountdownUnit value={cd.days} label={t('landing.countdown.days')} />
            <CountdownUnit value={cd.hours} label={t('landing.countdown.hours')} />
            <CountdownUnit value={cd.minutes} label={t('landing.countdown.minutes')} />
            <CountdownUnit value={cd.seconds} label={t('landing.countdown.seconds')} />
          </div>
        ) : (
          <div className="text-center text-xl font-bold text-gold-gradient flex items-center justify-center gap-2">
            <CalendarClock className="w-5 h-5 text-secondary" />
            {nextKickoff ? t('landing.countdown.kickoff') : t('landing.countdown.tba')}
          </div>
        )}
      </Reveal>
      <Reveal className="text-center mt-6">
        <Link href="/sign-in">
          <Button className="rounded-xl text-base h-11 px-6 bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-gold gap-2 font-bold" data-testid="button-countdown-cta">
            <Plus className="w-4 h-4" />
            {t('landing.countdown.cta')}
          </Button>
        </Link>
      </Reveal>
    </div>
  );
}

function MatchCenterUpcomingList() {
  const { t, lang } = useI18n();
  const { selectedSlug, selectedSeason, isReady, comingSoon } = useCompetition();

  const params = {
    limit: 4,
    competitionSlug: selectedSlug ?? undefined,
    season: selectedSeason ?? undefined,
  };
  const { data, isLoading } = useGetUpcomingMatches(params, {
    query: {
      queryKey: getGetUpcomingMatchesQueryKey(params),
      enabled: isReady && !!selectedSlug && !comingSoon,
      refetchInterval: (q) => {
        const list = (q.state.data as UpcomingMatches | undefined)?.matches ?? [];
        const now = Date.now();
        const hasLive = list.some((m) => new Date(m.kickoffAt).getTime() <= now);
        return hasLive ? 6000 : 60000;
      },
      refetchIntervalInBackground: false,
    },
  });

  const matches = data?.matches ?? [];

  return (
    <Reveal className="max-w-4xl mx-auto">
      {!isReady || isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card-glass rounded-2xl p-5 space-y-4 animate-pulse">
              <div className="h-3 w-1/3 bg-muted rounded" />
              <div className="h-6 w-full bg-muted rounded" />
              <div className="h-4 w-2/3 bg-muted rounded mx-auto" />
            </div>
          ))}
        </div>
      ) : comingSoon ? (
        <div className="card-glass rounded-2xl py-10 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <CalendarClock className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm font-medium max-w-sm">{t('landing.competitions.comingSoon')}</p>
        </div>
      ) : matches.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {matches.map((m) => (
            <UpcomingMatchRow key={m.id} m={m} lang={lang} />
          ))}
        </div>
      ) : (
        <div className="card-glass rounded-2xl py-10 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <CalendarClock className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm font-medium max-w-sm">
            {data?.scheduleState === 'finished'
              ? t('landing.upcoming.finished')
              : t('landing.upcoming.tba')}
          </p>
        </div>
      )}
      {!!selectedSlug && !comingSoon && data?.scheduleState !== 'no_schedule' && (
        <div className="text-center mt-6">
          <Link href="/schedule">
            <Button
              variant="outline"
              size="default"
              className="rounded-xl bg-card/50 backdrop-blur-sm border-secondary/30 hover:bg-secondary/10 hover:text-secondary transition-all gap-2 text-sm font-bold"
              data-testid="button-see-full-schedule"
            >
              <CalendarDays className="w-4 h-4" />
              {t('landing.upcoming.seeFull')}
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Button>
          </Link>
        </div>
      )}
    </Reveal>
  );
}

function CompetitionsSection() {
  const { t } = useI18n();
  const { competitions, isLoading } = useCompetition();

  if (!isLoading && competitions.length === 0) return null;

  return (
    <section className="px-4 py-16 border-t border-border/40 relative overflow-hidden">
      <div className="absolute inset-0 glow-gold opacity-5 blur-3xl" />
      <div className="container mx-auto relative">
        <SectionHeading title={t('landing.season.title')} subtitle={t('landing.season.subtitle')} />
        {isLoading ? (
          <div className="grid sm:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card-glass rounded-2xl p-5 space-y-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-2/3 bg-muted rounded" />
                    <div className="h-2.5 w-1/3 bg-muted rounded" />
                  </div>
                </div>
                <div className="h-14 w-full bg-muted rounded-xl" />
                <div className="h-9 w-full bg-muted rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {competitions.map((c, i) => (
              <Reveal key={c.competitionSlug} delay={i * 0.07}>
                <CompetitionShowcaseCard competition={c} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MatchCenterSection() {
  const { t } = useI18n();
  const { selectedSlug, isReady } = useCompetition();

  if (isReady && !selectedSlug) return null;

  return (
    <section id="match-center" className="scroll-mt-20 px-4 py-16 border-t border-border/40 relative overflow-hidden">
      <div className="absolute inset-0 glow-green opacity-5 blur-3xl" />
      <div className="container mx-auto relative">
        <SectionHeading title={t('landing.competitions.title')} subtitle={t('landing.competitions.subtitle')} />
        <Reveal className="flex justify-center mb-10">
          <CompetitionTabs />
        </Reveal>
        <MatchCenterCountdown />
        <MatchCenterUpcomingList />
      </div>
    </section>
  );
}

export default function LandingPage() {
  const { t, lang, setLang } = useI18n();
  const { data: stats } = useGetPlatformStats();
  const { competitions } = useCompetition();
  const trackEvent = useTrackAnalyticsEvent();
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
    trackPageView.mutate({ data: { path: '/', referrer: document.referrer || null, sessionId: sid } });
  }, []);

  const toggleLanguage = () => setLang(lang === 'ar' ? 'en' : 'ar');

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const shareWhatsApp = () => {
    const base = import.meta.env.BASE_URL;
    const url = `${window.location.origin}${base}`;
    trackEvent.mutate({ data: { type: 'whatsapp_share', entityType: 'app' } });
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${t('home.shareMessage')} ${url}`)}`,
      '_blank',
    );
  };

  const navItems: { id: string; label: string }[] = [
    { id: 'home', label: t('landing.nav.home') },
    { id: 'how', label: t('landing.nav.howItWorks') },
    { id: 'features', label: t('landing.nav.features') },
    { id: 'faq', label: t('landing.nav.faq') },
  ];

  // Sample addictive leaderboard
  const sampleEntries: RankingEntry[] = [
    { userId: 's1', rank: 1, rankMovement: 2, displayName: t('landing.board.name1'), points: 2480, accuracy: 0.82, exactPredictions: 14, correctPredictions: 28, totalPredictions: 34, isCurrentUser: false },
    { userId: 's2', rank: 2, rankMovement: -1, displayName: t('landing.board.name2'), points: 2310, accuracy: 0.78, exactPredictions: 12, correctPredictions: 26, totalPredictions: 33, isCurrentUser: false },
    { userId: 's3', rank: 3, rankMovement: 1, displayName: t('landing.board.name3'), points: 2150, accuracy: 0.75, exactPredictions: 11, correctPredictions: 24, totalPredictions: 32, isCurrentUser: false },
    { userId: 's4', rank: 4, rankMovement: 0, displayName: t('landing.board.name4'), points: 1980, accuracy: 0.71, exactPredictions: 9, correctPredictions: 22, totalPredictions: 31, isCurrentUser: false },
  ];
  const sampleMe: RankingEntry = { userId: 'me', rank: 8, rankMovement: 3, displayName: t('landing.board.you'), points: 1420, accuracy: 0.64, exactPredictions: 6, correctPredictions: 17, totalPredictions: 28, isCurrentUser: true };

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col">
      {/* ===== NAV ===== */}
      <header className="border-b border-border bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 md:h-20 flex items-center justify-between gap-4">
          <button onClick={() => scrollTo('home')} className="flex items-center gap-2 shrink-0" data-testid="link-logo">
            <img src="/logo.png" alt={t('app.name')} className="h-12 sm:h-14 md:h-16 w-auto" />
          </button>

          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="text-sm font-medium text-muted-foreground hover:text-secondary transition-colors"
                data-testid={`nav-${item.id}`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            <ThemeToggle testId="button-theme-toggle-nav" />
            <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5 font-semibold" data-testid="button-lang-toggle">
              <Languages className="w-4 h-4" />
              {lang === 'ar' ? 'English' : 'العربية'}
            </Button>
            <Link href="/sign-in" className="hidden sm:inline text-sm font-medium hover:text-secondary transition-colors">
              {t('auth.signIn')}
            </Link>
            <Link href="/sign-in">
              <Button size="sm" className="bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-gold gap-1.5 rounded-xl" data-testid="button-signup-header">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{t('landing.nav.createFree')}</span>
                <span className="sm:hidden">{t('challenges.create')}</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ===== HERO ===== */}
        <section id="home" className="scroll-mt-20 relative overflow-hidden px-4 pt-16 md:pt-24 pb-20">
          {/* Ambient professional lighting background highlights */}
          <div className="absolute top-1/4 start-[10%] w-72 h-72 bg-primary/10 rounded-full blur-3xl pointer-events-none -z-10" />
          <div className="absolute bottom-1/4 end-[10%] w-96 h-96 bg-secondary/8 rounded-full blur-3xl pointer-events-none -z-10" />

          <div className="container mx-auto relative grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            <div className="text-center lg:text-start">
              <Reveal>
                <div className="inline-flex items-center gap-2 rounded-xl bg-secondary/10 ring-1 ring-secondary/25 px-4 py-1.5 mb-6">
                  <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider">{t('landing.trust.multiCompetition')}</span>
                </div>
                <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-[1.1]">
                  <span className="block">{t('landing.hero.line1')}</span>
                  <span className="block">{t('landing.hero.line2')}</span>
                  <span className="block text-gold-gradient pb-2">{t('landing.hero.line3')}</span>
                </h1>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="text-base md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 mt-6">
                  {t('landing.hero.subtitle')}
                </p>
              </Reveal>
              <Reveal delay={0.2}>
                <CtaButtons className="mt-8 lg:justify-start" />
              </Reveal>
              <Reveal delay={0.3}>
                <button
                  onClick={shareWhatsApp}
                  className="inline-flex items-center gap-2 mt-5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-share-whatsapp-hero"
                >
                  <SiWhatsapp className="w-4 h-4 text-[#25D366]" />
                  {t('home.shareWhatsApp')}
                </button>
              </Reveal>
              {competitions.length > 0 && (
                <Reveal delay={0.38}>
                  <div className="flex flex-wrap items-center gap-2 justify-center lg:justify-start mt-5">
                    <span className="text-[11px] font-semibold text-muted-foreground/60 me-0.5 shrink-0">
                      {t('landing.hero.leaguesLabel')}
                    </span>
                    {competitions.map((c) => (
                      <div
                        key={c.competitionSlug}
                        className="flex items-center gap-1.5 rounded-lg bg-card/55 ring-1 ring-border/40 backdrop-blur-sm px-2.5 py-1.5"
                      >
                        {c.logoUrl ? (
                          <img src={c.logoUrl} alt="" className="w-4 h-4 object-contain shrink-0" />
                        ) : (
                          <Trophy className="w-3.5 h-3.5 text-secondary shrink-0" />
                        )}
                        <span className="text-[11px] font-semibold leading-none">{labelCompetition(c, lang)}</span>
                      </div>
                    ))}
                  </div>
                </Reveal>
              )}
              <Reveal delay={0.45}>
                <div className="flex flex-wrap gap-x-5 gap-y-2 justify-center lg:justify-start mt-6">
                  {[t('landing.trust.multiCompetition'), t('landing.trust.bilingual'), t('landing.trust.free'), t('landing.trust.whatsapp')].map((label) => (
                    <span key={label} className="inline-flex items-center gap-1.5 text-xs md:text-sm font-medium text-muted-foreground">
                      <Check className="w-4 h-4 text-primary" />
                      {label}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={0.2}>
              <HeroClubsFloat />
            </Reveal>
          </div>
        </section>

        {/* ===== SOCIAL PROOF ===== */}
        <section className="px-4 py-16 border-t border-border/40">
          <div className="container mx-auto">
            <SectionHeading title={t('landing.social.title')} subtitle={t('landing.social.subtitle')} />
            <Reveal>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 max-w-5xl mx-auto">
                <StatCard value={stats?.totalChallenges ?? 0} label={t('landing.social.challenges')} accent="gold" />
                <StatCard value={stats?.totalUsers ?? 0} label={t('landing.social.players')} accent="green" />
                <StatCard value={stats?.totalPredictions ?? 0} label={t('landing.social.predictions')} accent="plain" />
                <StatCard value={competitions.length} label={t('landing.social.competitions')} accent="plain" />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ===== THIS SEASON'S COMPETITIONS ===== */}
        <CompetitionsSection />

        {/* ===== HOW IT WORKS ===== */}
        <section id="how" className="scroll-mt-20 px-4 py-16 border-t border-border/40">
          <div className="container mx-auto">
            <SectionHeading title={t('landing.how.title')} subtitle={t('landing.how.subtitle')} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-6xl mx-auto">
              {[
                { title: t('landing.how.step1.title'), desc: t('landing.how.step1.desc'), icon: Plus },
                { title: t('landing.how.step2.title'), desc: t('landing.how.step2.desc'), icon: Share2 },
                { title: t('landing.how.step3.title'), desc: t('landing.how.step3.desc'), icon: Target },
                { title: t('landing.how.step4.title'), desc: t('landing.how.step4.desc'), icon: Activity },
              ].map((step, i) => (
                <Reveal key={i} delay={i * 0.08}>
                  <StepCard index={i + 1} title={step.title} desc={step.desc} icon={step.icon} />
                </Reveal>
              ))}
            </div>
            <Reveal className="text-center mt-10">
              <CtaButtons size="default" />
            </Reveal>
          </div>
        </section>

        {/* ===== LIVE COMPETITION ===== */}
        <section className="px-4 py-16 border-t border-border/40">
          <div className="container mx-auto">
            <SectionHeading title={t('landing.live.title')} subtitle={t('landing.live.subtitle')} />
            <div className="grid lg:grid-cols-2 gap-8 items-center max-w-6xl mx-auto">
              <Reveal>
                <div className="space-y-4">
                  {[
                    { phase: t('landing.live.before'), desc: t('landing.live.beforeDesc'), color: 'bg-muted text-muted-foreground' },
                    { phase: t('landing.live.during'), desc: t('landing.live.duringDesc'), color: 'bg-red-500/15 text-red-500 ring-1 ring-red-500/30' },
                    { phase: t('landing.live.after'), desc: t('landing.live.afterDesc'), color: 'bg-primary/15 text-primary ring-1 ring-primary/30' },
                  ].map((row, i) => (
                    <div key={i} className="card-glass rounded-2xl p-5 flex items-start gap-4">
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap ${row.color}`}>{row.phase}</span>
                      <p className="text-sm text-muted-foreground leading-relaxed pt-1">{row.desc}</p>
                    </div>
                  ))}
                </div>
              </Reveal>

              <Reveal delay={0.15}>
                <div className="card-glass rounded-3xl p-6 glow-green relative overflow-hidden">
                  <div className="flex items-center justify-between mb-5">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-red-500">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      {t('landing.mock.live')} <span dir="ltr">{formatNum(78, lang)}&apos;</span>
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('nav.matches')}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-700 to-blue-500 ring-1 ring-primary/30 flex items-center justify-center">
                        <Shield className="w-6 h-6 text-white/90" />
                      </div>
                      <span className="text-sm font-bold text-center">{t('landing.live.exampleHome')}</span>
                    </div>
                    <div className="text-4xl font-black tabular-nums flex items-center gap-2">
                      <span className="text-primary">{formatNum(2, lang)}</span>
                      <span className="text-muted-foreground/40">-</span>
                      <span>{formatNum(1, lang)}</span>
                    </div>
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-500 to-yellow-700 ring-1 ring-border flex items-center justify-center">
                        <Shield className="w-6 h-6 text-white/90" />
                      </div>
                      <span className="text-sm font-bold text-center">{t('landing.live.exampleAway')}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-secondary/10 ring-1 ring-secondary/30 px-4 py-3">
                    <span className="text-sm font-bold text-secondary tabular-nums">+{formatNum(100, lang)} {t('landing.live.pointsEarned')}</span>
                    <span className="flex items-center gap-2 text-sm font-bold">
                      <span className="text-muted-foreground tabular-nums">{t('landing.live.rankLabel')} {formatNum(12, lang)}</span>
                      <ArrowRight className="w-4 h-4 text-emerald-500 rtl:rotate-180" />
                      <span className="text-emerald-500 tabular-nums">{formatNum(3, lang)}</span>
                    </span>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ===== WHY PEOPLE LOVE THADDI ===== */}
        <section id="features" className="scroll-mt-20 px-4 py-16 border-t border-border/40">
          <div className="container mx-auto">
            <SectionHeading title={t('landing.why.title')} subtitle={t('landing.why.subtitle')} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto">
              {[
                { title: t('landing.why.compete.title'), desc: t('landing.why.compete.desc'), icon: Users },
                { title: t('landing.why.whatsapp.title'), desc: t('landing.why.whatsapp.desc'), icon: Share2 },
                { title: t('landing.why.rankings.title'), desc: t('landing.why.rankings.desc'), icon: Activity },
                { title: t('landing.why.noGambling.title'), desc: t('landing.why.noGambling.desc'), icon: ShieldCheck },
                { title: t('landing.why.unlimited.title'), desc: t('landing.why.unlimited.desc'), icon: InfinityIcon },
                { title: t('landing.why.arabic.title'), desc: t('landing.why.arabic.desc'), icon: Globe },
              ].map((card, i) => (
                <Reveal key={i} delay={(i % 3) * 0.08}>
                  <WhyCard title={card.title} desc={card.desc} icon={card.icon} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ===== UNIFIED MATCH CENTER ===== */}
        <MatchCenterSection />

        {/* ===== LEADERBOARD SHOWCASE ===== */}
        <section className="px-4 py-16 border-t border-border/40">
          <div className="container mx-auto">
            <SectionHeading title={t('landing.board.title')} subtitle={t('landing.board.subtitle')} />
            <Reveal className="max-w-2xl mx-auto">
              <div className="card-glass rounded-3xl overflow-hidden glow-gold">
                <Leaderboard entries={sampleEntries} me={sampleMe} emptyText="" />
              </div>
              <div className="text-center mt-8">
                <CtaButtons size="default" />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ===== CHALLENGE REWARDS ===== */}
        <section className="px-4 py-16 border-t border-border/40">
          <div className="container mx-auto">
            <SectionHeading title={t('landing.rewards.title')} subtitle={t('landing.rewards.subtitle')} />
            <div className="grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
              <Reveal delay={0.05}>
                <RewardCard place={t('landing.rewards.first')} prize={t('landing.rewards.firstPrize')} rank={1} icon={Trophy} iconClass="bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-[0_0_15px_rgba(234,179,8,0.4)]" ringClass="ring-secondary/40" />
              </Reveal>
              <Reveal delay={0.12}>
                <RewardCard place={t('landing.rewards.second')} prize={t('landing.rewards.secondPrize')} rank={2} icon={Medal} iconClass="bg-gradient-to-br from-slate-300 to-slate-500" ringClass="ring-border" />
              </Reveal>
              <Reveal delay={0.19}>
                <RewardCard place={t('landing.rewards.third')} prize={t('landing.rewards.thirdPrize')} rank={3} icon={Award} iconClass="bg-gradient-to-br from-orange-400 to-orange-700" ringClass="ring-border" />
              </Reveal>
            </div>
            <Reveal className="text-center mt-8">
              <p className="text-sm text-muted-foreground max-w-xl mx-auto flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                {t('landing.rewards.note')}
              </p>
            </Reveal>
          </div>
        </section>

        {/* ===== FAQ ===== */}
        <section id="faq" className="scroll-mt-20 px-4 py-16 border-t border-border/40">
          <div className="container mx-auto">
            <SectionHeading title={t('landing.faq.title')} subtitle={t('landing.faq.subtitle')} />
            <div className="max-w-2xl mx-auto space-y-3">
              {[
                { q: t('landing.faq.q1'), a: t('landing.faq.a1') },
                { q: t('landing.faq.q2'), a: t('landing.faq.a2') },
                { q: t('landing.faq.q3'), a: t('landing.faq.a3') },
                { q: t('landing.faq.q4'), a: t('landing.faq.a4') },
                { q: t('landing.faq.q5'), a: t('landing.faq.a5') },
                { q: t('landing.faq.q6'), a: t('landing.faq.a6') },
              ].map((item, i) => (
                <Reveal key={i} delay={i * 0.05}>
                  <FaqItem q={item.q} a={item.a} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ===== FINAL CTA ===== */}
        <section className="px-4 py-24 border-t border-border/40 relative overflow-hidden bg-stadium">
          <div className="absolute inset-0 glow-gold opacity-10 blur-3xl" />
          <div className="container mx-auto relative text-center max-w-3xl">
            <Reveal>
              <Trophy className="w-14 h-14 mx-auto text-secondary mb-6" />
              <h2 className="text-4xl md:text-6xl font-black tracking-tight text-gold-gradient pb-2">{t('landing.final.title')}</h2>
              <p className="text-lg md:text-xl text-muted-foreground mt-4 mb-10">{t('landing.final.subtitle')}</p>
              <CtaButtons />
              <button
                onClick={shareWhatsApp}
                className="inline-flex items-center gap-2 mt-6 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-share-whatsapp-final"
              >
                <SiWhatsapp className="w-4 h-4 text-[#25D366]" />
                {t('home.shareWhatsApp')}
              </button>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-border bg-card/60 backdrop-blur-xl px-4 py-12">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
            <div className="text-center md:text-start">
              <img src="/logo.png" alt={t('app.name')} className="h-20 md:h-24 w-auto mx-auto md:mx-0 mb-3" />
              <p className="text-sm font-semibold text-secondary">{t('app.tagline')}</p>
            </div>

            <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              <button onClick={() => scrollTo('features')} className="text-sm text-muted-foreground hover:text-secondary transition-colors">{t('landing.nav.features')}</button>
              <button onClick={() => scrollTo('faq')} className="text-sm text-muted-foreground hover:text-secondary transition-colors">{t('landing.nav.faq')}</button>
              <Link href="/terms" className="text-sm text-muted-foreground hover:text-secondary transition-colors" data-testid="link-footer-terms">{t('landing.footer.terms')}</Link>
              <Link href="/privacy" className="text-sm text-muted-foreground hover:text-secondary transition-colors" data-testid="link-footer-privacy">{t('landing.footer.privacy')}</Link>
            </nav>

            <div className="flex items-center justify-center gap-4">
              <ThemeToggle testId="button-theme-toggle-footer" />
              <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5 font-semibold" data-testid="button-lang-toggle-footer">
                <Languages className="w-4 h-4" />
                {lang === 'ar' ? 'English' : 'العربية'}
              </Button>
              <div className="flex items-center gap-3">
                <a href="https://x.com/thaddiapp" target="_blank" rel="noopener noreferrer" aria-label="X" className="text-muted-foreground hover:text-secondary transition-colors">
                  <SiX className="w-5 h-5" />
                </a>
                <a href="https://www.tiktok.com/@thaddiapp" target="_blank" rel="noopener noreferrer" aria-label="TikTok" className="text-muted-foreground hover:text-secondary transition-colors">
                  <SiTiktok className="w-5 h-5" />
                </a>
              </div>
            </div>
          </div>
          <div className="divider-gold h-px w-full mt-8 mb-6" />
          <p className="text-center text-xs text-muted-foreground">{t('app.name')} · {t('landing.footer.rights')}</p>
        </div>
      </footer>

      {/* ===== STICKY MOBILE CTA ===== */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card/90 backdrop-blur-xl px-4 py-3 flex items-center gap-3">
        <Link href="/sign-in" className="flex-1">
          <Button className="w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 gap-2 glow-green" data-testid="button-sticky-create">
            <Plus className="w-5 h-5" />
            {t('landing.hero.ctaCreate')}
          </Button>
        </Link>
        <Button
          variant="outline"
          size="icon"
          onClick={shareWhatsApp}
          className="rounded-xl border-secondary/30 shrink-0"
          aria-label={t('home.shareWhatsApp')}
          data-testid="button-sticky-whatsapp"
        >
          <SiWhatsapp className="w-5 h-5 text-[#25D366]" />
        </Button>
      </div>
      <div className="md:hidden h-20" aria-hidden />
    </div>
  );
}
