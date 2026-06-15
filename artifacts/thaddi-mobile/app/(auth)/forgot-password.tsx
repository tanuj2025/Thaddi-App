import { useSignIn } from "@clerk/expo";
import { type Href, Link, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { View } from "react-native";

import { AuthShell } from "@/components/auth-ui";
import { Button, TextField, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";

type NavigateArgs = {
  session?: { currentTask?: unknown } | null;
  decorateUrl: (url: string) => string;
};

type Step = "email" | "reset";

export default function ForgotPasswordScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { t } = useI18n();
  const c = useColors();
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [emailAddress, setEmailAddress] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const navigate = useCallback(
    ({ session, decorateUrl }: NavigateArgs) => {
      if (session?.currentTask) return;
      const url = decorateUrl("/");
      if (typeof url === "string" && url.startsWith("http")) {
        if (typeof window !== "undefined") window.location.href = url;
      } else {
        router.replace(url as Href);
      }
    },
    [router],
  );

  // Step 1 — establish the identifier, then email a reset code.
  const onSendCode = useCallback(async () => {
    setFormError(null);
    const created = await signIn.create({ identifier: emailAddress });
    if (created.error) return;
    const sent = await signIn.resetPasswordEmailCode.sendCode();
    if (sent.error) return;
    setStep("reset");
  }, [signIn, emailAddress]);

  // Step 2 — verify the emailed code, then set the new password.
  const onReset = useCallback(async () => {
    setFormError(null);
    const verified = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (verified.error) return;
    const submitted = await signIn.resetPasswordEmailCode.submitPassword({
      password: newPassword,
    });
    if (submitted.error) return;

    if (signIn.status === "complete") {
      await signIn.finalize({ navigate });
    } else {
      // e.g. a second factor is required — never silently dead-end.
      setFormError(t("auth.error"));
    }
  }, [signIn, code, newPassword, navigate, t]);

  const busy = fetchStatus === "fetching";

  const backLink = (
    <View style={{ alignItems: "center", marginTop: 18 }}>
      <Link href="/(auth)/sign-in" replace>
        <ThemedText gold size={14} weight="bold">
          {t("auth.backToSignIn")}
        </ThemedText>
      </Link>
    </View>
  );

  const errorBanner = formError ? (
    <ThemedText
      size={13}
      color={c.destructive}
      center
      style={{ marginBottom: 10 }}
    >
      {formError}
    </ThemedText>
  ) : null;

  if (step === "reset") {
    return (
      <AuthShell title={t("auth.resetTitle")} subtitle={t("auth.resetSubtitle")}>
        {errorBanner}
        <TextField
          label={t("auth.codeLabel")}
          value={code}
          onChangeText={setCode}
          placeholder={t("auth.codePlaceholder")}
          keyboardType="number-pad"
          error={errors?.fields?.code?.message}
        />
        <TextField
          label={t("auth.newPassword")}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder={t("auth.newPasswordPlaceholder")}
          secureTextEntry
          autoComplete="password-new"
          error={errors?.fields?.password?.message}
        />
        <Button
          label={t("auth.resetSubmit")}
          onPress={onReset}
          loading={busy}
          disabled={!code || !newPassword}
        />
        <View style={{ marginTop: 12 }}>
          <Button
            label={t("auth.resend")}
            variant="ghost"
            onPress={() => signIn.resetPasswordEmailCode.sendCode()}
          />
        </View>
        {backLink}
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.forgotTitle")} subtitle={t("auth.forgotSubtitle")}>
      {errorBanner}
      <TextField
        label={t("auth.email")}
        value={emailAddress}
        onChangeText={setEmailAddress}
        placeholder={t("auth.emailPlaceholder")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        error={errors?.fields?.identifier?.message}
      />
      <Button
        label={t("auth.sendResetCode")}
        onPress={onSendCode}
        loading={busy}
        disabled={!emailAddress}
      />
      {backLink}
    </AuthShell>
  );
}
