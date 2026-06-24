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
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => onOAuth("oauth_google")}
          data-testid="button-oauth-google"
        >
          {t("auth.google")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => onOAuth("oauth_apple")}
          data-testid="button-oauth-apple"
        >
          {t("auth.apple")}
        </Button>
      </div>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">{t("auth.or")}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {errorBanner}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
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

        <div className="flex flex-col gap-1.5">
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
              className="text-sm font-semibold text-primary hover:text-primary/90"
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

      <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
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
