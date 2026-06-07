import React, { useState } from 'react';
import { useUser, useReverification } from '@clerk/react';
import { isReverificationCancelledError } from '@clerk/react/errors';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMeQueryKey } from '@workspace/api-client-react';
import { useI18n } from '../../lib/i18n';
import { clerkErrorMessage } from '../../lib/clerkError';
import { useReverificationGuard } from './reverification-dialog';
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
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ClerkUser = NonNullable<ReturnType<typeof useUser>['user']>;
type EmailAddressResource = ClerkUser['emailAddresses'][number];

export function ChangeEmailDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, dir } = useI18n();
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { onNeedsReverification, reverificationDialog } = useReverificationGuard();

  const setPrimaryEmail = useReverification(
    (primaryEmailAddressId: string) => user!.update({ primaryEmailAddressId }),
    { onNeedsReverification },
  );

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<EmailAddressResource | null>(null);

  const reset = () => {
    setStep('email');
    setEmail('');
    setCode('');
    setCreated(null);
    setPending(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSendCode = async () => {
    if (!user) return;
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      toast({ title: t('account.email.invalid'), variant: 'destructive' });
      return;
    }
    if (user.primaryEmailAddress?.emailAddress?.toLowerCase() === value) {
      toast({ title: t('account.email.same'), variant: 'destructive' });
      return;
    }
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
      await emailAddress.prepareVerification({ strategy: 'email_code' });
      setCreated(emailAddress);
      setStep('code');
      toast({ title: t('verify.otpSent') });
    } catch (err) {
      toast({
        title: t('account.changeError'),
        description: clerkErrorMessage(err, t('account.changeError')),
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  };

  const handleConfirm = async () => {
    if (!user || !created) return;
    if (code.length < 6) return;
    setPending(true);
    try {
      const result = await created.attemptVerification({ code });
      if (result.verification.status !== 'verified') {
        toast({ title: t('verify.invalidCode'), variant: 'destructive' });
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
      toast({ title: t('account.email.success') });
      handleOpenChange(false);
    } catch (err) {
      // User dismissed the reverification prompt — keep the dialog open.
      if (isReverificationCancelledError(err)) {
        setPending(false);
        return;
      }
      toast({
        title: t('account.changeError'),
        description: clerkErrorMessage(err, t('verify.invalidCode')),
        variant: 'destructive',
      });
      setPending(false);
    }
  };

  return (
    <>
      {reverificationDialog}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent dir={dir}>
        <DialogHeader>
          <DialogTitle>{t('account.email.title')}</DialogTitle>
          {step === 'code' && (
            <DialogDescription>
              {t('account.email.codeDesc').replace('{email}', email.trim().toLowerCase())}
            </DialogDescription>
          )}
        </DialogHeader>

        {step === 'email' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-email">{t('account.email.newLabel')}</Label>
              <Input
                id="new-email"
                type="email"
                dir="ltr"
                placeholder={t('account.email.newPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-new-email"
              />
            </div>
            <Button
              className="w-full font-bold"
              onClick={handleSendCode}
              disabled={pending}
              data-testid="button-send-email-code"
            >
              {pending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('account.email.send')}
            </Button>
          </div>
        ) : (
          <div className="space-y-6 flex flex-col items-center">
            <div className="space-y-2 w-full flex flex-col items-center">
              <Label>{t('account.email.codeLabel')}</Label>
              <div dir="ltr">
                <InputOTP maxLength={6} value={code} onChange={setCode} data-testid="input-email-otp">
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
            </div>
            <Button
              className="w-full font-bold"
              onClick={handleConfirm}
              disabled={pending || code.length < 6}
              data-testid="button-confirm-email"
            >
              {pending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('account.email.confirm')}
            </Button>
            <Button
              variant="link"
              className="p-0 h-auto"
              onClick={() => {
                setStep('email');
                setCode('');
              }}
              data-testid="button-email-back"
            >
              {t('account.email.changeLink')}
            </Button>
          </div>
        )}
        </DialogContent>
      </Dialog>
    </>
  );
}
