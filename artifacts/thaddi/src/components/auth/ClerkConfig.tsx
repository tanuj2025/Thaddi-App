import React, { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../lib/i18n";
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
      colorPrimary: "hsl(150, 100%, 21%)",
      colorForeground: "hsl(222, 47%, 11%)",
      colorMutedForeground: "hsl(215.4, 16.3%, 46.9%)",
      colorDanger: "hsl(0, 84.2%, 60.2%)",
      colorBackground: "hsl(0, 0%, 100%)",
      colorInput: "hsl(214, 32%, 91%)",
      colorInputForeground: "hsl(222, 47%, 11%)",
      colorNeutral: "hsl(214, 32%, 91%)",
      fontFamily: "inherit",
      borderRadius: "0.75rem",
    },
    elements: {
      rootBox: "w-full flex justify-center",
      cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-border dark:bg-[hsl(222,47%,9%)] dark:border-[hsl(217,32%,17%)]",
      card: "!shadow-none !border-0 !bg-transparent !rounded-none",
      footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
      headerTitle: "text-foreground font-bold",
      headerSubtitle: "text-muted-foreground",
      socialButtonsBlockButtonText: "text-foreground font-medium",
      formFieldLabel: "text-foreground font-medium",
      footerActionLink: "text-primary hover:text-primary/90 font-medium",
      footerActionText: "text-muted-foreground",
      dividerText: "text-muted-foreground",
      identityPreviewEditButton: "text-primary",
      formFieldSuccessText: "text-primary",
      alertText: "text-foreground",
      logoBox: "h-12 w-auto",
      logoImage: "h-full w-auto object-contain",
      socialButtonsBlockButton: "border border-input hover:bg-accent/50 transition-colors",
      formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-sm transition-all",
      formFieldInput: "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      footerAction: "mt-4",
      dividerLine: "bg-border",
      alert: "bg-muted border border-border rounded-lg",
      otpCodeFieldInput: "border border-input bg-transparent text-foreground",
      formFieldRow: "mb-4",
      main: "px-8 py-6",
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
  const { isLoaded, isSignedIn, user } = useUser();
  const { data: me, isLoading: meLoading } = useGetMe({ query: { enabled: isSignedIn, queryKey: getGetMeQueryKey() } });
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
    if (me.activated) return <>{children}</>;
  }

  return <div className="min-h-[50vh] flex items-center justify-center p-4">{t('gate.verifying')}</div>;
}
