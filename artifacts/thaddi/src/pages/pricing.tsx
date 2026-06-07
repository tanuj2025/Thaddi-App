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

function planFeatures(plan: Plan, t: (k: string) => string, lang: string): string[] {
  const features: string[] = [];
  if (plan.participantLimit != null) {
    features.push(t('pricing.feat.participants').replace('{n}', String(plan.participantLimit)));
  }
  const has = (key: string) => plan.entitlements.some((e) => e.key === key && e.value === 'true');
  if (has('advanced_stats')) features.push(t('pricing.feat.advancedStats'));
  if (has('custom_prizes')) features.push(t('pricing.feat.customPrizes'));
  if (has('premium_features')) features.push(t('pricing.feat.premiumFeatures'));
  if (has('priority_support')) features.push(t('pricing.feat.prioritySupport'));
  // Admin-authored, display-only marketing bullets (not enforced).
  for (const f of plan.displayFeatures ?? []) {
    const text = lang === 'ar' ? f.ar : f.en;
    if (text && text.trim()) features.push(text);
  }
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
      { data: { planCode: plan.code, callbackUrl } },
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
  const activePlan = (plans ?? []).find(
    (p) => p.code === current?.planCode && current?.status === 'active',
  );
  const currentPrice = activePlan ? Number(activePlan.priceSar) : 0;
  const hasPaidPlan = currentPrice > 0;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-gold-gradient">{t('pricing.title')}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{t('pricing.subtitle')}</p>
        </div>

        {callback.isPending && (
          <p className="text-center text-muted-foreground">{t('pricing.verifying')}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {sorted.map((plan) => {
            const Icon = PLAN_ICONS[plan.code] ?? Star;
            const isCurrent = current?.planCode === plan.code && current?.status === 'active';
            const isFree = Number(plan.priceSar) <= 0;
            const isLowerTier = !isCurrent && !isFree && Number(plan.priceSar) <= currentPrice;
            const isUpgrade = !isCurrent && !isFree && Number(plan.priceSar) > currentPrice && hasPaidPlan;
            const isHighlighted = plan.code === 'professional';
            const features = planFeatures(plan, t, lang);

            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col transition-all duration-300 ${isHighlighted ? 'card-premium glow-gold ring-1 ring-secondary md:scale-105 z-10' : 'bg-card/40 backdrop-blur-sm border-border hover:border-primary/50'}`}
                data-testid={`plan-${plan.code}`}
              >
                {isHighlighted && (
                  <span className="absolute -top-4 inset-x-0 mx-auto w-fit rounded-full bg-secondary px-4 py-1.5 text-xs font-bold text-secondary-foreground shadow-lg">
                    {t('pricing.mostPopular')}
                  </span>
                )}
                <CardHeader className="text-center pb-4">
                  <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${isHighlighted ? 'bg-secondary/20 text-secondary ring-1 ring-secondary/50' : 'bg-primary/10 text-primary'}`}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <CardTitle className="text-2xl font-bold">{lang === 'ar' ? plan.nameAr : plan.nameEn}</CardTitle>
                  <div className="mt-4">
                    {plan.isComingSoon ? (
                      <span className="text-3xl font-black text-muted-foreground">{t('pricing.business.price')}</span>
                    ) : (
                      <>
                        <span className={`text-4xl font-black ${isHighlighted ? 'text-secondary' : 'text-foreground'}`}>
                          {Number(plan.priceSar).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}
                        </span>
                        <span className="text-sm text-muted-foreground ms-1">{lang === 'ar' ? 'ريال' : 'SAR'}</span>
                        {!isFree && (
                          <p className="text-xs text-muted-foreground mt-1">{t('pricing.perEdition')}</p>
                        )}
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-6 pt-4">
                  <div className="divider-gold h-px w-full opacity-50" />
                  <ul className="flex-1 space-y-3 text-sm">
                    {features.map((f, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className={`mt-0.5 shrink-0 rounded-full p-0.5 ${isHighlighted ? 'bg-secondary/20 text-secondary' : 'bg-primary/20 text-primary'}`}>
                          <Check className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-muted-foreground/90 font-medium">{f}</span>
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button variant="outline" disabled className="w-full font-bold bg-primary/10 text-primary border-primary/20" data-testid={`button-current-${plan.code}`}>
                      {t('pricing.currentPlan')}
                    </Button>
                  ) : plan.isComingSoon ? (
                    <Button variant="outline" disabled className="w-full font-bold opacity-50">
                      {t('pricing.business.price')}
                    </Button>
                  ) : isFree ? (
                    <Button variant="outline" disabled className="w-full font-bold">
                      {t('pricing.alreadyOwned')}
                    </Button>
                  ) : isLowerTier ? (
                    <Button variant="outline" disabled className="w-full font-bold opacity-60" data-testid={`button-lower-${plan.code}`}>
                      {t('pricing.lowerPlan')}
                    </Button>
                  ) : (
                    <Button
                      className={`w-full font-bold transition-all py-6 text-lg ${isHighlighted ? 'glow-green hover:brightness-110' : 'bg-secondary text-secondary-foreground hover:bg-secondary/90'}`}
                      onClick={() => startCheckout(plan)}
                      disabled={checkout.isPending}
                      data-testid={`button-choose-${plan.code}`}
                    >
                      {isUpgrade ? t('pricing.upgrade') : t('pricing.choosePlan')}
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
