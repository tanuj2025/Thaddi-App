---
name: thaddi-mobile multi-competition / season
description: How the Expo app was made multi-competition + season-aware (mirroring web), incl. the optional favourite-club step and the screen-test provider contract.
---

# THADDI mobile — multi-competition & season-aware

The native app mirrors the web's multi-competition transformation. Source of truth for COPY and
behaviour is the merged web app; mobile re-expresses it in RN. Backend is consumed only through the
generated `@workspace/api-client-react` client.

## Competition context (lib/competition.tsx)
- AsyncStorage-backed (async hydrate like intro), jsdom/test-safe try-catch. `isReady = !isLoading && hydrated`
  and it GATES every scoped read (`enabled: isReady && !comingSoon`). The switcher is a RN BottomSheet,
  NOT a DropdownMenu.
- Scoped reads (matches, home live/upcoming, rankings) follow the orval queryKey rule: any hook passing
  `query:{...}` must also pass `queryKey: getGet<Name>QueryKey(args)`.
- **Provider mount order:** `_layout.tsx` mounts `CompetitionProvider` inside `QueryClientProvider`,
  wrapping I18n/Intro. Provider only needs react-query (public `useGetCompetitions`), not Clerk.

## Screen smoke-test contract (__tests__/screens.test.tsx)
- The `renderScreen` harness MUST wrap the screen in `CompetitionProvider` (inside QueryClientProvider,
  around I18nProvider) — any screen calling `useCompetition()` throws "must be used within
  CompetitionProvider" otherwise. When a screen newly takes a context dependency, the smoke harness has
  to grow the matching provider or all its render cases fail.
- **Why:** the smoke tests render real screens; they reproduce the app's provider requirements.

## Favourite club = OPTIONAL, non-blocking (deliberate)
- Favourite *club* is additive to the national-*team* activation gate. It is NOT added to
  `nextActivationRoute` and ActivationGate is untouched — activated users are NEVER force-redirected to
  pick a club.
- Flow: `pick-team` onSuccess (non-change) routes to `/(activation)/pick-club` only when
  `!favoriteClubSelected`, else straight to tabs. `pick-club` skip/save (non-change) → tabs. Both
  pick-team and pick-club double as change screens via `?change=1` (→ `router.back()`); profile uses that.
- Home `FavoriteClubNudge` shows only for `favoriteTeamSelected && !favoriteClubSelected`; one-time
  dismissal persists under AsyncStorage key `thaddi.favoriteClubNudgeDismissed.<userId>` (note: web uses
  a colon-delimited prefix; the mobile key is dot-delimited and per-user).
- Club save uses `useUpdateFavoriteClub` with body `{ data: { teamId } }`, then seeds
  `getGetMeQueryKey()` BEFORE navigating (or the gate bounces back).

## De-World-Cup copy (i18n)
- When stripping WC-2026 framing from strings, KEEP the legitimate competition labels `type.world_cup`
  and `schedule.tab.wc` — they name a real competition, not the platform. `landing.social.teams` stays
  "World Cup Teams" / "منتخبات كأس العالم" because the merged web kept it that way (mirror, don't
  over-strip). AR/EN parity must hold and interpolation tokens (`{plan}`, `{price}`, `{n}`) stay intact.

## Dropped: challenge-create competition/season (mobile M4)
- Same contract gap as web: the generated challenge-create body has no `competitionSlug`/`season`, and
  there is no public tournament/season listing endpoint. `create.tsx` left unchanged. A separate
  backend-extension follow-up tracks closing the gap — do not re-attempt client-side.
