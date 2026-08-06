import React, { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../lib/i18n";
import { Button } from "@/components/ui/button";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";

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

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

export function getClerkAppearance(basePath: string) {
  return {
    theme: shadcn,
    cssLayerName: "clerk",
    options: {
      logoPlacement: "inside" as const,
      logoLinkUrl: basePath || "/",
      logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
    },
    variables: {
      colorPrimary: "hsl(var(--primary))",
      colorForeground: "hsl(var(--foreground))",
      colorMutedForeground: "hsl(var(--muted-foreground))",
      colorDanger: "hsl(var(--destructive))",
      colorBackground: "hsl(var(--card))",
      colorInput: "hsl(var(--input))",
      colorInputForeground: "hsl(var(--foreground))",
      colorNeutral: "hsl(var(--input))",
      fontFamily: "inherit",
      borderRadius: "0.75rem",
    },
    elements: {
      rootBox: "w-full flex justify-center",
      cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-border dark:bg-[hsl(222,47%,9%)] dark:border-[hsl(217,32%,17%)]",
      card: "!shadow-none !border-0 !bg-transparent !rounded-none",
      footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
      headerTitle: "text-foreground font-bold text-lg",
      headerSubtitle: "text-muted-foreground text-xs mt-0.5",
      header: "mb-3.5",
      socialButtons: "flex flex-row gap-2.5 w-full justify-between !mb-3",
      socialButtonsBlockButtonText: "text-foreground font-medium text-xs",
      formFieldLabel: "!text-foreground font-semibold text-[11px] !mb-0",
      footerActionLink: "text-primary hover:text-primary/90 font-medium text-xs",
      footerActionText: "text-muted-foreground text-xs",
      dividerText: "text-muted-foreground text-xs",
      dividerRow: "my-3",
      identityPreviewEditButton: "text-primary",
      formFieldSuccessText: "text-primary",
      alertText: "text-foreground",
      logoBox: "h-8 w-auto mb-1",
      logoImage: "h-full w-auto object-contain",
      socialButtonsBlockButton: "border border-input hover:bg-accent/50 transition-colors h-9 text-xs flex-1",
      formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm transition-all h-9 text-sm",
      formFieldInput: "flex !h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      footerAction: "mt-3",
      dividerLine: "bg-border",
      alert: "bg-muted border border-border rounded-lg",
      otpCodeFieldInput: "border border-input bg-transparent text-foreground",
      formFieldRow: "flex flex-col !gap-0.5 !mb-2.5",
      form: "flex flex-col !gap-2.5",
      main: "px-6 py-4 sm:px-8 sm:py-5",
    },
  };
}

export function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

export function ActivationGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const {
    data: me,
    isLoading: meLoading,
    refetch,
    isFetching,
  } = useGetMe({ query: { enabled: isSignedIn, queryKey: getGetMeQueryKey() } });
  const { signOut } = useClerk();
  const { t, dir } = useI18n();

  if (!isLoaded) return <div className="min-h-[50vh] flex items-center justify-center p-4">{t('gate.verifying')}</div>;
  if (!isSignedIn) return <Redirect to="/" />;
  if (meLoading) return <div className="min-h-[50vh] flex items-center justify-center p-4">{t('gate.verifying')}</div>;

  if (me) {
    if (!me.emailVerified) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4" dir={dir}>
          <div className="max-w-md w-full text-center space-y-4">
            <h2 className="text-2xl font-bold">{t('gate.email.title')}</h2>
            <p className="text-muted-foreground">{t('gate.email.desc')}</p>
          </div>
        </div>
      );
    }
    if (!me.profileComplete) return <Redirect to="/onboarding" />;
    if (!me.mobileVerified) return <Redirect to="/verify-mobile" />;
    if (!me.favoriteTeamSelected) return <Redirect to="/pick-team" />;
    if (me.activated) return <>{children}</>;
  }

  // Either /me failed to load, or the user is signed in but stuck in an
  // unexpected non-activated state. Never trap them on an endless
  // "Verifying…" spinner — surface a retry + sign-out escape hatch.
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4" dir={dir}>
      <div className="max-w-md w-full text-center space-y-4">
        <h2 className="text-2xl font-bold">{t('gate.error.title')}</h2>
        <p className="text-muted-foreground">{t('gate.error.desc')}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-gate-retry"
          >
            {isFetching ? t('gate.verifying') : t('gate.retry')}
          </Button>
          <Button
            variant="outline"
            onClick={() => signOut({ redirectUrl: '/' })}
            data-testid="button-gate-signout"
          >
            {t('auth.signOut')}
          </Button>
        </div>
      </div>
    </div>
  );
}
