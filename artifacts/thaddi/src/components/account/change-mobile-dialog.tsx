import React, { useEffect, useState } from 'react';
import {
  useSendMobileOtp,
  useVerifyMobileOtp,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export function ChangeMobileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, dir } = useI18n();
  const sendOtp = useSendMobileOtp();
  const verifyOtp = useVerifyMobileOtp();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  const reset = () => {
    setPhone('');
    setStep('phone');
    setCode('');
    setCountdown(0);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (countdown > 0) {
      timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const handleSendOtp = () => {
    if (!phone || phone.length < 9) {
      toast({ title: t('verify.invalidPhone'), variant: 'destructive' });
      return;
    }
    sendOtp.mutate(
      { data: { phoneNumber: phone } },
      {
        onSuccess: (res) => {
          setStep('code');
          setCountdown(res.expiresInSeconds || 60);
          toast({ title: t('verify.otpSent') });
        },
        onError: (err) => {
          toast({
            title: t('verify.error'),
            description: err.data?.error,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleVerifyOtp = () => {
    if (!code || code.length < 4) return;
    verifyOtp.mutate(
      { data: { code } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast({ title: t('account.mobile.success') });
          handleOpenChange(false);
        },
        onError: (err) => {
          toast({
            title: t('verify.invalidCode'),
            description: err.data?.error,
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir={dir}>
        <DialogHeader>
          <DialogTitle>{t('account.mobile.title')}</DialogTitle>
        </DialogHeader>

        {step === 'phone' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-mobile">{t('account.mobile.newLabel')}</Label>
              <Input
                id="new-mobile"
                type="tel"
                dir="ltr"
                placeholder={t('verify.phonePlaceholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="text-center text-lg tracking-widest"
                data-testid="input-new-mobile"
              />
            </div>
            <Button
              className="w-full font-bold"
              onClick={handleSendOtp}
              disabled={sendOtp.isPending}
              data-testid="button-send-mobile-otp"
            >
              {sendOtp.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('verify.send')}
            </Button>
          </div>
        ) : (
          <div className="space-y-6 flex flex-col items-center">
            <div className="space-y-2 w-full flex flex-col items-center">
              <Label>{t('verify.code')}</Label>
              <div dir="ltr">
                <InputOTP maxLength={6} value={code} onChange={setCode} data-testid="input-mobile-otp">
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
              onClick={handleVerifyOtp}
              disabled={verifyOtp.isPending || code.length < 4}
              data-testid="button-verify-mobile-otp"
            >
              {verifyOtp.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('verify.confirm')}
            </Button>
            <div className="text-sm text-muted-foreground">
              {countdown > 0 ? (
                <span>
                  {t('verify.resend')} {countdown}
                  {t('verify.seconds')}
                </span>
              ) : (
                <Button
                  variant="link"
                  onClick={handleSendOtp}
                  disabled={sendOtp.isPending}
                  className="p-0 h-auto"
                  data-testid="button-resend-mobile-otp"
                >
                  {t('verify.resend.now')}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
