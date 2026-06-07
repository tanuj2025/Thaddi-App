import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView } from 'framer-motion';
import { useI18n } from '../lib/i18n';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { useGetPlatformStats, useTrackAnalyticsEvent, type RankingEntry } from '@workspace/api-client-react';
import { Leaderboard } from '../components/leaderboard';
import { useCountdown } from '../lib/matchUtils';
import { formatNum } from '../lib/matchUtils';
import { SiWhatsapp, SiX, SiInstagram, SiTiktok } from 'react-icons/si';
import {
  Trophy,
  Users,
  Share2,
  Activity,
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
} from 'lucide-react';

const WORLD_CUP_KICKOFF = '2026-06-11T20:00:00Z';

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
    <div className={`flex flex-col sm:flex-row gap-4 justify-center items-stretch sm:items-center ${className}`}>
      <Link href="/sign-up" className="w-full sm:w-auto">
        <Button
          size={size}
          className={`w-full sm:w-auto rounded-full bg-primary text-primary-foreground hover:bg-primary/90 glow-green transition-all gap-2 ${size === 'lg' ? 'text-lg px-8 py-6' : ''}`}
          data-testid="button-create-challenge"
        >
          <Plus className="w-5 h-5" />
          {t('landing.hero.ctaCreate')}
        </Button>
      </Link>
      <Link href="/challenges" className="w-full sm:w-auto">
        <Button
          size={size}
          variant="outline"
          className={`w-full sm:w-auto rounded-full bg-card/50 backdrop-blur-sm border-secondary/30 hover:bg-secondary/10 hover:text-secondary transition-all gap-2 ${size === 'lg' ? 'text-lg px-8 py-6' : ''}`}
          data-testid="button-join-challenge"
        >
          <Trophy className="w-5 h-5" />
          {t('landing.hero.ctaJoin')}
        </Button>
      </Link>
    </div>
  );
}

function HeroMock() {
  const { t, lang } = useI18n();
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute inset-0 glow-green opacity-30 blur-3xl rounded-[2.5rem]" />
      <div className="relative card-premium rounded-[2.25rem] p-3 ring-1 ring-secondary/20 shadow-2xl">
        <div className="rounded-[1.75rem] bg-background/80 overflow-hidden border border-border/60">
          {/* Match prediction */}
          <div className="p-5 border-b border-border/40">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('landing.mock.predict')}
              </span>
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-red-500">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {t('landing.mock.live')} 78&apos;
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col items-center gap-1.5 flex-1">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center ring-1 ring-primary/30">
                  <Flag className="w-5 h-5 text-primary" />
                </div>
                <span className="text-xs font-bold text-center">{t('landing.live.exampleHome')}</span>
              </div>
              <div className="flex items-center gap-2 text-2xl font-black tabular-nums">
                <span className="text-primary">{formatNum(2, lang)}</span>
                <span className="text-muted-foreground/50">-</span>
                <span>{formatNum(1, lang)}</span>
              </div>
              <div className="flex flex-col items-center gap-1.5 flex-1">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center ring-1 ring-border">
                  <Flag className="w-5 h-5 text-muted-foreground" />
                </div>
                <span className="text-xs font-bold text-center">{t('landing.live.exampleAway')}</span>
              </div>
            </div>
          </div>
          {/* Ranking movement */}
          <div className="p-5 space-y-2.5">
            <div className="flex items-center gap-3 rounded-xl bg-secondary/10 ring-1 ring-secondary/30 px-3 py-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-[0_0_12px_rgba(234,179,8,0.4)]">
                <Trophy className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-bold flex-1 truncate">{t('landing.board.name1')}</span>
              <span className="text-sm font-black text-secondary tabular-nums">{formatNum(2480, lang)}</span>
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-primary/10 ring-1 ring-primary/30 px-3 py-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary font-black text-sm tabular-nums">
                {formatNum(3, lang)}
              </div>
              <span className="text-sm font-bold flex-1 truncate text-primary">{t('landing.mock.you')}</span>
              <span className="flex items-center gap-0.5 text-emerald-500 text-xs font-bold">
                <ArrowRight className="w-3.5 h-3.5 -rotate-90" />
                {formatNum(9, lang)}
              </span>
              <span className="text-sm font-black text-primary tabular-nums">{formatNum(1420, lang)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ value, label, accent }: { value: number; label: string; accent: 'green' | 'gold' | 'plain' }) {
  const color = accent === 'green' ? 'text-primary' : accent === 'gold' ? 'text-secondary' : 'text-foreground';
  return (
    <div className="card-premium p-6 rounded-2xl text-center relative overflow-hidden">
      {accent === 'gold' && <div className="absolute inset-x-0 top-0 h-1 bg-secondary glow-gold" />}
      {accent === 'green' && <div className="absolute inset-x-0 top-0 h-1 bg-primary glow-green" />}
      <div className={`text-3xl md:text-4xl font-black mb-2 tabular-nums ${color}`}>
        <CountUp value={value} />
      </div>
      <div className="text-xs md:text-sm font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}

function StepCard({ index, title, desc, icon: Icon }: { index: number; title: string; desc: string; icon: React.ElementType }) {
  const { lang } = useI18n();
  return (
    <div className="card-premium p-6 rounded-2xl relative h-full hover:ring-1 hover:ring-secondary/30 transition-all">
      <div className="absolute top-4 end-4 text-5xl font-black text-secondary/10 tabular-nums select-none">
        {formatNum(index, lang)}
      </div>
      <div className="w-12 h-12 rounded-xl bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function WhyCard({ title, desc, icon: Icon }: { title: string; desc: string; icon: React.ElementType }) {
  return (
    <div className="card-premium p-6 rounded-2xl h-full hover:ring-1 hover:ring-secondary/30 transition-all group">
      <div className="w-12 h-12 rounded-xl bg-secondary/10 ring-1 ring-secondary/25 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
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
    <div className="card-premium rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-start"
        data-testid="faq-toggle"
      >
        <span className="font-bold text-base">{q}</span>
        <ChevronDown className={`w-5 h-5 shrink-0 text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
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
    <div className="card-premium rounded-2xl p-4 md:p-6 min-w-[72px] md:min-w-[110px] text-center">
      <div className="text-3xl md:text-5xl font-black text-gold-gradient tabular-nums">
        {formatNum(value, lang)}
      </div>
      <div className="text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
    </div>
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
    <div className={`card-premium rounded-2xl p-6 text-center ring-1 ${ringClass}`}>
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

export default function LandingPage() {
  const { t, lang, setLang } = useI18n();
  const { data: stats } = useGetPlatformStats();
  const trackEvent = useTrackAnalyticsEvent();
  const cd = useCountdown(WORLD_CUP_KICKOFF);

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

  const SectionHeading = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <Reveal className="text-center max-w-2xl mx-auto mb-12">
      <h2 className="text-3xl md:text-5xl font-black tracking-tight text-gold-gradient pb-1">{title}</h2>
      {subtitle && <p className="text-base md:text-lg text-muted-foreground mt-3">{subtitle}</p>}
      <div className="divider-gold h-px w-24 mx-auto mt-6" />
    </Reveal>
  );

  return (
    <div className="min-h-[100dvh] bg-stadium flex flex-col">
      {/* ===== NAV ===== */}
      <header className="border-b border-border bg-card/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <button onClick={() => scrollTo('home')} className="flex items-center gap-2 shrink-0" data-testid="link-logo">
            <img src="/logo.svg" alt="THADDI" className="h-8 w-auto" />
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
            <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5 font-semibold" data-testid="button-lang-toggle">
              <Languages className="w-4 h-4" />
              {lang === 'ar' ? 'English' : 'العربية'}
            </Button>
            <Link href="/sign-in" className="hidden sm:inline text-sm font-medium hover:text-secondary transition-colors">
              {t('auth.signIn')}
            </Link>
            <Link href="/sign-up">
              <Button size="sm" className="bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-gold gap-1.5" data-testid="button-signup-header">
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
          <div className="container mx-auto grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            <div className="text-center lg:text-start">
              <Reveal>
                <div className="inline-flex items-center gap-2 rounded-full bg-secondary/10 ring-1 ring-secondary/25 px-4 py-1.5 mb-6">
                  <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider">{t('landing.trust.worldCup')}</span>
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
              <Reveal delay={0.4}>
                <div className="flex flex-wrap gap-x-5 gap-y-2 justify-center lg:justify-start mt-8">
                  {[t('landing.trust.worldCup'), t('landing.trust.bilingual'), t('landing.trust.free'), t('landing.trust.whatsapp')].map((label) => (
                    <span key={label} className="inline-flex items-center gap-1.5 text-xs md:text-sm font-medium text-muted-foreground">
                      <Check className="w-4 h-4 text-primary" />
                      {label}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>

            <Reveal delay={0.2} className="hidden lg:block">
              <HeroMock />
            </Reveal>
            <Reveal delay={0.2} className="lg:hidden">
              <HeroMock />
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
                <StatCard value={48} label={t('landing.social.teams')} accent="plain" />
              </div>
            </Reveal>
          </div>
        </section>

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
                    <div key={i} className="card-premium rounded-2xl p-5 flex items-start gap-4">
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap ${row.color}`}>{row.phase}</span>
                      <p className="text-sm text-muted-foreground leading-relaxed pt-1">{row.desc}</p>
                    </div>
                  ))}
                </div>
              </Reveal>

              <Reveal delay={0.15}>
                <div className="card-premium rounded-3xl p-6 glow-green relative overflow-hidden">
                  <div className="flex items-center justify-between mb-5">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-red-500">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      {t('landing.mock.live')} 78&apos;
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('nav.matches')}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 mb-6">
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <div className="w-12 h-12 rounded-full bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
                        <Flag className="w-6 h-6 text-primary" />
                      </div>
                      <span className="text-sm font-bold text-center">{t('landing.live.exampleHome')}</span>
                    </div>
                    <div className="text-4xl font-black tabular-nums flex items-center gap-2">
                      <span className="text-primary">{formatNum(2, lang)}</span>
                      <span className="text-muted-foreground/40">-</span>
                      <span>{formatNum(1, lang)}</span>
                    </div>
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <div className="w-12 h-12 rounded-full bg-muted ring-1 ring-border flex items-center justify-center">
                        <Flag className="w-6 h-6 text-muted-foreground" />
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

        {/* ===== LEADERBOARD SHOWCASE ===== */}
        <section className="px-4 py-16 border-t border-border/40">
          <div className="container mx-auto">
            <SectionHeading title={t('landing.board.title')} subtitle={t('landing.board.subtitle')} />
            <Reveal className="max-w-2xl mx-auto">
              <div className="card-premium rounded-3xl overflow-hidden glow-gold">
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

        {/* ===== WORLD CUP COUNTDOWN ===== */}
        <section className="px-4 py-20 border-t border-border/40 relative overflow-hidden">
          <div className="absolute inset-0 glow-green opacity-10 blur-3xl" />
          <div className="container mx-auto relative">
            <SectionHeading title={t('landing.countdown.title')} subtitle={t('landing.countdown.subtitle')} />
            <Reveal>
              {cd && !cd.done ? (
                <div className="flex justify-center gap-3 md:gap-5 flex-wrap" dir="ltr">
                  <CountdownUnit value={cd.days} label={t('landing.countdown.days')} />
                  <CountdownUnit value={cd.hours} label={t('landing.countdown.hours')} />
                  <CountdownUnit value={cd.minutes} label={t('landing.countdown.minutes')} />
                  <CountdownUnit value={cd.seconds} label={t('landing.countdown.seconds')} />
                </div>
              ) : (
                <div className="text-center text-2xl font-black text-gold-gradient flex items-center justify-center gap-3">
                  <CalendarClock className="w-7 h-7 text-secondary" />
                  {t('landing.countdown.kickoff')}
                </div>
              )}
            </Reveal>
            <Reveal className="text-center mt-10">
              <Link href="/sign-up">
                <Button size="lg" className="rounded-full text-lg px-8 py-6 bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-gold gap-2" data-testid="button-countdown-cta">
                  <Plus className="w-5 h-5" />
                  {t('landing.countdown.cta')}
                </Button>
              </Link>
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
              <img src="/logo.svg" alt="THADDI" className="h-8 w-auto mx-auto md:mx-0 mb-3" />
              <p className="text-sm font-semibold text-secondary">Predict. Compete. Win.</p>
              <p className="text-sm font-semibold text-secondary" dir="rtl">توقّع. نافس. اكسب.</p>
            </div>

            <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              <button onClick={() => scrollTo('features')} className="text-sm text-muted-foreground hover:text-secondary transition-colors">{t('landing.nav.features')}</button>
              <button onClick={() => scrollTo('faq')} className="text-sm text-muted-foreground hover:text-secondary transition-colors">{t('landing.nav.faq')}</button>
              <span className="text-sm text-muted-foreground/70 cursor-default">{t('landing.footer.terms')}</span>
              <span className="text-sm text-muted-foreground/70 cursor-default">{t('landing.footer.privacy')}</span>
            </nav>

            <div className="flex items-center justify-center gap-4">
              <Button variant="ghost" size="sm" onClick={toggleLanguage} className="gap-1.5 font-semibold" data-testid="button-lang-toggle-footer">
                <Languages className="w-4 h-4" />
                {lang === 'ar' ? 'English' : 'العربية'}
              </Button>
              <div className="flex items-center gap-3">
                <a href="https://x.com" target="_blank" rel="noopener noreferrer" aria-label="X" className="text-muted-foreground hover:text-secondary transition-colors">
                  <SiX className="w-5 h-5" />
                </a>
                <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-muted-foreground hover:text-secondary transition-colors">
                  <SiInstagram className="w-5 h-5" />
                </a>
                <a href="https://tiktok.com" target="_blank" rel="noopener noreferrer" aria-label="TikTok" className="text-muted-foreground hover:text-secondary transition-colors">
                  <SiTiktok className="w-5 h-5" />
                </a>
              </div>
            </div>
          </div>
          <div className="divider-gold h-px w-full mt-8 mb-6" />
          <p className="text-center text-xs text-muted-foreground">THADDI · {t('landing.footer.rights')}</p>
        </div>
      </footer>

      {/* ===== STICKY MOBILE CTA ===== */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card/90 backdrop-blur-xl px-4 py-3 flex items-center gap-3">
        <Link href="/sign-up" className="flex-1">
          <Button className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2 glow-green" data-testid="button-sticky-create">
            <Plus className="w-5 h-5" />
            {t('landing.hero.ctaCreate')}
          </Button>
        </Link>
        <Button
          variant="outline"
          size="icon"
          onClick={shareWhatsApp}
          className="rounded-full border-secondary/30 shrink-0"
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
