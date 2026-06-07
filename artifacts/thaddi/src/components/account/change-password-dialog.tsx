import React, { useState } from 'react';
import { useUser, useReverification } from '@clerk/react';
import { isReverificationCancelledError } from '@clerk/react/errors';
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

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, dir } = useI18n();
  const { user } = useUser();
  const { toast } = useToast();
  const { onNeedsReverification, reverificationDialog } = useReverificationGuard();

  const updatePassword = useReverification(
    (params: Parameters<NonNullable<typeof user>['updatePassword']>[0]) =>
      user!.updatePassword(params),
    { onNeedsReverification },
  );

  const hasPassword = Boolean(user?.passwordEnabled);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setPending(false);
  };

  const handleOpenChange = (open2: boolean) => {
    if (!open2) reset();
    onOpenChange(open2);
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (next.length < 8) {
      toast({ title: t('account.password.tooShort'), variant: 'destructive' });
      return;
    }
    if (next !== confirm) {
      toast({ title: t('account.password.mismatch'), variant: 'destructive' });
      return;
    }
    setPending(true);
    try {
      await updatePassword(
        hasPassword
          ? { currentPassword: current, newPassword: next }
          : { newPassword: next },
      );
      toast({
        title: hasPassword
          ? t('account.password.success')
          : t('account.password.setSuccess'),
      });
      handleOpenChange(false);
    } catch (err) {
      // User dismissed the reverification prompt — leave the dialog as-is.
      if (isReverificationCancelledError(err)) {
        setPending(false);
        return;
      }
      toast({
        title: t('account.changeError'),
        description: clerkErrorMessage(err, t('account.changeError')),
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
          <DialogTitle>
            {hasPassword
              ? t('account.password.changeTitle')
              : t('account.password.setTitle')}
          </DialogTitle>
          {!hasPassword && (
            <DialogDescription>{t('account.password.setDesc')}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {hasPassword && (
            <div className="space-y-2">
              <Label htmlFor="current-password">{t('account.password.current')}</Label>
              <Input
                id="current-password"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                data-testid="input-current-password"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="new-password">{t('account.password.new')}</Label>
            <Input
              id="new-password"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t('account.password.confirm')}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="input-confirm-password"
            />
          </div>
          <Button
            className="w-full font-bold"
            onClick={handleSubmit}
            disabled={pending}
            data-testid="button-submit-password"
          >
            {pending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {hasPassword
              ? t('account.password.submit')
              : t('account.password.setSubmit')}
          </Button>
        </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
