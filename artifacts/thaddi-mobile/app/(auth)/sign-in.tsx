import { useSignIn, useSSO } from "@clerk/expo";
import { FontAwesome } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import { type Href, Link, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { AuthDivider, AuthShell } from "@/components/auth-ui";
import { Button, TextField, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";
import { completeSSOFlow, type SSONavigateArgs } from "@/lib/sso";

// Preload the in-app browser on Android to reduce OAuth latency.
export const useWarmUpBrowser = () => {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
};

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  useWarmUpBrowser();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const { t, dir } = useI18n();
  const c = useColors();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const navigate = useCallback(
    ({ session, decorateUrl }: SSONavigateArgs) => {
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

  const onSubmit = useCallback(async () => {
    setFormError(null);
    try {
      const { error } = await signIn.password({ emailAddress, password });
      if (error) return;

      if (signIn.status === "complete") {
        await signIn.finalize({ navigate });
      } else if (signIn.status === "needs_client_trust") {
        const factor = signIn.supportedSecondFactors?.find(
          (f) => f.strategy === "email_code",
        );
        if (factor) await signIn.mfa.sendEmailCode();
      } else {
        // Unhandled status (e.g. second factor / new password required) — never
        // silently dead-end; surface a generic, actionable error.
        setFormError(t("auth.error"));
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      const msg = err.errors?.[0]?.message ?? err.message ?? t("auth.error");
      setFormError(msg);
    }
  }, [signIn, emailAddress, password, navigate, t]);

  const onVerify = useCallback(async () => {
    await signIn.mfa.verifyEmailCode({ code });
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate });
    }
  }, [signIn, code, navigate]);

  const onGoogle = useCallback(async () => {
    setFormError(null);
    try {
      const result = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      // Existing users complete via the returned signIn resource (no
      // createdSessionId) — finalize it instead of silently bouncing back.
      const activated = await completeSSOFlow(result, navigate);
      if (!activated) setFormError(t("auth.error"));
    } catch (err) {
      console.error(JSON.stringify(err, null, 2));
    }
  }, [startSSOFlow, navigate, t]);

  // Sign in with Apple — required by Apple Guideline 4.8 whenever a third-party
  // social login is offered. On iOS the oauth_apple strategy runs the native
  // Apple flow (expo-apple-authentication + usesAppleSignIn entitlement);
  // user-cancelled attempts simply throw and are swallowed like Google.
  const onApple = useCallback(async () => {
    setFormError(null);
    try {
      const result = await startSSOFlow({
        strategy: "oauth_apple",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      const activated = await completeSSOFlow(result, navigate);
      if (!activated) setFormError(t("auth.error"));
    } catch (err) {
      console.error(JSON.stringify(err, null, 2));
    }
  }, [startSSOFlow, navigate, t]);

  const busy = fetchStatus === "fetching";

  // New-device verification (Clerk client trust) — collect the emailed code.
  if (signIn.status === "needs_client_trust") {
    return (
      <AuthShell title={t("auth.verifyTitle")} subtitle={t("auth.verifyDesc")}>
        <TextField
          label={t("auth.codeLabel")}
          value={code}
          onChangeText={setCode}
          placeholder={t("auth.codePlaceholder")}
          keyboardType="number-pad"
          error={errors?.fields?.code?.message}
        />
        <Button
          label={t("auth.verify")}
          onPress={onVerify}
          loading={busy}
          disabled={!code}
        />
        <View style={{ marginTop: 12 }}>
          <Button
            label={t("auth.resend")}
            variant="ghost"
            onPress={() => signIn.mfa.sendEmailCode()}
          />
        </View>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.signInTitle")} subtitle={t("auth.signInSubtitle")}>
      <Button
        label={t("auth.google")}
        variant="outline"
        onPress={onGoogle}
        icon={<FontAwesome name="google" size={16} color={c.foreground} />}
      />
      {Platform.OS === "ios" ? (
        <View style={{ marginTop: 12 }}>
          <Button
            label={t("auth.apple")}
            variant="outline"
            onPress={onApple}
            icon={<FontAwesome name="apple" size={18} color={c.foreground} />}
          />
        </View>
      ) : null}
      <AuthDivider label={t("auth.or")} />
      {formError ? (
        <ThemedText
          size={13}
          color={c.destructive}
          center
          style={{ marginBottom: 10 }}
        >
          {formError}
        </ThemedText>
      ) : null}
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
      <TextField
        label={t("auth.password")}
        value={password}
        onChangeText={setPassword}
        placeholder={t("auth.passwordPlaceholder")}
        secureTextEntry
        autoComplete="password"
        error={errors?.fields?.password?.message}
      />
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <Link href="/(auth)/forgot-password">
          <ThemedText gold size={13} weight="bold">
            {t("auth.forgot")}
          </ThemedText>
        </Link>
      </View>
      <Button
        label={t("auth.continue")}
        onPress={onSubmit}
        loading={busy}
        disabled={!emailAddress || !password}
      />
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          justifyContent: "center",
          gap: 6,
          marginTop: 18,
          flexWrap: "wrap",
        }}
      >
        <ThemedText muted size={14}>
          {t("auth.noAccount")}
        </ThemedText>
        <Link href="/(auth)/sign-up" replace>
          <ThemedText gold size={14} weight="bold">
            {t("auth.signUpLink")}
          </ThemedText>
        </Link>
      </View>
    </AuthShell>
  );
}
