import { useReverification, useSession, useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  useSendMobileOtp,
  useVerifyMobileOtp,
} from "@workspace/api-client-react";
import React, {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { BottomSheet, Button, TextField, ThemedText } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useI18n } from "@/lib/i18n";
import { isValidOtp, normalizeOtp } from "@/lib/otp";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SA_PHONE = /^(\+9665\d{8}|05\d{8})$/;

// Extracts a human-readable message from a Clerk SDK error, falling back to a
// caller-provided (localized) message when the error shape is unrecognized.
function clerkErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as
    | {
        errors?: Array<{ longMessage?: string; message?: string }>;
        message?: string;
      }
    | undefined;
  const first = anyErr?.errors?.[0];
  return first?.longMessage || first?.message || anyErr?.message || fallback;
}

// The user dismissed Clerk's step-up reverification prompt. Detected via the
// runtime error code so we avoid importing from a transitive Clerk subpath.
function isReverificationCancelled(err: unknown): boolean {
  const e = err as { code?: string } | undefined;
  return e?.code === "reverification_cancelled";
}

function apiErrorDetail(err: unknown): string | undefined {
  const e = err as { data?: { error?: string } } | undefined;
  return e?.data?.error;
}

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;
type EmailAddressResource = ClerkUser["emailAddresses"][number];

/* -------------------------------------------------------------------------- */
/* Modal shell (dir-aware, centered, tap-outside-to-close)                     */
/* -------------------------------------------------------------------------- */

function ModalShell({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
    >
      {children}
    </BottomSheet>
  );
}

function FieldError({ message }: { message: string }) {
  const c = useColors();
  return (
    <ThemedText size={13} color={c.destructive} style={{ marginBottom: 12 }}>
      {message}
    </ThemedText>
  );
}

/* -------------------------------------------------------------------------- */
/* Reverification guard (Clerk step-up, localized + RTL)                       */
/* -------------------------------------------------------------------------- */

type ReverificationLevel = "first_factor" | "second_factor" | "multi_factor";

// The shape Clerk's `useReverification` hands to a custom handler. We re-confirm
// the user's identity in-app, then call `complete()` to retry the original write.
export type NeedsReverificationParameters = {
  cancel: () => void;
  complete: () => void;
  level: ReverificationLevel | undefined;
};

type FactorKind = "email_code" | "phone_code" | "totp" | "backup_code";
type Mode = "loading" | "password" | "code" | "unsupported";
type Phase = "first" | "second";

// Loosely-typed views over Clerk's verification resource/factors so we can read
// the identifiers we need without importing the full (unstable) type surface.
type Factor = {
  strategy: string;
  emailAddressId?: string;
  phoneNumberId?: string;
  safeIdentifier?: string;
};
type VerificationResult = {
  status: "needs_first_factor" | "needs_second_factor" | "complete" | string;
  supportedFirstFactors?: Factor[] | null;
  supportedSecondFactors?: Factor[] | null;
};

/**
 * Drives Clerk's step-up reverification with a custom, localized, RTL-aware UI.
 *
 * Returns `onNeedsReverification` (pass it to `useReverification(action, { ... })`)
 * and `reverificationModal` (render it once in the same component tree).
 */
export function useReverificationGuard() {
  const [params, setParams] = useState<NeedsReverificationParameters | null>(
    null,
  );

  const onNeedsReverification = useCallback(
    (p: NeedsReverificationParameters) => {
      setParams(p);
    },
    [],
  );

  const reverificationModal = (
    <ReverificationModal params={params} onClose={() => setParams(null)} />
  );

  return { onNeedsReverification, reverificationModal };
}

function ReverificationModal({
  params,
  onClose,
}: {
  params: NeedsReverificationParameters | null;
  onClose: () => void;
}) {
  const c = useColors();
  const { t } = useI18n();
  const { session } = useSession();

  const [mode, setMode] = useState<Mode>("loading");
  const [phase, setPhase] = useState<Phase>("first");
  const [factorKind, setFactorKind] = useState<FactorKind | null>(null);
  const [target, setTarget] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const resetFields = () => {
    setPassword("");
    setCode("");
    setError("");
    setPending(false);
  };

  const finishComplete = useCallback(() => {
    const p = params;
    onClose();
    p?.complete();
  }, [params, onClose]);

  const handleCancel = useCallback(() => {
    const p = params;
    onClose();
    p?.cancel();
  }, [params, onClose]);

  const setupFirstFactor = useCallback(
    async (result: VerificationResult) => {
      if (!session) return setMode("unsupported");
      const factors = result.supportedFirstFactors ?? [];
      const s = session as unknown as {
        prepareFirstFactorVerification: (
          p: unknown,
        ) => Promise<VerificationResult>;
      };
      const pw = factors.find((f) => f.strategy === "password");
      if (pw) {
        setPhase("first");
        setFactorKind(null);
        setMode("password");
        return;
      }
      const email = factors.find((f) => f.strategy === "email_code");
      if (email?.emailAddressId) {
        await s.prepareFirstFactorVerification({
          strategy: "email_code",
          emailAddressId: email.emailAddressId,
        });
        setPhase("first");
        setFactorKind("email_code");
        setTarget(email.safeIdentifier ?? "");
        setMode("code");
        return;
      }
      const phone = factors.find((f) => f.strategy === "phone_code");
      if (phone?.phoneNumberId) {
        await s.prepareFirstFactorVerification({
          strategy: "phone_code",
          phoneNumberId: phone.phoneNumberId,
        });
        setPhase("first");
        setFactorKind("phone_code");
        setTarget(phone.safeIdentifier ?? "");
        setMode("code");
        return;
      }
      setMode("unsupported");
    },
    [session],
  );

  const setupSecondFactor = useCallback(
    async (result: VerificationResult) => {
      if (!session) return setMode("unsupported");
      const factors = result.supportedSecondFactors ?? [];
      const s = session as unknown as {
        prepareSecondFactorVerification: (
          p: unknown,
        ) => Promise<VerificationResult>;
      };
      const phone = factors.find((f) => f.strategy === "phone_code");
      if (phone?.phoneNumberId) {
        await s.prepareSecondFactorVerification({
          strategy: "phone_code",
          phoneNumberId: phone.phoneNumberId,
        });
        setPhase("second");
        setFactorKind("phone_code");
        setTarget(phone.safeIdentifier ?? "");
        setMode("code");
        return;
      }
      const totp = factors.find((f) => f.strategy === "totp");
      if (totp) {
        setPhase("second");
        setFactorKind("totp");
        setMode("code");
        return;
      }
      const backup = factors.find((f) => f.strategy === "backup_code");
      if (backup) {
        setPhase("second");
        setFactorKind("backup_code");
        setMode("code");
        return;
      }
      setMode("unsupported");
    },
    [session],
  );

  const process = useCallback(
    async (result: VerificationResult) => {
      if (result.status === "complete") {
        finishComplete();
        return;
      }
      if (result.status === "needs_first_factor") {
        await setupFirstFactor(result);
        return;
      }
      if (result.status === "needs_second_factor") {
        await setupSecondFactor(result);
        return;
      }
      setMode("unsupported");
    },
    [finishComplete, setupFirstFactor, setupSecondFactor],
  );

  // Kick off (or restart) the verification whenever a new step-up is requested.
  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    resetFields();
    setMode("loading");
    void (async () => {
      try {
        if (!session) {
          if (!cancelled) setMode("unsupported");
          return;
        }
        const s = session as unknown as {
          startVerification: (p: {
            level: ReverificationLevel;
          }) => Promise<VerificationResult>;
        };
        const result = await s.startVerification({
          level: params.level ?? "first_factor",
        });
        if (!cancelled) await process(result);
      } catch (err) {
        if (!cancelled) {
          setMode("unsupported");
          setError(clerkErrorMessage(err, t("reverify.error")));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submitPassword = async () => {
    if (!session || !password) return;
    setPending(true);
    setError("");
    try {
      const s = session as unknown as {
        attemptFirstFactorVerification: (
          p: unknown,
        ) => Promise<VerificationResult>;
      };
      const result = await s.attemptFirstFactorVerification({
        strategy: "password",
        password,
      });
      await process(result);
    } catch (err) {
      setError(clerkErrorMessage(err, t("reverify.error")));
      setPending(false);
    }
  };

  const submitCode = async () => {
    if (!session || !factorKind || !code) return;
    setPending(true);
    setError("");
    try {
      const s = session as unknown as {
        attemptFirstFactorVerification: (
          p: unknown,
        ) => Promise<VerificationResult>;
        attemptSecondFactorVerification: (
          p: unknown,
        ) => Promise<VerificationResult>;
      };
      const result =
        phase === "first"
          ? await s.attemptFirstFactorVerification({
              strategy: factorKind,
              code,
            })
          : await s.attemptSecondFactorVerification({
              strategy: factorKind,
              code,
            });
      await process(result);
    } catch (err) {
      setError(clerkErrorMessage(err, t("reverify.error")));
      setPending(false);
    }
  };

  const codeDesc = () => {
    if (factorKind === "totp") return t("reverify.code.totpDesc");
    if (factorKind === "backup_code") return t("reverify.code.backupDesc");
    if (factorKind === "phone_code")
      return t("reverify.code.phoneDesc", { target });
    return t("reverify.code.emailDesc", { target });
  };

  const isBackup = factorKind === "backup_code";
  const subtitle =
    mode === "password"
      ? t("reverify.password.desc")
      : mode === "code"
        ? codeDesc()
        : mode === "unsupported"
          ? error || t("reverify.unsupported")
          : undefined;

  return (
    <ModalShell
      visible={!!params}
      onClose={handleCancel}
      title={t("reverify.title")}
      subtitle={subtitle}
    >
      {mode === "loading" ? (
        <View style={{ paddingVertical: 28, alignItems: "center" }}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : null}

      {mode === "password" ? (
        <View>
          <TextField
            label={t("reverify.password.label")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            testID="input-reverify-password"
          />
          {error ? <FieldError message={error} /> : null}
          <Button
            label={t("reverify.submit")}
            onPress={submitPassword}
            loading={pending}
            disabled={!password}
            testID="button-reverify-submit"
          />
        </View>
      ) : null}

      {mode === "code" ? (
        <View>
          <TextField
            label={
              isBackup
                ? t("reverify.code.backupLabel")
                : t("reverify.code.label")
            }
            value={code}
            onChangeText={setCode}
            keyboardType={isBackup ? "default" : "number-pad"}
            autoCapitalize="none"
            testID="input-reverify-code"
          />
          {error ? <FieldError message={error} /> : null}
          <Button
            label={t("reverify.submit")}
            onPress={submitCode}
            loading={pending}
            disabled={isBackup ? !code : code.length < 6}
            testID="button-reverify-submit"
          />
        </View>
      ) : null}

      {mode === "unsupported" ? (
        <Button
          label={t("common.cancel")}
          variant="outline"
          onPress={handleCancel}
          testID="button-reverify-cancel"
        />
      ) : null}
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Change mobile (pure API, OTP)                                               */
/* -------------------------------------------------------------------------- */

export function ChangeMobileSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const c = useColors();
  const { t, formatNum } = useI18n();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhone("");
    setStep("phone");
    setCode("");
    setCountdown(0);
    setError(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(
      () => setCountdown((s) => (s <= 1 ? 0 : s - 1)),
      1000,
    );
    return () => clearInterval(id);
  }, [countdown]);

  const send = useSendMobileOtp({
    mutation: {
      onSuccess: (res) => {
        setStep("code");
        setCountdown(res.expiresInSeconds ?? 60);
        setError(null);
      },
      onError: (err) =>
        setError(apiErrorDetail(err) ?? t("verify.error")),
    },
  });

  const verify = useVerifyMobileOtp({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        handleClose();
      },
      onError: (err) =>
        setError(apiErrorDetail(err) ?? t("verify.invalidCode")),
    },
  });

  const handleSend = () => {
    const normalized = phone.trim();
    if (!SA_PHONE.test(normalized)) {
      setError(t("verify.invalidPhone"));
      return;
    }
    setError(null);
    send.mutate({ data: { phoneNumber: normalized } });
  };

  const handleVerify = () => {
    const normalizedCode = normalizeOtp(code);
    if (!isValidOtp(normalizedCode)) {
      setError(t("verify.invalidCode"));
      return;
    }
    setError(null);
    verify.mutate({ data: { code: normalizedCode } });
  };

  return (
    <ModalShell
      visible={visible}
      onClose={handleClose}
      title={t("account.mobile.title")}
    >
      {step === "phone" ? (
        <View>
          <TextField
            label={t("account.mobile.newLabel")}
            value={phone}
            onChangeText={setPhone}
            placeholder={t("verify.phonePlaceholder")}
            keyboardType="phone-pad"
            autoComplete="tel"
            testID="input-new-mobile"
          />
          {error ? <FieldError message={error} /> : null}
          <Button
            label={t("verify.send")}
            onPress={handleSend}
            loading={send.isPending}
            testID="button-send-mobile-otp"
          />
        </View>
      ) : (
        <View>
          <TextField
            label={t("verify.code")}
            value={code}
            onChangeText={(value) => setCode(normalizeOtp(value))}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="oneTimeCode"
            maxLength={8}
            returnKeyType="done"
            onSubmitEditing={handleVerify}
            testID="input-mobile-otp"
          />
          {error ? <FieldError message={error} /> : null}
          <Button
            label={t("verify.confirm")}
            onPress={handleVerify}
            loading={verify.isPending}
            disabled={!isValidOtp(code)}
            testID="button-verify-mobile-otp"
          />
          <View style={{ alignItems: "center", marginTop: 14 }}>
            <Pressable
              onPress={() => {
                if (countdown > 0) return;
                handleSend();
              }}
              disabled={countdown > 0}
            >
              <ThemedText
                size={13}
                color={countdown > 0 ? c.mutedForeground : c.thaddiGold}
              >
                {countdown > 0
                  ? `${t("verify.resend")} ${formatNum(countdown)} ${t("verify.seconds")}`
                  : t("verify.resend.now")}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Change email (Clerk, with step-up reverification)                          */
/* -------------------------------------------------------------------------- */

export function ChangeEmailSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { onNeedsReverification, reverificationModal } =
    useReverificationGuard();

  const setPrimaryEmail = useReverification(
    (primaryEmailAddressId: string) => user!.update({ primaryEmailAddressId }),
    { onNeedsReverification },
  );

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<EmailAddressResource | null>(null);

  const reset = useCallback(() => {
    setStep("email");
    setEmail("");
    setCode("");
    setPending(false);
    setError(null);
    setCreated(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSendCode = async () => {
    if (!user) return;
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      setError(t("account.email.invalid"));
      return;
    }
    if (user.primaryEmailAddress?.emailAddress?.toLowerCase() === value) {
      setError(t("account.email.same"));
      return;
    }
    setError(null);
    setPending(true);
    try {
      // Reuse an existing in-progress entry for this address if present.
      let emailAddress =
        user.emailAddresses.find(
          (e) => e.emailAddress.toLowerCase() === value,
        ) ?? null;
      if (!emailAddress) {
        emailAddress = await user.createEmailAddress({ email: value });
      }
      await emailAddress.prepareVerification({ strategy: "email_code" });
      setCreated(emailAddress);
      setStep("code");
    } catch (err) {
      setError(clerkErrorMessage(err, t("account.changeError")));
    } finally {
      setPending(false);
    }
  };

  const handleConfirm = async () => {
    if (!user || !created) return;
    const normalizedCode = normalizeOtp(code);
    if (!/^[0-9]{6,8}$/.test(normalizedCode)) {
      setError(t("verify.invalidCode"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await created.attemptVerification({ code: normalizedCode });
      if (result.verification.status !== "verified") {
        setError(t("verify.invalidCode"));
        setPending(false);
        return;
      }
      // Promote the new address to primary, then drop the others so the
      // single-primary-email model is preserved. Clerk may require step-up
      // reverification here, which the guard handles in-app.
      await setPrimaryEmail(created.id);
      const stale = user.emailAddresses.filter((e) => e.id !== created.id);
      for (const e of stale) {
        try {
          await e.destroy();
        } catch {
          // Non-fatal: the new email is already primary.
        }
      }
      await user.reload();
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      handleClose();
    } catch (err) {
      // User dismissed the reverification prompt — keep the sheet open.
      if (isReverificationCancelled(err)) {
        setPending(false);
        return;
      }
      setError(clerkErrorMessage(err, t("verify.invalidCode")));
      setPending(false);
    }
  };

  const subtitle =
    step === "code"
      ? t("account.email.codeDesc", { email: email.trim().toLowerCase() })
      : undefined;

  return (
    <>
      <ModalShell
        visible={visible}
        onClose={handleClose}
        title={t("account.email.title")}
        subtitle={subtitle}
      >
        {step === "email" ? (
          <View>
            <TextField
              label={t("account.email.newLabel")}
              value={email}
              onChangeText={setEmail}
              placeholder={t("account.email.newPlaceholder")}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              testID="input-new-email"
            />
            {error ? <FieldError message={error} /> : null}
            <Button
              label={t("account.email.send")}
              onPress={() => void handleSendCode()}
              loading={pending}
              testID="button-send-email-code"
            />
          </View>
        ) : (
          <View>
            <TextField
              label={t("account.email.codeLabel")}
              value={code}
              onChangeText={(value) => setCode(normalizeOtp(value))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="oneTimeCode"
              maxLength={8}
              returnKeyType="done"
              onSubmitEditing={() => void handleConfirm()}
              testID="input-email-otp"
            />
            {error ? <FieldError message={error} /> : null}
            <Button
              label={t("account.email.confirm")}
              onPress={() => void handleConfirm()}
              loading={pending}
              disabled={!/^[0-9]{6,8}$/.test(code)}
              testID="button-confirm-email"
            />
            <View style={{ alignItems: "center", marginTop: 14 }}>
              <Pressable
                onPress={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              >
                <ThemedText size={13} gold>
                  {t("account.email.changeLink")}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        )}
      </ModalShell>
      {reverificationModal}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Change / set password (Clerk, with step-up reverification)                 */
/* -------------------------------------------------------------------------- */

export function ChangePasswordSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { user } = useUser();
  const { onNeedsReverification, reverificationModal } =
    useReverificationGuard();

  const updatePassword = useReverification(
    (params: Parameters<NonNullable<typeof user>["updatePassword"]>[0]) =>
      user!.updatePassword(params),
    { onNeedsReverification },
  );

  const hasPassword = Boolean(user?.passwordEnabled);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setPending(false);
    setError(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (next.length < 8) {
      setError(t("account.password.tooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("account.password.mismatch"));
      return;
    }
    setError(null);
    setPending(true);
    try {
      await updatePassword(
        hasPassword
          ? {
              currentPassword: current,
              newPassword: next,
              signOutOfOtherSessions: true,
            }
          : { newPassword: next, signOutOfOtherSessions: true },
      );
      handleClose();
    } catch (err) {
      // User dismissed the reverification prompt — leave the sheet as-is.
      if (isReverificationCancelled(err)) {
        setPending(false);
        return;
      }
      setError(clerkErrorMessage(err, t("account.changeError")));
      setPending(false);
    }
  };

  return (
    <>
      <ModalShell
        visible={visible}
        onClose={handleClose}
        title={
          hasPassword
            ? t("account.password.changeTitle")
            : t("account.password.setTitle")
        }
        subtitle={hasPassword ? undefined : t("account.password.setDesc")}
      >
        <View>
          {hasPassword ? (
            <TextField
              label={t("account.password.current")}
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              autoCapitalize="none"
              testID="input-current-password"
            />
          ) : null}
          <TextField
            label={t("account.password.new")}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoCapitalize="none"
            testID="input-new-password"
          />
          <TextField
            label={t("account.password.confirm")}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            testID="input-confirm-password"
          />
          {error ? <FieldError message={error} /> : null}
          <Button
            label={
              hasPassword
                ? t("account.password.submit")
                : t("account.password.setSubmit")
            }
            onPress={() => void handleSubmit()}
            loading={pending}
            testID="button-submit-password"
          />
        </View>
      </ModalShell>
      {reverificationModal}
    </>
  );
}
