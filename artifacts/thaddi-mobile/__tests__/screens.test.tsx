/**
 * Screen smoke tests.
 *
 * Each key screen is mounted with the real i18n provider + react-query client
 * and the external seams mocked (see jest/setup.ts). The assertion is simply
 * that the screen renders without throwing — this catches import errors, broken
 * hooks, hook-rule violations and crashes in a screen's top-level render that
 * would otherwise only surface when someone opens the app by hand.
 *
 * Screens are rendered in both Arabic (default, RTL) and English (LTR) so a
 * direction-dependent render crash is caught too.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react-native";
import React from "react";

import { I18nProvider, useI18n } from "@/lib/i18n";
import { CompetitionProvider } from "@/lib/competition";

import HomeScreen from "@/app/(tabs)/index";
import RankingsScreen from "@/app/(tabs)/rankings";
import ProfileScreen from "@/app/(tabs)/profile";
import MatchesScreen from "@/app/(tabs)/matches";
import ChallengesScreen from "@/app/(tabs)/challenges";
import MatchDetailScreen from "@/app/match/[id]";
import ChallengeDetailScreen from "@/app/challenge/[id]/index";
import CreateChallengeScreen from "@/app/challenge/create";
import NotificationsScreen from "@/app/notifications";
import SocialScreen from "@/app/social";
import PlayerProfileScreen from "@/app/players/[id]";

/** Flips the i18n language to English once mounted (default is Arabic/RTL). */
function ForceEnglish() {
  const { setLang, lang } = useI18n();
  React.useEffect(() => {
    if (lang !== "en") setLang("en");
  }, [lang, setLang]);
  return null;
}

function renderScreen(
  ui: React.ReactElement,
  { english = false }: { english?: boolean } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CompetitionProvider>
        <I18nProvider>
          {english ? <ForceEnglish /> : null}
          {ui}
        </I18nProvider>
      </CompetitionProvider>
    </QueryClientProvider>,
  );
}

const SCREENS: Array<{ name: string; element: React.ReactElement }> = [
  { name: "Home", element: <HomeScreen /> },
  { name: "Rankings", element: <RankingsScreen /> },
  { name: "Profile", element: <ProfileScreen /> },
  { name: "Matches", element: <MatchesScreen /> },
  { name: "Challenges", element: <ChallengesScreen /> },
  { name: "Match center (match detail)", element: <MatchDetailScreen /> },
  { name: "Challenge detail", element: <ChallengeDetailScreen /> },
  { name: "Create challenge", element: <CreateChallengeScreen /> },
  { name: "Notifications", element: <NotificationsScreen /> },
  { name: "Social", element: <SocialScreen /> },
  { name: "Player profile", element: <PlayerProfileScreen /> },
];

describe("mobile screens mount without errors", () => {
  describe("Arabic (RTL, default)", () => {
    for (const { name, element } of SCREENS) {
      it(`renders ${name}`, async () => {
        const view = renderScreen(element);
        await waitFor(() => expect(view.toJSON()).toBeTruthy());
        view.unmount();
      });
    }
  });

  describe("English (LTR)", () => {
    for (const { name, element } of SCREENS) {
      it(`renders ${name}`, async () => {
        const view = renderScreen(element, { english: true });
        await waitFor(() => expect(view.toJSON()).toBeTruthy());
        view.unmount();
      });
    }
  });
});
