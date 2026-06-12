import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import React from "react";

/**
 * Guards ONLY on being signed in — deliberately does not block already-activated
 * users, because pick-team doubles as the "change favourite team" screen
 * (entered with ?change=1 and returning via router.back).
 */
export default function ActivationLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
