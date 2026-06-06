import React from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { I18nProvider, useI18n } from "./lib/i18n";
import { ClerkQueryClientCacheInvalidator, getClerkAppearance, ActivationGate } from "./components/auth/ClerkConfig";

import LandingPage from "./pages/landing";
import HomePage from "./pages/home";
import OnboardingPage from "./pages/onboarding";
import VerifyMobilePage from "./pages/verify-mobile";
import ProfilePage from "./pages/profile";
import ChallengesPage from "./pages/challenges";
import ChallengeNewPage from "./pages/challenge-new";
import ChallengeDetailPage from "./pages/challenge-detail";
import JoinPage from "./pages/join";
import PlaceholderPage from "./pages/placeholder";
import NotFound from "./pages/not-found";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function SignInPage() {
  const { lang, t } = useI18n();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  const { lang } = useI18n();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function PostAuthLanding() {
  let pending: string | null = null;
  try {
    pending = localStorage.getItem("thaddi_pending_join");
  } catch {
    pending = null;
  }
  if (pending) return <Redirect to={`/join/${pending}`} />;
  return <Redirect to="/home" />;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <PostAuthLanding />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <ActivationGate>
      <Component />
    </ActivationGate>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  const { lang, t } = useI18n();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={getClerkAppearance(basePath)}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: t('auth.signIn'),
            subtitle: t('app.tagline'),
          },
        },
        signUp: {
          start: {
            title: t('auth.signUp'),
            subtitle: t('app.tagline'),
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            
            <Route path="/onboarding">
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <OnboardingPage />
              </Show>
            </Route>
            
            <Route path="/verify-mobile">
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <VerifyMobilePage />
              </Show>
            </Route>

            <Route path="/home">
              <ProtectedRoute component={HomePage} />
            </Route>

            <Route path="/join/:code" component={JoinPage} />

            <Route path="/challenges" component={ChallengesPage} />

            <Route path="/challenges/new">
              <ProtectedRoute component={ChallengeNewPage} />
            </Route>

            <Route path="/challenges/:id" component={ChallengeDetailPage} />

            <Route path="/rankings">
              <ProtectedRoute component={() => <PlaceholderPage titleKey="nav.rankings" />} />
            </Route>

            <Route path="/matches">
              <ProtectedRoute component={() => <PlaceholderPage titleKey="nav.matches" />} />
            </Route>

            <Route path="/profile">
              <ProtectedRoute component={ProfilePage} />
            </Route>

            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <I18nProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </I18nProvider>
  );
}

export default App;
