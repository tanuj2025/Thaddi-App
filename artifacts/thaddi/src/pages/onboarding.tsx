import React, { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useLocation, Link } from 'wouter';
import { 
  useGetMe, 
  useUpdateProfile, 
  useGetSuggestedDisplayNames, 
  useCheckDisplayNameAvailability, 
  useCheckUsernameAvailability 
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMeQueryKey } from '@workspace/api-client-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

const profileSchema = z.object({
  realName: z.string().min(1).max(120),
  displayName: z.string().min(2).max(40),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores'),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function OnboardingPage() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const { data: me } = useGetMe();
  const updateProfile = useUpdateProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      realName: me?.realName || '',
      displayName: me?.displayName || '',
      username: me?.username || '',
    },
  });

  const watchDisplayName = form.watch('displayName');
  const watchUsername = form.watch('username');

  // We could use debouncing and the check hooks here, but for simplicity we'll just let the backend validate on submit or show basic hints
  // Integrating the check hooks:
  const { data: displayNameCheck } = useCheckDisplayNameAvailability(
    { displayName: watchDisplayName }, 
    { query: { enabled: watchDisplayName.length >= 2, queryKey: ['checkDisplayName', watchDisplayName] } }
  );

  const { data: usernameCheck } = useCheckUsernameAvailability(
    { username: watchUsername },
    { query: { enabled: watchUsername.length >= 3, queryKey: ['checkUsername', watchUsername] } }
  );

  const { refetch: getSuggestions, isFetching: gettingSuggestions } = useGetSuggestedDisplayNames({
    query: { enabled: false, queryKey: ['getSuggestions'] }
  });

  const handleSuggest = async () => {
    const { data } = await getSuggestions();
    if (data && data.suggestions && data.suggestions.length > 0) {
      form.setValue('displayName', data.suggestions[0], { shouldValidate: true });
    }
  };

  const onSubmit = (values: ProfileFormValues) => {
    if (!consent) {
      setConsentError(true);
      return;
    }
    if (displayNameCheck && !displayNameCheck.available) {
      form.setError('displayName', { message: displayNameCheck.reason || t('onboarding.notAvailable') });
      return;
    }
    if (usernameCheck && !usernameCheck.available) {
      form.setError('username', { message: usernameCheck.reason || t('onboarding.notAvailable') });
      return;
    }

    updateProfile.mutate({ data: { ...values, termsAccepted: true } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast({ title: t('onboarding.saved') });
        // The activation gate in App.tsx should auto-route to the next step, but we can nudge it
        setLocation('/'); 
      },
      onError: (err) => {
        toast({ title: t('onboarding.saveError'), description: err.data?.error, variant: 'destructive' });
      }
    });
  };

  // If already complete, shouldn't be here (ActivationGate handles this but just in case)
  useEffect(() => {
    if (me?.profileComplete) setLocation('/');
  }, [me, setLocation]);

  return (
    <div className="min-h-screen bg-stadium flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md card-premium shadow-2xl">
        <CardHeader className="text-center space-y-4">
          <img src="/logo.png" alt="THADDI Logo" className="h-20 w-auto mx-auto drop-shadow-sm" />
          <CardTitle className="text-3xl font-black text-gold-gradient tracking-tight">{t('onboarding.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="realName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('onboarding.realName')}</FormLabel>
                    <FormControl>
                      <Input placeholder="Ali Al-Qahtani" {...field} data-testid="input-real-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('onboarding.displayName')}</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input placeholder="AliQ" {...field} data-testid="input-display-name" />
                      </FormControl>
                      <Button type="button" variant="outline" onClick={handleSuggest} disabled={gettingSuggestions} data-testid="button-suggest-name">
                        {gettingSuggestions ? <Loader2 className="h-4 w-4 animate-spin" /> : t('onboarding.suggest')}
                      </Button>
                    </div>
                    {displayNameCheck && !displayNameCheck.available && (
                      <FormDescription className="text-destructive">{displayNameCheck.reason}</FormDescription>
                    )}
                    {displayNameCheck && displayNameCheck.available && watchDisplayName.length >= 2 && (
                      <FormDescription className="text-primary">{t('onboarding.available')}</FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('onboarding.username')}</FormLabel>
                    <FormControl>
                      <Input placeholder="ali_q" {...field} data-testid="input-username" />
                    </FormControl>
                    {usernameCheck && !usernameCheck.available && (
                      <FormDescription className="text-destructive">{usernameCheck.reason}</FormDescription>
                    )}
                    {usernameCheck && usernameCheck.available && watchUsername.length >= 3 && (
                      <FormDescription className="text-primary">{t('onboarding.available')}</FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="consent"
                    checked={consent}
                    onCheckedChange={(checked) => {
                      const value = checked === true;
                      setConsent(value);
                      if (value) setConsentError(false);
                    }}
                    className="mt-1 shrink-0"
                    data-testid="checkbox-consent"
                  />
                  <label htmlFor="consent" className="text-sm text-muted-foreground leading-relaxed cursor-pointer">
                    {t('onboarding.consent.pre')}{' '}
                    <Link href="/terms" className="text-secondary font-medium hover:underline" data-testid="link-consent-terms">
                      {t('onboarding.consent.terms')}
                    </Link>{' '}
                    {t('onboarding.consent.and')}{' '}
                    <Link href="/privacy" className="text-secondary font-medium hover:underline" data-testid="link-consent-privacy">
                      {t('onboarding.consent.privacy')}
                    </Link>
                  </label>
                </div>
                {consentError && (
                  <p className="text-sm text-destructive" data-testid="text-consent-error">{t('onboarding.consent.required')}</p>
                )}
              </div>

              <Button type="submit" className="w-full font-bold glow-green hover:brightness-110 transition-all py-6 text-lg" disabled={updateProfile.isPending} data-testid="button-submit-onboarding">
                {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('onboarding.submit')}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
