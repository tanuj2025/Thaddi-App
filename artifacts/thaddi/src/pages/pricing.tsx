import React from 'react';
import { useI18n } from '../lib/i18n';
import { Layout } from '../components/layout';
import {
  useGetPlans,
  useGetMySubscription,
  useGetSubscriptionHistory,
  useCreateSubscriptionCheckout,
  useMoyasarCallback,
  getGetMySubscriptionQueryKey,
  getGetSubscriptionHistoryQueryKey,
  getGetMeQueryKey,
  type Plan,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Check, Crown, Sparkles, Star } from 'lucide-react';

const PLAN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  free: Star,
  professional: Sparkles,
  legend: Crown,
  business: Crown,
};

function planFeatures(plan: Plan, t: (k: string) => string): string[] {
  const features: string[] = [];
  if (plan.participantLimit != null) {
    features.push(t('pricing.feat.participants').replace('{n}', String(plan.participantLimit)));
  }
  const has = (key: string) => plan.entitlements.some((e) => e.key === key && e.value === 'true');
  if (has('advanced_stats')) features.push(t('pricing.feat.advancedStats'));
  if (has('custom_prizes')) features.push(t('pricing.feat.customPrizes'));
  if (has('priority_support')) features.push(t('pricing.feat.prioritySupport'));
  return features;
}

export default function PricingPage() {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: plans } = useGetPlans();
  const { data: current } = useGetMySubscription();
  const { data: history } = useGetSubscriptionHistory();
  const checkout = useCreateSubscriptionCheckout();
  const callback = useMoyasarCallback();

  const verifiedRef = React.useRef(false);

  // Handle the return from Moyasar's hosted payment page. Moyasar redirects back
  // to our callbackUrl with the payment `id` in the query string; we verify it
  // server-side and refresh the user's subscription state.
  React.useEffect(() => {
    if (verifiedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const paymentId = params.get('id') || params.get('payment_id');
    if (!paymentId) return;
    verifiedRef.current = true;

    callback.mutate(
      { data: { paymentId } },
      {
        onSettled: (result) => {
          if (result?.activated) {
            toast({ title: t('pricing.paymentSuccess') });
          } else {
            toast({ title: t('pricing.paymentPending'), variant: 'destructive' });
          }
          queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSubscriptionHistoryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          // Clean the query string so a refresh doesn't re-verify.
          const base = import.meta.env.BASE_URL.replace(/\/$/, '');
          window.history.replaceState({}, '', `${base}/pricing`);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCheckout = (plan: Plan) => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const callbackUrl = `${window.location.origin}${base}/pricing`;
    checkout.mutate(
      { data: { planCode: plan.code as 'professional' | 'legend', callbackUrl } },
      {
        onSuccess: (result) => {
          if (result.transactionUrl) {
            toast({ title: t('pricing.processing') });
            window.location.href = result.transactionUrl;
          } else {
            toast({ title: t('pricing.checkoutError'), variant: 'destructive' });
          }
        },
        onError: (err: any) => {
          const msg = err?.status === 503 ? t('pricing.notConfigured') : t('pricing.checkoutError');
          toast({ title: msg, description: err?.data?.error, variant: 'destructive' });
        },
      },
    );
  };

  const sorted = (plans ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{t('pricing.title')}</h1>
          <p className="text-muted-foreground">{t('pricing.subtitle')}</p>
        </div>

        {callback.isPending && (
          <p className="text-center text-muted-foreground">{t('pricing.verifying')}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {sorted.map((plan) => {
            const Icon = PLAN_ICONS[plan.code] ?? Star;
            const isCurrent = current?.planCode === plan.code && current?.status === 'active';
            const isFree = Number(plan.priceSar) <= 0;
            const isHighlighted = plan.code === 'professional';
            const features = planFeatures(plan, t);

            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col ${isHighlighted ? 'border-primary shadow-lg ring-1 ring-primary/20' : ''}`}
                data-testid={`plan-${plan.code}`}
              >
                {isHighlighted && (
                  <span className="absolute -top-3 inset-x-0 mx-auto w-fit rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                    {t('pricing.mostPopular')}
                  </span>
                )}
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Icon className="w-6 h-6" />
                  </div>
                  <CardTitle className="text-xl">{lang === 'ar' ? plan.nameAr : plan.nameEn}</CardTitle>
                  <div className="mt-2">
                    {plan.isComingSoon ? (
                      <span className="text-2xl font-black">{t('pricing.business.price')}</span>
                    ) : (
                      <>
                        <span className="text-3xl font-black">
                          {Number(plan.priceSar).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}
                        </span>
                        <span className="text-sm text-muted-foreground"> {lang === 'ar' ? 'ريال' : 'SAR'}</span>
                        {!isFree && (
                          <p className="text-xs text-muted-foreground">{t('pricing.perEdition')}</p>
                        )}
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4 pt-4">
                  <ul className="flex-1 space-y-2 text-sm">
                    {features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button variant="outline" disabled className="w-full" data-testid={`button-current-${plan.code}`}>
                      {t('pricing.currentPlan')}
                    </Button>
                  ) : plan.isComingSoon ? (
                    <Button variant="outline" disabled className="w-full">
                      {t('pricing.business.price')}
                    </Button>
                  ) : isFree ? (
                    <Button variant="outline" disabled className="w-full">
                      {t('pricing.alreadyOwned')}
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={() => startCheckout(plan)}
                      disabled={checkout.isPending}
                      data-testid={`button-choose-${plan.code}`}
                    >
                      {t('pricing.choosePlan')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {history && history.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('pricing.history')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between border-b border-border last:border-0 py-2 text-sm"
                  data-testid={`subscription-${h.id}`}
                >
                  <span className="font-medium">{lang === 'ar' ? h.planNameAr : h.planNameEn}</span>
                  <span className="text-muted-foreground capitalize">{h.status}</span>
                  <span className="text-muted-foreground">
                    {new Date(h.startedAt).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US')}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
