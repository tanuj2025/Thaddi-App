import React, { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useLocation } from 'wouter';
import { useGetMe, useSendMobileOtp, useVerifyMobileOtp, getGetMeQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export default function VerifyMobilePage() {
  const { t, dir } = useI18n();
  const [, setLocation] = useLocation();
  const { data: me } = useGetMe();
  const sendOtp = useSendMobileOtp();
  const verifyOtp = useVerifyMobileOtp();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState(me?.mobileNumber || '');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (me?.mobileVerified) setLocation('/');
  }, [me, setLocation]);

  useEffect(() => {
    let timer: any;
    if (countdown > 0) {
      timer = setInterval(() => setCountdown(c => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  const handleSendOtp = () => {
    if (!phone || phone.length < 9) {
      toast({ title: t('verify.invalidPhone'), variant: 'destructive' });
      return;
    }
    sendOtp.mutate({ data: { phoneNumber: phone } }, {
      onSuccess: (res) => {
        setStep('code');
        setCountdown(res.expiresInSeconds || 60);
        toast({ title: t('verify.otpSent') });
      },
      onError: (err) => {
        toast({ title: t('verify.error'), description: err.data?.error, variant: 'destructive' });
      }
    });
  };

  const handleVerifyOtp = () => {
    if (!code || code.length < 4) return;
    verifyOtp.mutate({ data: { code } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast({ title: t('verify.verified') });
        setLocation('/');
      },
      onError: (err) => {
        toast({ title: t('verify.invalidCode'), description: err.data?.error, variant: 'destructive' });
      }
    });
  };

  return (
    <div className="min-h-screen bg-stadium flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md card-premium shadow-2xl text-center">
        <CardHeader className="space-y-4">
          <img src="/logo.png" alt={t('app.name')} className="h-24 md:h-28 w-auto mx-auto drop-shadow-sm" />
          <CardTitle className="text-3xl font-black text-gold-gradient tracking-tight">{t('verify.title')}</CardTitle>
          <CardDescription className="text-muted-foreground/80">{t('verify.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'phone' ? (
            <div className="space-y-4">
              <div dir="ltr">
                <Input 
                  type="tel" 
                  placeholder={t('verify.phonePlaceholder')} 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)} 
                  className="text-center text-lg tracking-widest"
                  data-testid="input-phone"
                />
              </div>
              <Button 
                className="w-full font-bold glow-green hover:brightness-110 transition-all py-6 text-lg" 
                onClick={handleSendOtp} 
                disabled={sendOtp.isPending}
                data-testid="button-send-otp"
              >
                {sendOtp.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t('verify.send')}
              </Button>
            </div>
          ) : (
            <div className="space-y-6 flex flex-col items-center">
              <div dir="ltr">
                <InputOTP maxLength={4} value={code} onChange={setCode} data-testid="input-otp">
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              
              <Button 
                className="w-full font-bold glow-green hover:brightness-110 transition-all py-6 text-lg" 
                onClick={handleVerifyOtp} 
                disabled={verifyOtp.isPending || code.length < 4}
                data-testid="button-verify-otp"
              >
                {verifyOtp.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t('verify.confirm')}
              </Button>

              <div className="text-sm text-muted-foreground">
                {countdown > 0 ? (
                  <span>{t('verify.resend')} {countdown}{t('verify.seconds')}</span>
                ) : (
                  <Button variant="link" onClick={handleSendOtp} disabled={sendOtp.isPending} className="p-0 h-auto">
                    {t('verify.resend.now')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
