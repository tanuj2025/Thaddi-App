import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from '@clerk/react';
import { useI18n } from '../../lib/i18n';
import { clerkErrorMessage } from '../../lib/clerkError';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

type ReverificationLevel = 'first_factor' | 'second_factor' | 'multi_factor';

// The shape Clerk's `useReverification` hands to a custom handler. We re-confirm
// the user's identity in-app, then call `complete()` to retry the original write.
export type NeedsReverificationParameters = {
  cancel: () => void;
  complete: () => void;
  level: ReverificationLevel | undefined;
};

type FactorKind = 'email_code' | 'phone_code' | 'totp' | 'backup_code';
type Mode = 'loading' | 'password' | 'code' | 'unsupported';
type Phase = 'first' | 'second';

// Loosely-typed views over Clerk's verification resource/factors so we can read
// the identifiers we need without importing the full (unstable) type surface.
type Factor = {
  strategy: string;
  emailAddressId?: string;
  phoneNumberId?: string;
  safeIdentifier?: string;
};
type VerificationResult = {
  status: 'needs_first_factor' | 'needs_second_factor' | 'complete' | string;
  supportedFirstFactors?: Factor[] | null;
  supportedSecondFactors?: Factor[] | null;
};

/**
 * Drives Clerk's step-up reverification with a custom, localized, RTL-aware UI.
 *
 * Returns `onNeedsReverification` (pass it to `useReverification(action, { ... })`)
 * and `reverificationDialog` (render it once in the same component tree).
 */
export function useReverificationGuard() {
  const [params, setParams] = useState<NeedsReverificationParameters | null>(null);

  const onNeedsReverification = useCallback((p: NeedsReverificationParameters) => {
    setParams(p);
  }, []);

  const reverificationDialog = (
    <ReverificationDialog params={params} onClose={() => setParams(null)} />
  );

  return { onNeedsReverification, reverificationDialog };
}

function ReverificationDialog({
  params,
  onClose,
}: {
  params: NeedsReverificationParameters | null;
  onClose: () => void;
}) {
  const { t, dir } = useI18n();
  const { session } = useSession();

  const [mode, setMode] = useState<Mode>('loading');
  const [phase, setPhase] = useState<Phase>('first');
  const [factorKind, setFactorKind] = useState<FactorKind | null>(null);
  const [target, setTarget] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const resetFields = () => {
    setPassword('');
    setCode('');
    setError('');
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
      if (!session) return setMode('unsupported');
      const factors = result.supportedFirstFactors ?? [];
      const s = session as unknown as {
        prepareFirstFactorVerification: (p: unknown) => Promise<VerificationResult>;
      };
      const pw = factors.find((f) => f.strategy === 'password');
      if (pw) {
        setPhase('first');
        setFactorKind(null);
        setMode('password');
        return;
      }
      const email = factors.find((f) => f.strategy === 'email_code');
      if (email?.emailAddressId) {
        await s.prepareFirstFactorVerification({
          strategy: 'email_code',
          emailAddressId: email.emailAddressId,
        });
        setPhase('first');
        setFactorKind('email_code');
        setTarget(email.safeIdentifier ?? '');
        setMode('code');
        return;
      }
      const phone = factors.find((f) => f.strategy === 'phone_code');
      if (phone?.phoneNumberId) {
        await s.prepareFirstFactorVerification({
          strategy: 'phone_code',
          phoneNumberId: phone.phoneNumberId,
        });
        setPhase('first');
        setFactorKind('phone_code');
        setTarget(phone.safeIdentifier ?? '');
        setMode('code');
        return;
      }
      setMode('unsupported');
    },
    [session],
  );

  const setupSecondFactor = useCallback(
    async (result: VerificationResult) => {
      if (!session) return setMode('unsupported');
      const factors = result.supportedSecondFactors ?? [];
      const s = session as unknown as {
        prepareSecondFactorVerification: (p: unknown) => Promise<VerificationResult>;
      };
      const phone = factors.find((f) => f.strategy === 'phone_code');
      if (phone?.phoneNumberId) {
        await s.prepareSecondFactorVerification({
          strategy: 'phone_code',
          phoneNumberId: phone.phoneNumberId,
        });
        setPhase('second');
        setFactorKind('phone_code');
        setTarget(phone.safeIdentifier ?? '');
        setMode('code');
        return;
      }
      const totp = factors.find((f) => f.strategy === 'totp');
      if (totp) {
        setPhase('second');
        setFactorKind('totp');
        setMode('code');
        return;
      }
      const backup = factors.find((f) => f.strategy === 'backup_code');
      if (backup) {
        setPhase('second');
        setFactorKind('backup_code');
        setMode('code');
        return;
      }
      setMode('unsupported');
    },
    [session],
  );

  const process = useCallback(
    async (result: VerificationResult) => {
      if (result.status === 'complete') {
        finishComplete();
        return;
      }
      if (result.status === 'needs_first_factor') {
        await setupFirstFactor(result);
        return;
      }
      if (result.status === 'needs_second_factor') {
        await setupSecondFactor(result);
        return;
      }
      setMode('unsupported');
    },
    [finishComplete, setupFirstFactor, setupSecondFactor],
  );

  // Kick off (or restart) the verification whenever a new step-up is requested.
  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    resetFields();
    setMode('loading');
    (async () => {
      try {
        if (!session) {
          if (!cancelled) setMode('unsupported');
          return;
        }
        const s = session as unknown as {
          startVerification: (p: { level: ReverificationLevel }) => Promise<VerificationResult>;
        };
        const result = await s.startVerification({
          level: params.level ?? 'first_factor',
        });
        if (!cancelled) await process(result);
      } catch (err) {
        if (!cancelled) {
          setMode('unsupported');
          setError(clerkErrorMessage(err, t('reverify.error')));
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
    setError('');
    try {
      const s = session as unknown as {
        attemptFirstFactorVerification: (p: unknown) => Promise<VerificationResult>;
      };
      const result = await s.attemptFirstFactorVerification({
        strategy: 'password',
        password,
      });
      await process(result);
    } catch (err) {
      setError(clerkErrorMessage(err, t('reverify.error')));
      setPending(false);
    }
  };

  const submitCode = async () => {
    if (!session || !factorKind || !code) return;
    setPending(true);
    setError('');
    try {
      const s = session as unknown as {
        attemptFirstFactorVerification: (p: unknown) => Promise<VerificationResult>;
        attemptSecondFactorVerification: (p: unknown) => Promise<VerificationResult>;
      };
      const result =
        phase === 'first'
          ? await s.attemptFirstFactorVerification({ strategy: factorKind, code })
          : await s.attemptSecondFactorVerification({ strategy: factorKind, code });
      await process(result);
    } catch (err) {
      setError(clerkErrorMessage(err, t('reverify.error')));
      setPending(false);
    }
  };

  const codeDesc = () => {
    if (factorKind === 'totp') return t('reverify.code.totpDesc');
    if (factorKind === 'backup_code') return t('reverify.code.backupDesc');
    if (factorKind === 'phone_code')
      return t('reverify.code.phoneDesc').replace('{target}', target);
    return t('reverify.code.emailDesc').replace('{target}', target);
  };

  const isBackup = factorKind === 'backup_code';

  return (
    <Dialog open={!!params} onOpenChange={(next) => !next && handleCancel()}>
      <DialogContent dir={dir}>
        <DialogHeader>
          <DialogTitle>{t('reverify.title')}</DialogTitle>
          {mode === 'password' && (
            <DialogDescription>{t('reverify.password.desc')}</DialogDescription>
          )}
          {mode === 'code' && <DialogDescription>{codeDesc()}</DialogDescription>}
          {mode === 'unsupported' && (
            <DialogDescription>
              {error || t('reverify.unsupported')}
            </DialogDescription>
          )}
        </DialogHeader>

        {mode === 'loading' && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {mode === 'password' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reverify-password">{t('reverify.password.label')}</Label>
              <Input
                id="reverify-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && password && !pending) submitPassword();
                }}
                data-testid="input-reverify-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-reverify-error">
                {error}
              </p>
            )}
            <Button
              className="w-full font-bold"
              onClick={submitPassword}
              disabled={pending || !password}
              data-testid="button-reverify-submit"
            >
              {pending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('reverify.submit')}
            </Button>
          </div>
        )}

        {mode === 'code' && (
          <div className="space-y-6 flex flex-col items-center">
            <div className="space-y-2 w-full flex flex-col items-center">
              <Label>
                {isBackup ? t('reverify.code.backupLabel') : t('reverify.code.label')}
              </Label>
              {isBackup ? (
                <Input
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  data-testid="input-reverify-backup"
                />
              ) : (
                <div dir="ltr">
                  <InputOTP
                    maxLength={6}
                    value={code}
                    onChange={setCode}
                    data-testid="input-reverify-otp"
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              )}
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-reverify-error">
                {error}
              </p>
            )}
            <Button
              className="w-full font-bold"
              onClick={submitCode}
              disabled={pending || (isBackup ? !code : code.length < 6)}
              data-testid="button-reverify-submit"
            >
              {pending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('reverify.submit')}
            </Button>
          </div>
        )}

        {mode === 'unsupported' && (
          <Button
            variant="outline"
            className="w-full font-bold"
            onClick={handleCancel}
            data-testid="button-reverify-cancel"
          >
            {t('common.cancel')}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
