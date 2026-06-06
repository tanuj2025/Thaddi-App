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
          toast({ title: err.data?.error || t('join.error'), variant: 'destructive' });
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
      className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4"
      dir={dir}
    >
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <img src={`${basePath}/logo.svg`} alt="THADDI" className="h-9 mx-auto" />
        </div>

        <Card className="border-border shadow-xl">
          <CardContent className="p-6 space-y-5">
            {!isLoaded || isLoading ? (
              <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>{t('common.loading')}</span>
              </div>
            ) : isError || !preview ? (
              <div className="py-10 flex flex-col items-center text-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
                  <AlertCircle className="w-7 h-7 text-destructive" />
                </div>
                <p className="text-muted-foreground">{t('join.invalid')}</p>
              </div>
            ) : (
              <>
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                    <Swords className="w-7 h-7 text-primary" />
                  </div>
                  <p className="text-sm font-medium text-primary">{t('join.invitedTitle')}</p>
                  <h1 className="text-2xl font-bold">{preview.name}</h1>
                  {preview.ownerDisplayName && (
                    <p className="text-sm text-muted-foreground">
                      {t('join.hostedBy')}: {preview.ownerDisplayName}
                    </p>
                  )}
                </div>

                {preview.description && (
                  <p className="text-sm text-muted-foreground text-center">{preview.description}</p>
                )}

                <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    {preview.participantCount}
                    {preview.participantLimit ? `/${preview.participantLimit}` : ''}
                  </span>
                  {preview.prizes.length > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-500">
                      <Trophy className="w-4 h-4" />
                      {preview.prizes.length} {t('challenges.prizes')}
                    </span>
                  )}
                  <Badge variant="secondary">{t(`type.${preview.type}`)}</Badge>
                </div>

                {preview.alreadyJoined ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 text-primary text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      {t('join.alreadyIn')}
                    </div>
                    <Button className="w-full" onClick={goView} data-testid="button-view-challenge">
                      {t('join.viewChallenge')}
                    </Button>
                  </div>
                ) : preview.isFull ? (
                  <div className="flex items-center justify-center gap-2 text-destructive text-sm font-medium py-2">
                    <AlertCircle className="w-4 h-4" />
                    {t('join.full')}
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handlePrimary}
                    disabled={join.isPending}
                    data-testid="button-join"
                  >
                    {join.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                    {primaryLabel}
                  </Button>
                )}

                <div className="space-y-2 pt-1">
                  <p className="text-center text-xs text-muted-foreground">
                    {t('join.shareInvite')}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={copyLink}
                      data-testid="button-copy-link"
                    >
                      <Copy className="w-4 h-4 me-2" />
                      {t('detail.copyLink')}
                    </Button>
                    <Button
                      className="flex-1 bg-[#25D366] hover:bg-[#1da851] text-white"
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
