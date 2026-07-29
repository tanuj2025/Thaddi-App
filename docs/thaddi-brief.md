# thaddi — Product Brief

## 1. What is thaddi?

**thaddi** (تطبيق تحدي — *taḥaddi* means "challenge") is an **Arabic-first football prediction and competition platform** for the Saudi and wider Gulf market. Fans predict match scorelines, compete against friends in private or public challenges, climb leaderboards, and earn badges and achievements.

- **Not gambling** — it's a skill-based prediction game. No stakes, no odds, no payouts of money. Revenue comes from participation tiers and cosmetics, not wagering.
- **Bilingual & RTL-native** — full Arabic/English, Arabic as the default with right-to-left layout throughout.
- **Available on** the web (thaddi.app) and as a native **iOS app** (Android in progress).
- **Positioning** — the social layer around live football: you and your circle (friends, family, coworkers) run a season-long prediction league together.

---

## 2. Scope

thaddi launched around the **2026 World Championship** (shown publicly as "**World Championship 2026 / بطولة العالم 2026**" for App Store compliance) and is built to expand well beyond a single tournament.

- **Live match data** flows in automatically from a real-time sports feed (scores, kickoff times, live status), so predictions lock at kickoff and scoring happens as results come in.
- The system is architected around **competitions × seasons**, meaning new tournaments and new seasons plug in without rebuilding the product.

---

## 3. Target Users

| Segment | Description |
|---|---|
| **Core fans** | Arabic-speaking football fans in Saudi Arabia and the Gulf who follow the World Championship and major leagues. |
| **Challenge owners** | The person who sets up a competition and invites others — the social organizer within a friend group, family, or workplace. |
| **Participants** | Friends/colleagues who join a challenge via invite code or public link and predict alongside everyone else. |
| **Businesses (upcoming)** | Companies running branded/corporate prediction competitions for staff or customers — served by the forthcoming Business tier. |

---

## 4. Features & Functionality

**Predictions & scoring**
- Predict the exact scoreline of each match; picks **lock exactly at kickoff**.
- Simple, transparent scoring: **exact scoreline = 3 pts, correct winner (incl. draw) = 1 pt, otherwise 0**. No stacking.
- Prediction visibility controls per challenge: hidden, reveal-after-kickoff, or always visible.

**Challenges (the core social unit)**
- Create **private** (invite-code) or **public/unlisted** challenges.
- **Participant limits** scale with your plan; the limit is a **shared pool across all the challenges you own**.
- **Custom prizes** and **co-owners/assistants** on paid tiers.

**Competition & rankings**
- Live standings with **rank movement** and **accuracy stats**.
- Advanced surfaces (feature-gated): **winning probability, prediction comparison, rare-prediction insights**.

**Gamification & social**
- **Levels** by lifetime points: Bronze → Silver → Gold → Elite → Legend.
- **Earnable badges** and **Hall of Fame achievements** (e.g. World Championship Winner, Top Predictor).
- **Social graph**: friends, following, public profiles with prediction-privacy controls.
- **Notifications** (in-app + email): prediction closing, match starting, ranking updated, competition ending, badge unlocked, competition won.

**Accounts & trust**
- Sign-in via **email/password, Google, and Apple**.
- **Mobile number verification** (OTP) as an anti-cheating measure — one verified number per account.
- Favourite national team (and, with league expansion, favourite club) selection.

**Admin & operations**
- Admin panel for data sync, catalog management, plan/member overrides, and **analytics** (traffic, geography, device breakdown) with a full audit log.

---

## 5. Pricing & Pricing Model

thaddi uses a **season-pass model** — a one-time purchase that grants premium access **for the current season** (not an auto-renewing subscription). One active pass per season; buying again next season is a fresh purchase. Prices are in **SAR**.

| Tier | Price | Max participants / challenge | Advanced stats | Custom prizes | Premium features | Priority support |
|---|---|---|---|---|---|---|
| **Beginner** (المبتدئ) | **Free** | 20 | — | — | — | — |
| **Professional** (المحترف) | **200 SAR** | 100 | ✅ | ✅ | — | — |
| **Legend** (الأسطورة) | **1,000 SAR** | 500 | ✅ | ✅ | ✅ | ✅ |
| **Business** (الأعمال) | *Coming soon* | Unlimited | — enterprise / custom — | | | |

**How buyers pay**
- **Web:** Moyasar hosted checkout (Saudi payment gateway, real SAR).
- **iOS:** Apple In-App Purchase via RevenueCat (required by Apple; no external payment on mobile).
- **Upgrades:** pay the full price of the higher tier (must be strictly more expensive); the old pass is cancelled, no proration.
- **Admin grants:** staff can assign a plan manually (e.g. comps, business deals) without a payment.

**Secondary revenue — Challenge Badges**
- A catalog of ~20 **decorative emblems** (Golden Trophy, Champion's Crown, Golden Boot, etc.) that an owner or participant can buy to attach to a specific challenge.
- Priced **~8–20 SAR each** (real money via Moyasar). Purely cosmetic — no gameplay advantage. *(Excluded on iOS to satisfy Apple's rules.)*

---

## 6. Expansion Plans

- **Multi-competition rollout** — beyond the World Championship, the platform already carries season shells for **Saudi Pro League, King's Cup, English Premier League, and La Liga**, shown as "coming soon" until each season goes live. This turns thaddi from a one-off tournament app into a **year-round** football companion.
- **Season-over-season continuity** — editions/seasons are first-class, so returning users buy a new pass each season and prior boards live on in the Hall of Fame.
- **Business/Enterprise tier** — unlimited-participant, branded corporate competitions.
- **Platform reach** — iOS is live; **Android** is the next platform milestone.
- **Deeper personalization** — favourite domestic club alongside favourite national team, tying league expansion to the fan's own team.
