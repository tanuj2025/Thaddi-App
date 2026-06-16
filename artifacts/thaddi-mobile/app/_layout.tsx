import { ClerkLoaded, ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  Cairo_400Regular,
  Cairo_500Medium,
  Cairo_600SemiBold,
  Cairo_700Bold,
  Cairo_800ExtraBold,
} from "@expo-google-fonts/cairo";
import { Outfit_400Regular, Outfit_700Bold } from "@expo-google-fonts/outfit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  setAuthTokenGetter,
  setBaseUrl,
  setClientId,
} from "@workspace/api-client-react";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { type ReactNode, useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { I18nProvider } from "@/lib/i18n";
import { IntroProvider } from "@/lib/intro";
import {
  identifyRevenueCatUser,
  initializeRevenueCat,
  logoutRevenueCatUser,
  SubscriptionProvider,
} from "@/lib/revenuecat";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Point the shared API client at the deployment host so the generated client's
// `/api/...` paths resolve to `https://<domain>/api/...`. The web artifact is
// same-origin and never calls setBaseUrl; on mobile there is no proxy, so the
// host must be set explicitly here, once, at module load.
const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

// Identify this client as the native app so the server can apply mobile-only
// behaviour (e.g. the App Store reviewer SMS bypass). The web artifact never
// sends this, so that bypass can never apply on the web.
setClientId("mobile");

// Configure RevenueCat once, synchronously, before the SubscriptionProvider
// mounts (it reads the configured flag at render). Best-effort: on a platform
// without the native SDK (or with keys missing) this throws and the paywall
// simply degrades to "purchases unavailable" — it must never crash the app.
try {
  initializeRevenueCat();
} catch (err) {
  console.warn("RevenueCat init skipped:", (err as Error)?.message ?? err);
}

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

const queryClient = new QueryClient();

/**
 * Bridges Clerk's session into the shared API client and the query cache.
 *
 * The token getter is registered DURING RENDER (not in an effect): React runs
 * child effects before parent effects, so an effect here would register the
 * getter only after child screens have already fired their first authed query
 * (which would then go out with no bearer and 401). Registering at render time
 * guarantees the getter exists before any descendant renders. A ref keeps the
 * registered closure pointed at the latest `getToken`.
 *
 * On user change / sign-out we clear the query cache so a second account on the
 * same device never sees the previous user's cached data.
 */
function AuthBridge({ children }: { children: ReactNode }) {
  const { getToken, userId } = useAuth();

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const registeredRef = useRef(false);
  if (!registeredRef.current) {
    setAuthTokenGetter(() => getTokenRef.current());
    registeredRef.current = true;
  }

  const prevUserId = useRef(userId);
  useEffect(() => {
    if (prevUserId.current !== userId) {
      prevUserId.current = userId;
      queryClient.clear();
    }
  }, [userId]);

  // Keep RevenueCat's app_user_id aligned with the Clerk session so server-side
  // entitlement verification (keyed by Clerk id) resolves the right customer.
  useEffect(() => {
    if (userId) {
      void identifyRevenueCatUser(userId);
    } else {
      void logoutRevenueCatUser();
    }
  }, [userId]);

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(activation)" />
      <Stack.Screen name="match/[id]" />
      <Stack.Screen name="players/[id]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="paywall" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Cairo_400Regular,
    Cairo_500Medium,
    Cairo_600SemiBold,
    Cairo_700Bold,
    Cairo_800ExtraBold,
    Outfit_400Regular,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
      <ClerkLoaded>
        <AuthBridge>
          <SafeAreaProvider>
            <ErrorBoundary>
              <QueryClientProvider client={queryClient}>
                <SubscriptionProvider>
                  <I18nProvider>
                    <IntroProvider>
                      <GestureHandlerRootView style={{ flex: 1 }}>
                        <KeyboardProvider>
                          <StatusBar style="light" />
                          <RootLayoutNav />
                        </KeyboardProvider>
                      </GestureHandlerRootView>
                    </IntroProvider>
                  </I18nProvider>
                </SubscriptionProvider>
              </QueryClientProvider>
            </ErrorBoundary>
          </SafeAreaProvider>
        </AuthBridge>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
