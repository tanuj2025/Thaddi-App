import React, { useEffect, useState } from "react";
import { useSignIn, useUser } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";

import { useI18n } from "../../lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./AuthShell";
import { clerkErrorMessage, isExistingSessionError } from "./clerkErrors";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type NavigateArgs = {
  session?: { currentTask?: unknown } | null;
  decorateUrl: (url: string) => string;
};

function readJoinCode(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("join") ?? "";
}

type Step = "signin" | "verify";

export function CustomSignIn() {
  const { signIn, fetchStatus } = useSignIn();
  const { isSignedIn } = useUser();
  const { t } = useI18n();
  const [, setLocation] = useLocation();

  const [step, setStep] = useState<Step>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = fetchStatus === "fetching";

  const joinCode = readJoinCode();
  const destPath = joinCode ? `/join/${encodeURIComponent(joinCode)}` : "/";
  const joinSuffix = joinCode ? `?join=${encodeURIComponent(joinCode)}` : "";
  const appTarget = `${basePath}${destPath === "/" ? "/" : destPath}`;

  // Full-page navigation into the app. Used both as the recovery path when Clerk
  // reports an existing session (client/server desync) and for finalized
  // sessions that carry a pending task. A hard navigation forces Clerk to
  // rehydrate via the proxied same-origin FAPI/cookie path; ActivationGate then
  // resolves any remaining state. Loop-safe: '/' renders the landing and never
  // auto-submits, so a genuinely signed-out client just sees the landing.
  const recoverToApp = () => {
    window.location.assign(appTarget);
  };

  // Already signed in (e.g. navigated back to /sign-in) — bounce to the app.
  useEffect(() => {
    if (isSignedIn) setLocation(destPath, { replace: true });
  }, [isSignedIn, destPath, setLocation]);

  // Routing after the session is finalized. decorateUrl preserves Safari ITP
  // cookie handling: when it hands back an absolute URL we must do a full-page
  // navigation; otherwise we stay in the SPA via wouter.
  const navigate = ({ session, decorateUrl }: NavigateArgs) => {
    // A finalized session may carry a pending Clerk task. Never silently stay on
    // the sign-in form (a dead-end) — hand the user to the app so the gate can
    // resolve it.
    if (session?.currentTask) {
      recoverToApp();
      return;
    }
    const url = decorateUrl(appTarget);
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      window.location.href = url;
      return;
    }
    setLocation(destPath, { replace: true });
  };

  // Centralised status handling so we never silently dead-end on a status we
  // didn't anticipate.
  const handleStatus = async () => {
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate });
      return;
    }
    if (
      signIn.status === "needs_second_factor" ||
      signIn.status === "needs_client_trust"
    ) {
      const emailFactor = signIn.supportedSecondFactors?.find(
        (f) => f.strategy === "email_code",
      );
      if (emailFactor) {
        const { error: sendError } = await signIn.mfa.sendEmailCode();
        if (sendError) {
          setError(clerkErrorMessage(sendError, t));
          return;
        }
        setStep("verify");
        return;
      }
    }
    setError(t("auth.err.generic"));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const { error: signInError } = await signIn.password({
      identifier: email,
      password,
    });
    if (signInError) {
      // A session already exists server-side (client/server desync) — the user
      // is effectively signed in, so recover into the app instead of showing a
      // confusing generic error and trapping them on the form.
      if (isExistingSessionError(signInError)) {
        recoverToApp();
        return;
      }
      setError(clerkErrorMessage(signInError, t));
      return;
    }
    await handleStatus();
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const { error: verifyError } = await signIn.mfa.verifyEmailCode({ code });
    if (verifyError) {
      if (isExistingSessionError(verifyError)) {
        recoverToApp();
        return;
      }
      setError(clerkErrorMessage(verifyError, t));
      return;
    }
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate });
    } else {
      setError(t("auth.err.generic"));
    }
  };

  const onResendCode = async () => {
    if (busy) return;
    setError(null);
    const { error: resendError } = await signIn.mfa.sendEmailCode();
    if (resendError) setError(clerkErrorMessage(resendError, t));
  };

  const onOAuth = async (strategy: "oauth_google" | "oauth_apple") => {
    if (busy) return;
    setError(null);
    // Preserve invite intent across the OAuth round-trip: the provider redirect
    // drops our `?join=` query param, so stash it the same way JoinPage does.
    // After the SSO callback finalizes, PostAuthLanding reads this key and
    // routes the user to /join/{code} instead of the default landing.
    if (joinCode) {
      try {
        localStorage.setItem("thaddi_pending_join", joinCode);
      } catch {
        /* localStorage unavailable (private browsing) — email/password still works */
      }
    }
    const origin = window.location.origin;
    const { error: ssoError } = await signIn.sso({
      strategy,
      redirectUrl: `${origin}${basePath}/sso-callback`,
      redirectCallbackUrl: `${origin}${basePath}/sso-callback`,
    });
    if (ssoError) {
      if (isExistingSessionError(ssoError)) {
        recoverToApp();
        return;
      }
      setError(clerkErrorMessage(ssoError, t));
    }
  };

  const errorBanner = error ? (
    <p
      className="mb-3 text-center text-sm text-destructive"
      data-testid="text-signin-error"
    >
      {error}
    </p>
  ) : null;

  // Second-factor (new-device / MFA) verification step.
  if (step === "verify") {
    return (
      <AuthShell title={t("auth.verifyTitle")} subtitle={t("auth.verifyDesc")}>
        {errorBanner}
        <form onSubmit={onVerify} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signin-2fa-code">{t("auth.code")}</Label>
            <Input
              id="signin-2fa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              placeholder={t("auth.codePlaceholder")}
              data-testid="input-2fa-code"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !code}
            data-testid="button-2fa-verify"
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("auth.verify")}
          </Button>
        </form>
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            onClick={onResendCode}
            data-testid="button-2fa-resend"
          >
            {t("auth.resend")}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.signIn")} subtitle={t("app.tagline")}>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-border/50 bg-card/40 hover:bg-slate-900 hover:border-primary/50 transition-all text-xs font-semibold text-slate-200"
          onClick={() => onOAuth("oauth_apple")}
          data-testid="button-oauth-apple"
        >
          <svg className="w-4 h-4 shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.22.67-2.94 1.51-.62.73-1.16 1.87-1.01 2.98 1.1.09 2.25-.56 2.96-1.43z"/>
          </svg>
          <span>{t("auth.apple")}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl border border-border/50 bg-card/40 hover:bg-slate-900 hover:border-primary/50 transition-all text-xs font-semibold text-slate-200"
          onClick={() => onOAuth("oauth_google")}
          data-testid="button-oauth-google"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
          </svg>
          <span>{t("auth.google")}</span>
        </Button>
      </div>

      <div className="my-3.5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">{t("auth.or")}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {errorBanner}

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="signin-email">{t("auth.email")}</Label>
          <Input
            id="signin-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            data-testid="input-email"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="signin-password">{t("auth.password")}</Label>
          <Input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            data-testid="input-password"
          />
          <div className="flex justify-end">
            <Link
              href={`/forgot-password${joinSuffix}`}
              className="text-xs font-semibold text-primary hover:text-primary/90"
              data-testid="link-forgot-password"
            >
              {t("auth.forgot")}
            </Link>
          </div>
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={busy || !email || !password}
          data-testid="button-signin"
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? t("auth.signingIn") : t("auth.continue")}
        </Button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        <span className="text-sm text-muted-foreground">
          {t("auth.noAccount")}
        </span>
        <Link
          href="/sign-up"
          className="text-sm font-semibold text-primary hover:text-primary/90"
          data-testid="link-go-signup-card"
        >
          {t("auth.signUp")}
        </Link>
      </div>
    </AuthShell>
  );
}
