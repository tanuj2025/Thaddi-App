import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import React from "react";

import { StartupLoadingScreen } from "@/components/StartupLoadingScreen";
import { useIntro } from "@/lib/intro";

/**
 * Explicit root entry route. Production cold starts land on "/" — without this
 * file the router falls through to the (tabs) group, whose gates then bounce
 * unauthenticated users around. Deciding here makes startup routing explicit:
 *   - authenticated  → the tab area (ActivationGate takes over from there),
 *   - first launch   → the intro,
 *   - returning user → sign-in.
 * While Clerk/AsyncStorage state resolves we show the branded spinner, never a
 * blank screen or a flash of the wrong screen.
 */
export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const { ready: introReady, hasSeenIntro } = useIntro();

  if (!isLoaded || (!isSignedIn && !introReady)) return <StartupLoadingScreen />;

  if (isSignedIn) return <Redirect href="/(tabs)" />;
  return <Redirect href={hasSeenIntro ? "/(auth)/sign-in" : "/(auth)/intro"} />;
}
