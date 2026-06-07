import React from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { ShieldCheck } from 'lucide-react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { arSA } from '@clerk/localizations';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect, Link } from 'wouter';
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { I18nProvider, useI18n } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { ClerkQueryClientCacheInvalidator, getClerkAppearance, ActivationGate } from "./components/auth/ClerkConfig";
import { PublicHeader } from "./components/public-header";

import LandingPage from "./pages/landing";
import HomePage from "./pages/home";
import OnboardingPage from "./pages/onboarding";
import VerifyMobilePage from "./pages/verify-mobile";
import ProfilePage from "./pages/profile";
import ChallengesPage from "./pages/challenges";
import ChallengeNewPage from "./pages/challenge-new";
import ChallengeDetailPage from "./pages/challenge-detail";
import MatchCenterPage from "./pages/match-center";
import SchedulePage from "./pages/schedule";
import MatchDetailPage from "./pages/match-detail";
import RankingsPage from "./pages/rankings";
import HallOfFamePage from "./pages/hall-of-fame";
import NotificationsPage from "./pages/notifications";
import PricingPage from "./pages/pricing";
import TermsPage from "./pages/terms";
import PrivacyPage from "./pages/privacy";
import JoinPage from "./pages/join";
import PlaceholderPage from "./pages/placeholder";
import NotFound from "./pages/not-found";

import { AdminPage } from "./components/admin/admin-layout";
import AdminOverviewPage from "./pages/admin/overview";
import AdminTournamentsPage from "./pages/admin/tournaments";
import AdminMatchesPage from "./pages/admin/matches";
import AdminTeamsPage from "./pages/admin/teams";
import AdminUsersPage from "./pages/admin/users";
import AdminChallengesPage from "./pages/admin/challenges";
import AdminSubscriptionsPage from "./pages/admin/subscriptions";
import AdminPlansPage from "./pages/admin/plans";
import AdminAuditPage from "./pages/admin/audit";

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
    <div className="flex min-h-[100dvh] flex-col bg-stadium" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <PublicHeader>
        <span className="hidden sm:inline text-sm font-medium text-muted-foreground">
          {t('auth.noAccount')}
        </span>
        <Link href="/sign-up" className="text-sm font-semibold hover:text-secondary transition-colors" data-testid="link-go-signup">
          {t('auth.signUp')}
        </Link>
      </PublicHeader>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

function SignUpPage() {
  const { lang, t } = useI18n();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-stadium" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <PublicHeader>
        <span className="hidden sm:inline text-sm font-medium text-muted-foreground">
          {t('auth.haveAccount')}
        </span>
        <Link href="/sign-in" className="text-sm font-semibold hover:text-secondary transition-colors" data-testid="link-go-signin">
          {t('auth.signIn')}
        </Link>
      </PublicHeader>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="flex w-[440px] max-w-full flex-col gap-4">
          <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
          <div className="card-premium rounded-2xl px-5 py-4 text-start">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-secondary" />
              <span className="text-sm font-semibold text-foreground">{t('auth.passwordHint.title')}</span>
            </div>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-secondary" />
                <span>{t('auth.passwordHint.minLength')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-secondary" />
                <span>{t('auth.passwordHint.strong')}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
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
      localization={(() => {
        const base = lang === 'ar' ? arSA : {};
        const arPlaceholders =
          lang === 'ar'
            ? {
                formFieldInputPlaceholder__emailAddress: 'أدخل بريدك الإلكتروني',
                formFieldInputPlaceholder__emailAddress_username:
                  'أدخل البريد الإلكتروني أو اسم المستخدم',
                formFieldInputPlaceholder__password: 'أدخل كلمة المرور',
                formFieldInputPlaceholder__phoneNumber: 'أدخل رقم جوالك',
                formFieldInputPlaceholder__username: 'أدخل اسم المستخدم',
                formFieldInputPlaceholder__firstName: 'الاسم الأول',
                formFieldInputPlaceholder__lastName: 'اسم العائلة',
                formFieldInputPlaceholder__backupCode: 'أدخل الرمز الاحتياطي',
              }
            : {};
        return {
          ...base,
          ...arPlaceholders,
          signIn: {
            ...base.signIn,
            start: {
              ...base.signIn?.start,
              title: t('auth.signIn'),
              subtitle: t('app.tagline'),
            },
          },
          signUp: {
            ...base.signUp,
            start: {
              ...base.signUp?.start,
              title: t('auth.signUp'),
              subtitle: t('app.tagline'),
            },
          },
        };
      })()}
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

            <Route path="/terms" component={TermsPage} />
            <Route path="/privacy" component={PrivacyPage} />
            <Route path="/schedule" component={SchedulePage} />
            
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
              <ProtectedRoute component={RankingsPage} />
            </Route>

            <Route path="/hall-of-fame">
              <ProtectedRoute component={HallOfFamePage} />
            </Route>

            <Route path="/notifications">
              <ProtectedRoute component={NotificationsPage} />
            </Route>

            <Route path="/pricing">
              <ProtectedRoute component={PricingPage} />
            </Route>

            <Route path="/matches">
              <ProtectedRoute component={MatchCenterPage} />
            </Route>

            <Route path="/matches/:id">
              <ProtectedRoute component={MatchDetailPage} />
            </Route>

            <Route path="/profile">
              <ProtectedRoute component={ProfilePage} />
            </Route>

            <Route path="/admin">
              <AdminPage><AdminOverviewPage /></AdminPage>
            </Route>
            <Route path="/admin/tournaments">
              <AdminPage><AdminTournamentsPage /></AdminPage>
            </Route>
            <Route path="/admin/matches">
              <AdminPage><AdminMatchesPage /></AdminPage>
            </Route>
            <Route path="/admin/teams">
              <AdminPage><AdminTeamsPage /></AdminPage>
            </Route>
            <Route path="/admin/users">
              <AdminPage><AdminUsersPage /></AdminPage>
            </Route>
            <Route path="/admin/challenges">
              <AdminPage><AdminChallengesPage /></AdminPage>
            </Route>
            <Route path="/admin/subscriptions">
              <AdminPage><AdminSubscriptionsPage /></AdminPage>
            </Route>
            <Route path="/admin/plans">
              <AdminPage><AdminPlansPage /></AdminPage>
            </Route>
            <Route path="/admin/audit">
              <AdminPage><AdminAuditPage /></AdminPage>
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
      <ThemeProvider>
        <WouterRouter base={basePath}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
      </ThemeProvider>
    </I18nProvider>
  );
}

export default App;
