import React, { useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { useLocation, useParams } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetInvitePreview,
  useGetMe,
  useJoinChallenge,
  getGetMeQueryKey,
  getGetMyChallengesQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Users, Trophy, Swords, AlertCircle, CheckCircle2, Copy, MessageCircle,
} from 'lucide-react';

const PENDING_KEY = 'thaddi_pending_join';
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function JoinPage() {
  const { t, lang, dir } = useI18n();
  const [, setLocation] = useLocation();
  const params = useParams();
  const code = params.code as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { isLoaded, isSignedIn } = useUser();
  const { data: preview, isLoading, isError } = useGetInvitePreview(code, {
    query: { queryKey: ['invitePreview', code] },
  });
  const { data: me } = useGetMe({
    query: { enabled: isSignedIn === true, queryKey: getGetMeQueryKey() },
  });
  const join = useJoinChallenge();

  const activated = me?.activated === true;

  // Clear pending flag once an activated, signed-in user has arrived here.
  useEffect(() => {
    if (isSignedIn && activated) {
      try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    }
  }, [isSignedIn, activated]);

  const goView = () => preview && setLocation(`/challenges/${preview.id}`);

  const inviteLink = `${window.location.origin}${basePath}/join/${code}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast({ title: t('detail.copied') });
    } catch {
      toast({ title: inviteLink });
    }
  };

  const shareWhatsApp = () => {
    const text = `${t('detail.shareMessage')} ${inviteLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handlePrimary = () => {
    if (!preview) return;
    if (!isSignedIn) {
      try { localStorage.setItem(PENDING_KEY, code); } catch { /* ignore */ }
      setLocation('/sign-up');
      return;
    }
    if (!activated) {
      try { localStorage.setItem(PENDING_KEY, code); } catch { /* ignore */ }
      setLocation('/home');
      return;
    }
    join.mutate(
      { id: preview.id, data: { viaCode: code } },
      {
        onSuccess: () => {
          try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
          queryClient.invalidateQueries({ queryKey: getGetMyChallengesQueryKey() });
          toast({ title: t('join.joined') });
          setLocation(`/challenges/${preview.id}`);
        },
        onError: (err) => {
          const poolFull = err.data?.code === 'owner_pool_full';
          toast({
            title: poolFull ? t('join.full') : err.data?.error || t('join.error'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const primaryLabel = !isSignedIn
    ? t('join.signUpToJoin')
    : !activated
      ? t('join.completeToJoin')
      : t('join.joinNow');

  return (
    <div
      className="min-h-[100dvh] bg-stadium flex flex-col items-center justify-center p-4 relative overflow-hidden"
      dir={dir}
    >
      {/* Decorative large logo watermark */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-5 pointer-events-none select-none">
        <Swords className="w-[120vw] h-[120vh] text-primary" />
      </div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center drop-shadow-xl">
          <img src={`${basePath}/logo.png`} alt="THADDI" className="h-24 md:h-28 mx-auto" />
        </div>

        <Card className="card-premium shadow-2xl border-primary/20 glow-gold">
          <CardContent className="p-8 space-y-6">
            {!isLoaded || isLoading ? (
              <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin text-secondary" />
                <span className="font-medium tracking-wide uppercase text-xs">{t('common.loading')}</span>
              </div>
            ) : isError || !preview ? (
              <div className="py-10 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center border border-destructive/20 shadow-[0_0_15px_rgba(var(--destructive)/0.2)]">
                  <AlertCircle className="w-8 h-8 text-destructive" />
                </div>
                <p className="text-muted-foreground font-medium">{t('join.invalid')}</p>
              </div>
            ) : (
              <>
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto border border-primary/20 shadow-[0_0_20px_rgba(var(--primary)/0.15)]">
                    <Swords className="w-8 h-8 text-primary" />
                  </div>
                  <p className="text-sm font-semibold text-secondary uppercase tracking-widest">{t('join.invitedTitle')}</p>
                  <h1 className="text-3xl font-bold tracking-tight text-gold-gradient">{preview.name}</h1>
                  {preview.ownerDisplayName && (
                    <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-primary/50"></span>
                      {t('join.hostedBy')} <span className="text-foreground font-medium">{preview.ownerDisplayName}</span>
                    </p>
                  )}
                </div>

                {preview.description && (
                  <div className="bg-background/40 border border-border/50 rounded-xl p-4">
                    <p className="text-sm text-foreground/90 text-center leading-relaxed">{preview.description}</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <span className="flex items-center gap-1.5 bg-background/50 border border-border/50 px-3 py-1.5 rounded-full text-sm font-medium">
                    <Users className="w-4 h-4 text-primary/70" />
                    {preview.participantCount}
                    {preview.participantLimit ? <span className="text-muted-foreground">/{preview.participantLimit}</span> : ''}
                  </span>
                  {preview.prizes.length > 0 && (
                    <span className="flex items-center gap-1.5 bg-secondary/10 border border-secondary/20 px-3 py-1.5 rounded-full text-sm font-medium text-secondary">
                      <Trophy className="w-4 h-4" />
                      {preview.prizes.length} {t('challenges.prizes')}
                    </span>
                  )}
                  <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5 px-3 py-1.5">{t(`type.${preview.type}`)}</Badge>
                </div>

                <div className="divider-gold h-px w-full opacity-30 my-6" />

                {preview.alreadyJoined ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-2 text-primary text-sm font-bold bg-primary/10 border border-primary/20 py-3 rounded-lg">
                      <CheckCircle2 className="w-5 h-5" />
                      {t('join.alreadyIn')}
                    </div>
                    <Button className="w-full glow-green h-12 text-lg font-bold" onClick={goView} data-testid="button-view-challenge">
                      {t('join.viewChallenge')}
                    </Button>
                  </div>
                ) : preview.status !== 'active' ? (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm font-bold bg-muted/30 border border-border/50 py-3 rounded-lg" data-testid="state-ended">
                    <AlertCircle className="w-5 h-5" />
                    {t('join.ended')}
                  </div>
                ) : preview.isFull ? (
                  <div className="flex items-center justify-center gap-2 text-destructive text-sm font-bold bg-destructive/10 border border-destructive/20 py-3 rounded-lg" data-testid="state-full">
                    <AlertCircle className="w-5 h-5" />
                    {t('join.full')}
                  </div>
                ) : (
                  <Button
                    className="w-full glow-green h-12 text-lg font-bold transition-all hover:scale-[1.02]"
                    size="lg"
                    onClick={handlePrimary}
                    disabled={join.isPending}
                    data-testid="button-join"
                  >
                    {join.isPending && <Loader2 className="w-5 h-5 me-2 animate-spin" />}
                    {primaryLabel}
                  </Button>
                )}

                <div className="space-y-3 pt-2">
                  <p className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                    {t('join.shareInvite')}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 border-secondary/30 hover:bg-secondary/10 hover:text-secondary transition-colors"
                      onClick={copyLink}
                      data-testid="button-copy-link"
                    >
                      <Copy className="w-4 h-4 me-2" />
                      {t('detail.copyLink')}
                    </Button>
                    <Button
                      className="flex-1 bg-[#25D366] hover:bg-[#1da851] text-white shadow-[0_0_15px_rgba(37,211,102,0.2)]"
                      onClick={shareWhatsApp}
                      data-testid="button-share-whatsapp"
                    >
                      <MessageCircle className="w-4 h-4 me-2" />
                      {t('detail.shareWhatsApp')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
