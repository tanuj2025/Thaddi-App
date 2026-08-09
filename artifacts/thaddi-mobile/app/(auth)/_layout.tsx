import { useAuth } from "@clerk/expo";
import { Redirect, Stack, useSegments } from "expo-router";
import React from "react";

import { StartupLoadingScreen } from "@/components/StartupLoadingScreen";
import { useIntro } from "@/lib/intro";

export default function AuthLayout() {
  const { isSignedIn } = useAuth();
  const { ready: introReady, hasSeenIntro } = useIntro();
  const segments = useSegments();

  // Already authenticated users never see the auth screens.
  if (isSignedIn) return <Redirect href="/(tabs)" />;

  // Wait for the persisted intro flag before deciding, so a direct nav to an
  // auth screen on first launch doesn't flash before redirecting to the intro.
  if (!introReady) return <StartupLoadingScreen />;

  // First-launch users land on the intro before any auth screen. The intro
  // route itself is exempt so it can render; once seen, this gate is inert.
  const onIntro = segments[segments.length - 1] === "intro";
  if (!hasSeenIntro && !onIntro) return <Redirect href="/(auth)/intro" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
