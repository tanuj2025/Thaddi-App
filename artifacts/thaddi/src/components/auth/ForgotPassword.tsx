import React, { useState } from "react";
import { useSignIn } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";

import { useI18n } from "../../lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "./AuthShell";
import { clerkErrorCode, clerkErrorMessage } from "./clerkErrors";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type NavigateArgs = {
  session?: { currentTask?: unknown } | null;
  decorateUrl: (url: string) => string;
};

type Step = "email" | "reset";

function readJoinCode(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("join") ?? "";
}

export function CustomForgotPassword() {
  const { signIn, fetchStatus } = useSignIn();
  const { t } = useI18n();
  const [, setLocation] = useLocation();

  const joinCode = readJoinCode();
  const destPath = joinCode ? `/join/${encodeURIComponent(joinCode)}` : "/";
  const joinSuffix = joinCode ? `?join=${encodeURIComponent(joinCode)}` : "";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = fetchStatus === "fetching";

  // Routing after the session is finalized. decorateUrl preserves Safari ITP
  // cookie handling: an absolute URL means a full-page navigation; otherwise we
  // stay in the SPA via wouter.
  const navigate = ({ session, decorateUrl }: NavigateArgs) => {
    if (session?.currentTask) return;
    const target = `${basePath}${destPath === "/" ? "/" : destPath}`;
    const url = decorateUrl(target);
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      window.location.href = url;
      return;
    }
    setLocation(destPath, { replace: true });
  };

  // Step 1 — establish the identifier and email a reset code.
  const onSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const created = await signIn.create({ identifier: email });
    if (created.error) {
      // Don't reveal whether an account exists for this email — advance to the
      // code step exactly as we would for a real account.
      if (clerkErrorCode(created.error) === "form_identifier_not_found") {
        setStep("reset");
      } else {
        setError(clerkErrorMessage(created.error, t));
      }
      return;
    }
    const sent = await signIn.resetPasswordEmailCode.sendCode();
    if (sent.error) {
      if (clerkErrorCode(sent.error) === "form_identifier_not_found") {
        setStep("reset");
      } else {
        setError(clerkErrorMessage(sent.error, t));
      }
      return;
    }
    setStep("reset");
  };

  // Step 2 — verify the emailed code and set the new password.
  const onReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const verified = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (verified.error) {
      setError(clerkErrorMessage(verified.error, t));
      return;
    }
    const submitted = await signIn.resetPasswordEmailCode.submitPassword({
      password: newPassword,
    });
    if (submitted.error) {
      setError(clerkErrorMessage(submitted.error, t));
      return;
    }
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate });
    } else {
      // e.g. a further verification step — never silently dead-end.
      setError(t("auth.err.generic"));
    }
  };

  const onResend = async () => {
    if (busy) return;
    setError(null);
    const { error: resendError } = await signIn.resetPasswordEmailCode.sendCode();
    // Mirror onSendCode: never disclose account existence on resend.
    if (
      resendError &&
      clerkErrorCode(resendError) !== "form_identifier_not_found"
    ) {
      setError(clerkErrorMessage(resendError, t));
    }
  };

  const backLink = (
    <div className="mt-6 flex justify-center">
      <Link
        href={`/sign-in${joinSuffix}`}
        className="text-sm font-semibold text-primary hover:text-primary/90"
        data-testid="link-back-signin"
      >
        {t("auth.backToSignIn")}
      </Link>
    </div>
  );

  const errorBanner = error ? (
    <p
      className="mb-3 text-center text-sm text-destructive"
      data-testid="text-reset-error"
    >
      {error}
    </p>
  ) : null;

  if (step === "reset") {
    return (
      <AuthShell title={t("auth.resetTitle")} subtitle={t("auth.resetSubtitle")}>
        {errorBanner}
        <form onSubmit={onReset} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-code">{t("auth.code")}</Label>
            <Input
              id="reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              placeholder={t("auth.codePlaceholder")}
              data-testid="input-reset-code"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-new-password">{t("auth.newPassword")}</Label>
            <Input
              id="reset-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(ev) => setNewPassword(ev.target.value)}
              placeholder={t("auth.newPasswordPlaceholder")}
              data-testid="input-new-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !code || !newPassword}
            data-testid="button-reset-submit"
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("auth.resetSubmit")}
          </Button>
        </form>
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            onClick={onResend}
            data-testid="button-resend-code"
          >
            {t("auth.resend")}
          </Button>
        </div>
        {backLink}
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.forgotTitle")} subtitle={t("auth.forgotSubtitle")}>
      {errorBanner}
      <form onSubmit={onSendCode} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-email">{t("auth.email")}</Label>
          <Input
            id="reset-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            data-testid="input-reset-email"
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={busy || !email}
          data-testid="button-send-reset-code"
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {t("auth.sendResetCode")}
        </Button>
      </form>
      {backLink}
    </AuthShell>
  );
}
