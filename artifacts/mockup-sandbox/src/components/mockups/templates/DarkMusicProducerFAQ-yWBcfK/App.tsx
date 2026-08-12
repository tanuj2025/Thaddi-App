import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ArrowUpRight, Disc3, Clock, DollarSign, Headphones, Mail } from 'lucide-react';

const FAQS = [
  {
    category: 'Process',
    q: 'What does a typical production process look like with you?',
    a: "Every project starts with a 30-minute discovery call where we talk references, vision, and where you are in your career. From there I build a rough demo within 7–10 days. We iterate together — usually 2–3 sessions, either in my Atlanta studio or remotely over a synced Pro Tools session — until the record feels undeniable. Mixing and a final master through my engineer at Sterling Sound close it out.",
  },
  {
    category: 'Process',
    q: 'Do I need to come to your studio, or can we work remotely?',
    a: "About 60% of my catalog over the last three years was produced remotely. I run real-time collaboration through Audiomovers and a private client portal where you can leave timestamped notes directly on the bounce. That said, if you can get to Atlanta, the in-room energy is hard to beat — vocal production especially benefits from being in the same space.",
  },
  {
    category: 'Process',
    q: 'Can you work from a voice memo or rough idea?',
    a: "Voice memos are honestly my favorite starting point. Some of the biggest records I've produced started as a 40-second hum recorded in a parking lot. Send whatever you have — a melody, a lyric fragment, even just a playlist of references — and I'll build the world around it.",
  },
  {
    category: 'Pricing',
    q: 'How much does a single cost to produce?',
    a: "Full production for a single starts at $2,500, which covers the instrumental, vocal production, arrangement, and two rounds of revisions. Mixing is an additional $800, mastering $250. EP and album packages are quoted per project and typically land 15–20% below the per-song rate. I also do select points-based deals for artists I believe in — ask me about it on our call.",
  },
  {
    category: 'Pricing',
    q: 'Do you take publishing or master points?',
    a: "On standard work-for-hire projects, no — you pay the fee, you own the master outright, and I take a customary producer split on publishing (typically 25–50% of the composition depending on my creative contribution). For development deals where I waive or reduce my fee, we negotiate master points. Everything is in writing before a single session happens.",
  },
  {
    category: 'Pricing',
    q: 'Is a deposit required to lock in dates?',
    a: "Yes — 50% upfront secures your dates on my calendar, with the balance due before final files are delivered. I book 6–8 weeks out, so the deposit is what actually holds your slot. It's fully refundable up to 14 days before our first session.",
  },
  {
    category: 'Logistics',
    q: 'How long does it take to finish a song?',
    a: "From first session to mastered final, plan on 3–5 weeks for a single. The production itself moves fast — it's the revision cycles and mix scheduling that add time. If you're working against a release date or sync deadline, tell me upfront and I can compress the timeline for a rush fee.",
  },
  {
    category: 'Logistics',
    q: 'What files do I get when the project is done?',
    a: "You receive the mastered WAV (24-bit/48kHz), an MP3 reference, instrumental and a cappella versions, performance stems, and a clean/radio edit if needed. TV mixes and Dolby Atmos deliverables are available as add-ons. Everything is delivered through a private archive link that stays live for 12 months.",
  },
  {
    category: 'Logistics',
    q: 'Do you offer mixing or mastering as a standalone service?',
    a: "I take on a limited number of mix-only projects each quarter — usually records that align with the genres I produce in (alt-R&B, indie pop, hip-hop). Standalone mixes start at $1,200 per song. I don't offer mastering as a standalone; I'd rather connect you with the engineers I trust.",
  },
  {
    category: 'Creative',
    q: 'What genres do you specialize in?',
    a: "My core lane is alternative R&B, indie pop, and melodic hip-hop — think the space between Steve Lacy, SZA, and Dominic Fike. But I came up engineering gospel and playing in punk bands, so I'm comfortable pulling from anywhere. The genre matters less to me than whether the song has a real point of view.",
  },
  {
    category: 'Creative',
    q: 'Will you shop my finished record to labels?',
    a: "I'm a producer, not an A&R — but my managers at Range Media do hear everything that comes out of my studio. If a record genuinely excites the team, introductions happen organically. I never promise placement, and I'd be skeptical of any producer who does.",
  },
  {
    category: 'Creative',
    q: 'Can I credit you, and how should the credit read?',
    a: 'Yes, please do — credits matter for both of us. The standard line is "Produced by Marlowe Vance." For splits, additional production, or co-production, the exact language goes in our split sheet, which we sign before release. Tag @marlowevance on socials and I will repost — every time.',
  },
];

const CATEGORIES = ['All', 'Process', 'Pricing', 'Logistics', 'Creative'] as const;

type FaqItemData = (typeof FAQS)[number];
type Category = (typeof CATEGORIES)[number];

const CAT_ICONS: Partial<Record<Category, typeof Disc3>> = {
  Process: Disc3,
  Pricing: DollarSign,
  Logistics: Clock,
  Creative: Headphones,
};

function FaqItem({
  item,
  index,
  isOpen,
  onToggle,
}: {
  item: FaqItemData;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`group border-b border-[#2a261f] transition-colors duration-300 ${isOpen ? 'bg-[#16140f]' : 'hover:bg-[#14120e]'}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-6 md:gap-10 py-7 md:py-8 px-5 md:px-8 text-start"
      >
        <span className="font-mono text-[11px] tracking-[0.2em] text-[#6b6353] pt-[7px] tabular-nums shrink-0">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="flex-1">
          <span className={`block font-serif text-xl md:text-[26px] leading-snug transition-colors duration-300 ${isOpen ? 'text-[#e8a33d]' : 'text-[#ece5d8] group-hover:text-[#e8a33d]'}`}>
            {item.q}
          </span>
          <span className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.25em] text-[#6b6353]">
            {item.category}
          </span>
        </span>
        <span className={`shrink-0 mt-1 w-9 h-9 rounded-full border flex items-center justify-center transition-all duration-300 ${isOpen ? 'border-[#e8a33d] bg-[#e8a33d] rotate-45' : 'border-[#3a352b] group-hover:border-[#e8a33d]'}`}>
          <Plus size={16} className={isOpen ? 'text-[#0e0c09]' : 'text-[#a59a85]'} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 0.8, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="ps-5 md:ps-[7.5rem] pe-6 md:pe-28 pb-9">
              <p className="text-[#b3a890] leading-relaxed text-[15px] md:text-base max-w-2xl">
                {item.a}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const [activeCat, setActiveCat] = useState('All');
  const [openIndex, setOpenIndex] = useState(0);

  const filtered = FAQS.filter((f) => activeCat === 'All' || f.category === activeCat);

  return (
    <div className="min-h-screen bg-[#0e0c09] text-[#ece5d8] antialiased selection:bg-[#e8a33d] selection:text-[#0e0c09]">
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: `
        .font-serif { font-family: 'Fraunces', serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        body, .font-sans { font-family: 'Inter', sans-serif; }
        .grain::before {
          content: '';
          position: fixed; inset: 0; pointer-events: none; z-index: 50;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
        }
        @keyframes spin-slow { to { transform: rotate(360deg); } }
        .spin-slow { animation: spin-slow 14s linear infinite; }
        @keyframes eq {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        .eq-bar { animation: eq 1.1s ease-in-out infinite; transform-origin: bottom; }
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #0e0c09; }
        ::-webkit-scrollbar-thumb { background: #2a261f; border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a352b; }
      `}} />

      <div className="grain" />

      {/* Top bar */}
      <header className="border-b border-[#2a261f]">
        <div className="max-w-6xl mx-auto px-5 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-7 h-7">
              <Disc3 size={28} className="text-[#e8a33d] spin-slow" />
            </div>
            <span className="font-mono text-xs tracking-[0.3em] uppercase">Marlowe Vance</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 font-mono text-[11px] tracking-[0.2em] uppercase text-[#a59a85]">
            <a href="#" className="hover:text-[#e8a33d] transition-colors">Work</a>
            <a href="#" className="hover:text-[#e8a33d] transition-colors">Studio</a>
            <a href="#" className="text-[#e8a33d]">FAQ</a>
            <a href="#" className="flex items-center gap-1.5 text-[#ece5d8] hover:text-[#e8a33d] transition-colors">
              Book a session <ArrowUpRight size={13} className="rtl:rotate-180" />
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-5 md:px-8 pt-20 md:pt-28 pb-16">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-10">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-[#e8a33d] mb-6 flex items-center gap-3">
              <span className="inline-flex items-end gap-[3px] h-3">
                <span className="eq-bar w-[3px] h-full bg-[#e8a33d]" style={{ animationDelay: '0s' }} />
                <span className="eq-bar w-[3px] h-full bg-[#e8a33d]" style={{ animationDelay: '0.2s' }} />
                <span className="eq-bar w-[3px] h-full bg-[#e8a33d]" style={{ animationDelay: '0.4s' }} />
                <span className="eq-bar w-[3px] h-full bg-[#e8a33d]" style={{ animationDelay: '0.1s' }} />
              </span>
              Frequently Asked
            </p>
            <h1 className="font-serif font-light text-[clamp(2.8rem,7vw,5.5rem)] leading-[0.95] tracking-tight">
              Before we make
              <br />
              <em className="text-[#e8a33d] not-italic font-normal" style={{ fontStyle: 'italic' }}>the record.</em>
            </h1>
          </div>
          <p className="max-w-xs text-[#a59a85] text-[15px] leading-relaxed md:pb-3">
            Everything artists ask me before booking a session — process, pricing, splits, and what it's actually like to work together. If it's not answered here, it's a quick email away.
          </p>
        </div>
      </section>

      {/* Category filters */}
      <div className="max-w-6xl mx-auto px-5 md:px-8 mb-2">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat === 'All' ? undefined : CAT_ICONS[cat];
            const active = activeCat === cat;
            return (
              <button
                key={cat}
                onClick={() => { setActiveCat(cat); setOpenIndex(0); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-[11px] uppercase tracking-[0.18em] border transition-all duration-300 ${
                  active
                    ? 'bg-[#e8a33d] border-[#e8a33d] text-[#0e0c09]'
                    : 'border-[#2a261f] text-[#a59a85] hover:border-[#e8a33d]/60 hover:text-[#ece5d8]'
                }`}
              >
                {Icon && <Icon size={13} />}
                {cat}
                <span className={`tabular-nums ${active ? 'text-[#0e0c09]/60' : 'text-[#6b6353]'}`}>
                  {cat === 'All' ? FAQS.length : FAQS.filter((f) => f.category === cat).length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* FAQ list */}
      <main className="max-w-6xl mx-auto px-0 md:px-8 mt-8 mb-24">
        <div className="border-t border-[#2a261f]">
          <AnimatePresence mode="popLayout">
            {filtered.map((item, i) => (
              <motion.div
                key={item.q}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, delay: i * 0.03 }}
              >
                <FaqItem
                  item={item}
                  index={i}
                  isOpen={openIndex === i}
                  onToggle={() => setOpenIndex(openIndex === i ? -1 : i)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>

      {/* CTA */}
      <section className="border-t border-[#2a261f] bg-[#13110c]">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-[#6b6353] mb-5">Still have a question?</p>
            <h2 className="font-serif font-light text-4xl md:text-5xl leading-tight">
              Send the voice memo.
              <br />I'll hear the record in it.
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row md:justify-end gap-4">
            <a
              href="mailto:studio@marlowevance.com"
              className="group inline-flex items-center justify-center gap-3 bg-[#e8a33d] text-[#0e0c09] font-medium px-7 py-4 rounded-full hover:bg-[#f3b75a] transition-colors"
            >
              <Mail size={17} />
              studio@marlowevance.com
              <ArrowUpRight size={16} className="rtl:rotate-180 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
            <a
              href="#"
              className="inline-flex items-center justify-center gap-2 border border-[#3a352b] px-7 py-4 rounded-full text-[#ece5d8] hover:border-[#e8a33d] hover:text-[#e8a33d] transition-colors font-medium"
            >
              Book a discovery call
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#2a261f]">
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-[11px] tracking-[0.2em] uppercase text-[#6b6353]">
          <span>© 2025 Marlowe Vance — Atlanta, GA</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-[#e8a33d] transition-colors">Spotify</a>
            <a href="#" className="hover:text-[#e8a33d] transition-colors">Instagram</a>
            <a href="#" className="hover:text-[#e8a33d] transition-colors">Discogs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}