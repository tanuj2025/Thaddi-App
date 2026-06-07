---
name: THADDI design system
description: The platform-wide visual concept and styling conventions for the THADDI web app.
---

## Concept: "dark premium stadium"
THADDI's whole UI (user pages AND admin panel) follows one concept — deep navy/charcoal
backgrounds, rich trophy GOLD accents (the `secondary` token), vivid Saudi GREEN primary,
leaderboard/championship prestige. Arabic-first, full RTL/LTR.

**Why:** the platform was deliberately re-skinned to a single cohesive concept; new pages must
join it, not introduce a competing look.

**How to apply:**
- Theme is user-switchable (dark default). `ThemeProvider` (`src/lib/theme.tsx`) toggles the
  `dark` class on `<html>` and persists `localStorage('thaddi_theme')`; an anti-FOUC inline
  script in `index.html` <head> applies the saved/default-dark class pre-paint. Reusable
  `ThemeToggle` (`components/theme-toggle.tsx`, Sun/Moon) sits in every nav (landing nav+footer,
  schedule, legal, layout desktop+mobile — give each a unique `testId`). The `.dark` palette is
  the premium stadium; the `:root` palette is the light counterpart. Both live in `index.css`.
  Keep styling token-based so both themes adapt; theme-specific utility tweaks go under `.dark`
  (e.g. `.text-gold-gradient` uses a deeper gold in light, bright shimmer in dark).
- Style with semantic tokens (`bg-background`, `bg-card`, `text-foreground`,
  `text-muted-foreground`, `text-primary` = green, `text-secondary` = gold, `border-border`,
  `ring`). NEVER hardcode hex/rgb colors.
- Reuse the custom utility classes defined in `index.css` for consistency instead of reinventing:
  `bg-stadium` (page backdrop with green+gold glows), `card-premium` (premium card surface),
  `glow-gold` / `glow-green` (accent shadow for featured/winner elements), `text-gold-gradient`
  (gold shimmer for key headings/numbers/winners), `divider-gold` (gold hairline).
- Keep RTL correctness via logical properties (`ms-/me-/ps-/pe-/start-/end-/text-start/end`),
  never `left`/`right`. No emojis in the UI.
- Shared shells `components/layout.tsx` (user) and `components/admin/admin-layout.tsx` (admin)
  are the reference for active-nav treatment (inset primary ring + gold edge-bar, backdrop blur).
