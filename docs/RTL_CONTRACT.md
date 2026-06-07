# RTL Layout Contract

This document is the authoritative reference for right-to-left (RTL) layout rules on the THADDI platform. All pages are rendered in Arabic by default (`lang="ar"`, `dir="rtl"` on `<html>`). Every layout decision must work correctly in both directions.

---

## 1. The root direction

`<html class="dark" dir={dir}>` is set by `I18nProvider` based on the active language. Arabic → `dir="rtl"`, English → `dir="ltr"`. Nothing in the application may override or ignore this — it is the single source of truth for bidirectional text rendering.

---

## 2. Tailwind logical vs physical classes

### Allowed — logical (direction-agnostic)

| Physical (banned) | Logical (use instead) |
|---|---|
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `left-*` / `right-*` | `start-*` / `end-*` |
| `text-left` / `text-right` | `text-start` / `text-end` |

The RTL guardrail (`scripts/rtl-guard.mjs`) AST-scans all class strings (including `cn()`, `cva()`, `clsx()` call sites and template literals) and fails CI when any physical class appears without an `rtl:`/`ltr:` variant prefix.

### Exceptions

- **`ltr:…` / `rtl:…` variant prefix** — marks a class as intentionally direction-specific. The guardrail allows it. Use sparingly and document why.
- **`left-1/2` / `right-1/2`** — centering transforms (`translateX(-50%)`); these are direction-neutral and are allowlisted.
- **`bg-gradient-to-r` / `bg-gradient-to-l`** — physical gradient directions. Always pair them: `ltr:bg-gradient-to-r rtl:bg-gradient-to-l`.

---

## 3. Inline `style={{ }}` props

Physical CSS property names in `style={{ }}` break RTL the same way physical Tailwind classes do. The RTL guardrail scans inline style props and fails CI for:

| Banned property | Logical alternative |
|---|---|
| `left` / `right` (positioning) | `insetInlineStart` / `insetInlineEnd` |
| `marginLeft` / `marginRight` | `marginInlineStart` / `marginInlineEnd` |
| `paddingLeft` / `paddingRight` | `paddingInlineStart` / `paddingInlineEnd` |
| `borderLeft*` / `borderRight*` | `borderInlineStart*` / `borderInlineEnd*` |
| `float: 'left'` / `float: 'right'` | Use flex/grid instead |
| `textAlign: 'left'` / `textAlign: 'right'` | `textAlign: 'start'` / `textAlign: 'end'` |

**Exception:** vendored Radix/shadcn primitives in `components/ui/` are excluded from the scan — they manage their own layout and must not be forked.

**Exception:** when a physical direction is genuinely intentional (e.g. an absolute-positioned tooltip pinned to a specific screen edge), wrap the element in `dir="ltr"` to establish an explicit LTR context and document the reason with a comment.

---

## 4. Football match grids — sports convention

Football match display (`home | score | away`) follows the universal sports convention: **home team is always on the left, away team always on the right**, regardless of the document direction. This is not a bug; it is an established convention that Arabic sports audiences expect.

All match grid containers in the application use `dir="ltr"` to enforce this:

```tsx
<div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4" dir="ltr">
  <TeamSide team={match.homeTeam} align="start" />
  <Score />
  <TeamSide team={match.awayTeam} align="end" />
</div>
```

Files that contain football match grids:
- `src/pages/home.tsx` — `NextMatchRow`
- `src/pages/match-detail.tsx` — `MatchHeader`
- `src/pages/match-center.tsx` — `MatchCard`
- `src/pages/landing.tsx` — `UpcomingMatchRow`
- `src/pages/schedule.tsx` — `MatchRow`

**Rule:** every new match display grid must carry `dir="ltr"`. The `TeamSide`/`UpcomingTeam` components already handle the visual difference between home (`[flag][name]`) and away (`[name][flag]`) presentation using `flex-row-reverse text-end` on the away side.

---

## 5. Directional icons — lucide arrows and chevrons

Icons that imply a physical direction (arrows, chevrons, corner arrows, double chevrons, side-panel toggles) must mirror in RTL. Add `rtl:rotate-180` (or `rtl:-scale-x-100`) so they point the correct way:

```tsx
<ChevronRight className="w-4 h-4 rtl:rotate-180" />
<ArrowLeft className="w-4 h-4 rtl:rotate-180" />
```

**Exception:** vertically-oriented rotations (`rotate-90`, `-rotate-90`) are direction-neutral and do not need an RTL mirror.

The guardrail maintains a `DIRECTIONAL_ICONS` set and fails CI when a listed icon appears without an RTL flip class.

---

## 6. Bidi number + Arabic label runs (countdown/score scramble)

Mixing a locale-formatted number (`formatNum(n, lang)`) directly with an Arabic/translated label in the same text run causes the Unicode bidirectional algorithm to scramble the output in RTL (e.g. `٤يوم ٥س ٣د` → garbled).

**Fix:** wrap each `number+label` unit in a Unicode First Strong Isolate (`\u2068…\u2069`):

```tsx
// Broken (scrambles in ar):
`${formatNum(cd.days, lang)}${t('countdown.days')}`

// Fixed:
`\u2068${formatNum(cd.days, lang)}${t('countdown.days')}\u2069`
```

The guardrail's `scanBidiScramble` pass detects:
1. Template literals and `+` concatenation that glues a `formatNum()` / `.toLocaleString()` result to a `t()` call or Arabic string literal with no separator and no isolate character.
2. `dir="ltr"` / `dir="rtl"` forced containers whose children build a multi-unit number+label run without isolates.

---

## 7. Gradients

All CSS gradients with a physical direction must carry both an `ltr:` and `rtl:` variant:

```tsx
// Correct:
className="ltr:bg-gradient-to-r rtl:bg-gradient-to-l from-secondary/5 to-transparent"

// Wrong (physical, breaks RTL):
className="bg-gradient-to-r from-secondary/5 to-transparent"
```

---

## 8. The RTL guardrail — what it checks

The shared guard lives in `scripts/rtl-guard.mjs`. Both artifacts run it via thin wrappers in their own `scripts/check-rtl.mjs`. The `rtl` validation runs both. CI fails if any check finds a violation.

| Check | What it detects |
|---|---|
| `scan()` | Physical Tailwind class tokens in `className` / `cn()` / `cva()` / `clsx()` strings; directional icons without an RTL flip |
| `scanBidiScramble()` | Un-isolated `formatNum()/toLocaleString()` + Arabic/translated-label glue runs |
| `scanInlineStyles()` | Physical CSS direction properties in JSX `style={{ }}` props |

### Running the guard locally

```bash
pnpm --filter @workspace/thaddi run check:rtl
pnpm --filter @workspace/mockup-sandbox run check:rtl
# or both at once via the registered validation:
# rtl validation (registered in workspace)
```

### Adding a new exception

If a physical class or style is genuinely needed:
1. For a **Tailwind class**: prefix with `rtl:` or `ltr:` and add a code comment explaining why.
2. For an **inline style**: either use the logical CSS equivalent or wrap the element in `dir="ltr"` with a comment.
3. If it is in **vendored code** (`components/ui/`): the scan already skips it — no action needed.
4. If it is a new **directional icon**: add `rtl:rotate-180` (or `rtl:-scale-x-100`).

---

## 9. Checklist for new components

When adding any new UI component or page:

- [ ] All spacing uses logical utilities (`ps/pe`, `ms/me`, `start/end`)
- [ ] No inline `style={{ left/right/marginLeft/… }}`; use logical CSS or `dir="ltr"` wrapper
- [ ] Gradient directions use `ltr:`/`rtl:` variants
- [ ] Arrows and chevron icons have `rtl:rotate-180`
- [ ] Number+label countdown/stat runs wrap each unit in `\u2068…\u2069`
- [ ] Football match grids have `dir="ltr"` on the grid container
- [ ] `pnpm --filter @workspace/thaddi run check:rtl` passes locally
