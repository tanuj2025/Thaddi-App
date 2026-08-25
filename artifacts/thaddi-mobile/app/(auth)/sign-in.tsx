import { useSignIn, useSSO } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import { type Href, Link, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";

import { AuthDivider, AuthShell } from "@/components/auth-ui";
import { AppleIcon, GoogleIcon } from "@/components/brand-icons";
import { Button, TextField, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";
import { isValidOtp, normalizeOtp } from "@/lib/otp";
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
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

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
      if (error) {
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        return;
      }

      if (signIn.status === "complete") {
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
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
      if (Platform.OS !== "web") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      const msg = err.errors?.[0]?.message ?? err.message ?? t("auth.error");
      setFormError(msg);
    }
  }, [signIn, emailAddress, password, navigate, t]);

  const onVerify = useCallback(async () => {
    const normalizedCode = normalizeOtp(code);
    if (!isValidOtp(normalizedCode)) {
      setFormError(t("auth.error"));
      return;
    }
    setFormError(null);
    try {
      await signIn.mfa.verifyEmailCode({ code: normalizedCode });
      if (signIn.status === "complete") {
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        await signIn.finalize({ navigate });
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      setFormError(err?.errors?.[0]?.message ?? err?.message ?? t("auth.error"));
    }
  }, [signIn, code, navigate, t]);

  const onGoogle = useCallback(async () => {
    setFormError(null);
    setGoogleLoading(true);
    try {
      const result = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri({
          scheme: "thaddi-mobile",
          path: "sso-callback",
        }),
      });
      // Existing users complete via the returned signIn resource (no
      // createdSessionId) — finalize it instead of silently bouncing back.
      const activated = await completeSSOFlow(result, navigate);
      if (activated) {
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        setFormError(t("auth.error"));
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      setFormError(err?.errors?.[0]?.message ?? err?.message ?? t("auth.error"));
    } finally {
      setGoogleLoading(false);
    }
  }, [startSSOFlow, navigate, t]);

  // Sign in with Apple — required by Apple Guideline 4.8 whenever a third-party
  // social login is offered. On iOS the oauth_apple strategy runs the native
  // Apple flow (expo-apple-authentication + usesAppleSignIn entitlement);
  // user-cancelled attempts simply throw and are swallowed like Google.
  const onApple = useCallback(async () => {
    setFormError(null);
    setAppleLoading(true);
    try {
      const result = await startSSOFlow({
        strategy: "oauth_apple",
        redirectUrl: AuthSession.makeRedirectUri({
          scheme: "thaddi-mobile",
          path: "sso-callback",
        }),
      });
      const activated = await completeSSOFlow(result, navigate);
      if (activated) {
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        setFormError(t("auth.error"));
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      setFormError(err?.errors?.[0]?.message ?? err?.message ?? t("auth.error"));
    } finally {
      setAppleLoading(false);
    }
  }, [startSSOFlow, navigate, t]);

  const busy = fetchStatus === "fetching";

  // New-device verification (Clerk client trust) — collect the emailed code.
  if (signIn.status === "needs_client_trust") {
    return (
      <AuthShell title={t("auth.verifyTitle")} subtitle={t("auth.verifyDesc")}>
        {formError ? (
          <ThemedText
            size={13}
            color={c.destructive}
            center
            style={{ marginBottom: 8 }}
          >
            {formError}
          </ThemedText>
        ) : null}
        <TextField
          label={t("auth.codeLabel")}
          value={code}
          onChangeText={(value) => setCode(normalizeOtp(value))}
          placeholder={t("auth.codePlaceholder")}
          keyboardType="number-pad"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={8}
          returnKeyType="done"
          onSubmitEditing={() => void onVerify()}
          error={errors?.fields?.code?.message}
        />
        <Button
          label={t("auth.verify")}
          onPress={onVerify}
          loading={busy}
          disabled={!isValidOtp(code)}
        />
        <View style={{ marginTop: 12 }}>
          <Button
            label={t("auth.signOut")}
            variant="outline"
            onPress={() => router.replace("/(auth)/sign-in")}
          />
        </View>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.signInTitle")} subtitle={t("auth.signInSubtitle")}>
      <View
        style={{
          flexDirection: dir === "rtl" ? "row-reverse" : "row",
          justifyContent: "center",
          gap: 16,
          marginVertical: 4,
        }}
      >
        <Pressable
          onPress={onGoogle}
          disabled={googleLoading || appleLoading || busy}
          accessibilityLabel={t("auth.google")}
          style={({ pressed }) => ({
            width: 72,
            height: 48,
            borderRadius: c.radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            backgroundColor: c.card,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed || googleLoading ? 0.7 : 1,
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          })}
        >
          {googleLoading ? (
            <ActivityIndicator size="small" color={c.primary} />
          ) : (
            <GoogleIcon size={22} />
          )}
        </Pressable>
        <Pressable
          onPress={onApple}
          disabled={googleLoading || appleLoading || busy}
          accessibilityLabel={t("auth.apple")}
          style={({ pressed }) => ({
            width: 72,
            height: 48,
            borderRadius: c.radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            backgroundColor: c.card,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed || appleLoading ? 0.7 : 1,
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          })}
        >
          {appleLoading ? (
            <ActivityIndicator size="small" color={c.foreground} />
          ) : (
            <AppleIcon size={24} color={c.foreground} />
          )}
        </Pressable>
      </View>
      <AuthDivider label={t("auth.or")} />
      {formError ? (
        <ThemedText
          size={13}
          color={c.destructive}
          center
          style={{ marginBottom: 8 }}
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
          marginBottom: 12,
          marginTop: -2,
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
          marginTop: 14,
          flexWrap: "wrap",
        }}
      >
        <ThemedText muted size={13}>
          {t("auth.noAccount")}
        </ThemedText>
        <Link href="/(auth)/sign-up" replace>
          <ThemedText gold size={13} weight="bold">
            {t("auth.signUpLink")}
          </ThemedText>
        </Link>
      </View>
    </AuthShell>
  );
}
