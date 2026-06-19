import React, { useRef } from 'react';
import { ClerkProvider, SignUp, Show, useClerk, AuthenticateWithRedirectCallback } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { arSA } from '@clerk/localizations';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect, Link } from 'wouter';
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { DirectionProvider } from "@radix-ui/react-direction";
import { I18nProvider, useI18n } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import { CompetitionProvider } from "./lib/competition";
import { ClerkQueryClientCacheInvalidator, getClerkAppearance, ActivationGate } from "./components/auth/ClerkConfig";
import { PasswordRequirements } from "./components/auth/password-requirements";
import { CustomSignIn } from "./components/auth/CustomSignIn";
import { CustomForgotPassword } from "./components/auth/ForgotPassword";
import { PublicHeader } from "./components/public-header";

import LandingPage from "./pages/landing";
import HomePage from "./pages/home";
import OnboardingPage from "./pages/onboarding";
import VerifyMobilePage from "./pages/verify-mobile";
import PickTeamPage from "./pages/pick-team";
import PickClubPage from "./pages/pick-club";
import ProfilePage from "./pages/profile";
import ChallengesPage from "./pages/challenges";
import ChallengeNewPage from "./pages/challenge-new";
import ChallengeDetailPage from "./pages/challenge-detail";
import MatchCenterPage from "./pages/match-center";
import SchedulePage from "./pages/schedule";
import MatchDetailPage from "./pages/match-detail";
import RankingsPage from "./pages/rankings";
import PlayerProfilePage from "./pages/player-profile";
import SocialPage from "./pages/social";
import NotificationsPage from "./pages/notifications";
import PricingPage from "./pages/pricing";
import TermsPage from "./pages/terms";
import PrivacyPage from "./pages/privacy";
import SupportPage from "./pages/support";
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
import AdminBadgesPage from "./pages/admin/badges";
import AdminAuditPage from "./pages/admin/audit";
import AdminAnnouncementsPage from "./pages/admin/announcements";
import AdminAnalyticsPage from "./pages/admin/analytics";
import AdminDemoPage from "./pages/admin/demo";
import { isDemoHarnessEnabled } from "./lib/demoHarness";

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
        <CustomSignIn />
      </div>
    </div>
  );
}

function ForgotPasswordPage() {
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
        <CustomForgotPassword />
      </div>
    </div>
  );
}

function SSOCallbackPage() {
  const { lang, t } = useI18n();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stadium" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <span className="text-sm text-muted-foreground">{t('auth.signingIn')}</span>
      <AuthenticateWithRedirectCallback
        signInUrl={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  const { lang, t } = useI18n();
  const signUpRef = useRef<HTMLDivElement>(null);
  const joinCode = new URLSearchParams(window.location.search).get('join') ?? '';
  const afterUrl = joinCode ? `${basePath}/join/${encodeURIComponent(joinCode)}` : undefined;
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
        <div ref={signUpRef} className="flex w-[440px] max-w-full flex-col gap-4">
          <SignUp
            routing="path"
            path={`${basePath}/sign-up`}
            signInUrl={`${basePath}/sign-in`}
            {...(afterUrl ? { fallbackRedirectUrl: afterUrl } : {})}
          />
          <PasswordRequirements containerRef={signUpRef} />
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

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

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
        // Several keys in @clerk/localizations v4.7.1's arSA `unstable__errors`
        // block are undefined and fall back to English. Fill in the common
        // auth-flow error messages so they render in Arabic in Arabic mode.
        const arErrors =
          lang === 'ar'
            ? {
                form_password_incorrect:
                  'كلمة المرور غير صحيحة. حاول مرة أخرى أو استخدم طريقة أخرى.',
                form_code_incorrect: 'الرمز غير صحيح. يرجى المحاولة مرة أخرى.',
                form_password_length_too_short:
                  'كلمة المرور قصيرة جدًا. يجب أن تتكوّن من 8 أحرف على الأقل.',
                form_new_password_matches_current:
                  'لا يمكن أن تكون كلمة المرور الجديدة مطابقة لكلمة المرور الحالية.',
                form_username_invalid_character:
                  'اسم المستخدم يحتوي على حرف غير صالح.',
                form_username_invalid_length:
                  'يجب أن يتراوح طول اسم المستخدم بين {{min_length}} و {{max_length}} حرفًا.',
                form_param_nil: 'هذا الحقل مطلوب.',
                form_param_value_invalid: 'القيمة المُدخلة غير صالحة.',
                form_param_format_invalid: 'القيمة المُدخلة بتنسيق غير صالح.',
                form_param_type_invalid: 'القيمة المُدخلة غير صالحة.',
                form_param_type_invalid__email_address:
                  'يرجى إدخال عنوان بريد إلكتروني صالح.',
                form_param_type_invalid__phone_number:
                  'يرجى إدخال رقم هاتف صالح.',
                form_password_compromised__sign_in:
                  'قد تكون كلمة المرور الخاصة بك معرّضة للخطر. لحماية حسابك، يرجى المتابعة بطريقة تسجيل دخول بديلة. سيُطلب منك إعادة تعيين كلمة المرور بعد تسجيل الدخول.',
                form_password_untrusted__sign_in:
                  'قد تكون كلمة المرور الخاصة بك معرّضة للخطر. لحماية حسابك، يرجى المتابعة بطريقة تسجيل دخول بديلة. سيُطلب منك إعادة تعيين كلمة المرور بعد تسجيل الدخول.',
                form_identifier_not_found:
                  'تعذّر العثور على حساب بهذه البيانات.',
              }
            : {};
        return {
          ...base,
          ...arPlaceholders,
          unstable__errors: {
            ...base.unstable__errors,
            ...arErrors,
          },
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
        <CompetitionProvider>
        <DirectionProvider dir={dir}>
        <TooltipProvider>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/forgot-password" component={ForgotPasswordPage} />
            <Route path="/sso-callback" component={SSOCallbackPage} />

            <Route path="/terms" component={TermsPage} />
            <Route path="/privacy" component={PrivacyPage} />
            <Route path="/support" component={SupportPage} />
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

            <Route path="/pick-team">
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <PickTeamPage />
              </Show>
            </Route>

            <Route path="/pick-club">
              <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
                <PickClubPage />
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
              <Redirect to="/rankings" />
            </Route>
            <Route path="/social">
              <ProtectedRoute component={SocialPage} />
            </Route>
            <Route path="/players/:userId">
              <ProtectedRoute component={PlayerProfilePage} />
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
            <Route path="/admin/challenge-badges">
              <AdminPage><AdminBadgesPage /></AdminPage>
            </Route>
            <Route path="/admin/announcements">
              <AdminPage><AdminAnnouncementsPage /></AdminPage>
            </Route>
            <Route path="/admin/audit">
              <AdminPage><AdminAuditPage /></AdminPage>
            </Route>
            <Route path="/admin/analytics">
              <AdminPage><AdminAnalyticsPage /></AdminPage>
            </Route>
            {isDemoHarnessEnabled() && (
              <Route path="/admin/demo">
                <AdminPage><AdminDemoPage /></AdminPage>
              </Route>
            )}

            <Route component={NotFound} />
          </Switch>
          <Toaster />
        </TooltipProvider>
        </DirectionProvider>
        </CompetitionProvider>
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
