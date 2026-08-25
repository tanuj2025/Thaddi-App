import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  useSendMobileOtp,
  useVerifyMobileOtp,
  type CurrentUser,
  type MobileOtpResult,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import {
  Button,
  Card,
  LangToggle,
  Reveal,
  Screen,
  ScreenHeader,
  TextField,
  ThemedText,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { nextActivationRoute } from "@/lib/activation";
import { useI18n } from "@/lib/i18n";
import { isValidOtp, normalizeOtp } from "@/lib/otp";

const SA_PHONE = /^(\+9665\d{8}|05\d{8})$/;

export default function VerifyMobileScreen() {
  const c = useColors();
  const { t, formatNum } = useI18n();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  const send = useSendMobileOtp({
    mutation: {
      onSuccess: (res: MobileOtpResult) => {
        setSent(true);
        setError(null);
        setResendIn(res.expiresInSeconds ?? 60);
      },
      onError: (err: any) =>
        setError((err?.data as { error?: string })?.error || t("verify.error")),
    },
  });

  const verify = useVerifyMobileOtp({
    mutation: {
      onSuccess: (updated: CurrentUser) => {
        queryClient.setQueryData(getGetMeQueryKey(), updated);
        router.replace(nextActivationRoute(updated));
      },
      onError: (err: any) =>
        setError(
          (err?.data as { error?: string })?.error || t("verify.invalidCode"),
        ),
    },
  });

  const onSend = () => {
    const raw = (phone || "").replace(/[\s\-()]/g, "");
    let local: string | null = null;
    if (/^\+9665\d{8}$/.test(raw)) local = raw.slice(4);
    else if (/^009665\d{8}$/.test(raw)) local = raw.slice(5);
    else if (/^9665\d{8}$/.test(raw)) local = raw.slice(3);
    else if (/^05\d{8}$/.test(raw)) local = raw.slice(1);
    else if (/^5\d{8}$/.test(raw)) local = raw;

    if (!local) {
      setError(t("verify.invalidPhone"));
      return;
    }
    setError(null);
    send.mutate({ data: { phoneNumber: `+966${local}` } });
  };

  const onResend = () => {
    if (resendIn > 0) return;
    onSend();
  };

  const onVerify = () => {
    const normalizedCode = normalizeOtp(code);
    if (!isValidOtp(normalizedCode)) {
      setError(t("verify.invalidCode"));
      return;
    }
    setError(null);
    verify.mutate({ data: { code: normalizedCode } });
  };

  return (
    <Screen scroll>
      <ScreenHeader
        title={t("verify.title")}
        subtitle={sent ? t("verify.sent") : t("verify.subtitle")}
        right={<LangToggle />}
      />

      <Reveal>
      <Card>
        {!sent ? (
          <>
            <TextField
              label={t("verify.phone")}
              value={phone}
              onChangeText={setPhone}
              placeholder={t("verify.phonePlaceholder")}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <Button
              label={t("verify.send")}
              onPress={onSend}
              loading={send.isPending}
            />
          </>
        ) : (
          <>
            <TextField
              label={t("verify.code")}
              value={code}
              onChangeText={(value) => setCode(normalizeOtp(value))}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={8}
              returnKeyType="done"
              onSubmitEditing={onVerify}
            />
            <Button
              label={t("verify.confirm")}
              onPress={onVerify}
              loading={verify.isPending}
              disabled={!isValidOtp(code)}
            />
            <View style={{ alignItems: "center", marginTop: 14, gap: 12 }}>
              <Pressable onPress={onResend} disabled={resendIn > 0}>
                <ThemedText
                  size={13}
                  color={resendIn > 0 ? c.mutedForeground : c.thaddiGold}
                >
                  {resendIn > 0
                    ? `${t("verify.resend")} ${formatNum(resendIn)} ${t("verify.seconds")}`
                    : t("verify.resend.now")}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  setSent(false);
                  setCode("");
                  setError(null);
                }}
              >
                <ThemedText size={13} muted>
                  {t("verify.backToPhone")}
                </ThemedText>
              </Pressable>
            </View>
          </>
        )}

        {error ? (
          <ThemedText size={13} color={c.destructive} center style={{ marginTop: 12 }}>
            {error}
          </ThemedText>
        ) : null}
      </Card>
      </Reveal>

      <Pressable
        onPress={() => router.replace("/(activation)/pick-team")}
        style={{ alignItems: "center", marginTop: 18 }}
      >
        <ThemedText size={14} color={c.thaddiGold} weight="bold">
          {t("common.skip")} →
        </ThemedText>
      </Pressable>

      <Pressable
        onPress={() => void signOut()}
        style={{ alignItems: "center", marginTop: 20 }}
      >
        <ThemedText size={13} muted>
          {t("verify.signOutHint")} {t("auth.signOut")}
        </ThemedText>
      </Pressable>
    </Screen>
  );
}
