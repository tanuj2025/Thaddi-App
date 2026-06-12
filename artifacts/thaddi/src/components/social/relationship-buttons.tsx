import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../lib/i18n';
import { Button } from '@/components/ui/button';
import { UserPlus, UserCheck, UserMinus, Clock, Check, X } from 'lucide-react';
import {
  useFollowUser,
  useUnfollowUser,
  useSendFriendRequest,
  useCancelFriendRequest,
  useRemoveFriend,
  useRespondFriendRequest,
  getGetPlayerProfileQueryKey,
  getGetMySocialQueryKey,
} from '@workspace/api-client-react';
import type { ViewerRelationship } from '@workspace/api-client-react';

export function useInvalidateSocial() {
  const qc = useQueryClient();
  return React.useCallback(
    (userId?: string) => {
      if (userId) {
        qc.invalidateQueries({ queryKey: getGetPlayerProfileQueryKey(userId) });
      }
      qc.invalidateQueries({ queryKey: getGetMySocialQueryKey() });
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            typeof k === 'string' &&
            (k.includes('/followers') || k.includes('/following'))
          );
        },
      });
    },
    [qc],
  );
}

export function RelationshipButtons({
  userId,
  viewer,
  size = 'default',
  className,
}: {
  userId: string;
  viewer: ViewerRelationship;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const { t } = useI18n();
  const invalidate = useInvalidateSocial();
  const onChanged = () => invalidate(userId);

  const follow = useFollowUser({ mutation: { onSuccess: onChanged } });
  const unfollow = useUnfollowUser({ mutation: { onSuccess: onChanged } });
  const sendReq = useSendFriendRequest({ mutation: { onSuccess: onChanged } });
  const cancelReq = useCancelFriendRequest({ mutation: { onSuccess: onChanged } });
  const removeFr = useRemoveFriend({ mutation: { onSuccess: onChanged } });
  const respond = useRespondFriendRequest({ mutation: { onSuccess: onChanged } });

  if (viewer.isSelf) return null;

  const busy =
    follow.isPending ||
    unfollow.isPending ||
    sendReq.isPending ||
    cancelReq.isPending ||
    removeFr.isPending ||
    respond.isPending;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      {viewer.isFollowing ? (
        <Button
          variant="outline"
          size={size}
          disabled={busy}
          onClick={() => unfollow.mutate({ id: userId })}
          data-testid="button-unfollow"
        >
          <UserCheck className="w-4 h-4 me-1.5" />
          {t('social.followingState')}
        </Button>
      ) : (
        <Button
          size={size}
          disabled={busy}
          onClick={() => follow.mutate({ id: userId })}
          data-testid="button-follow"
        >
          <UserPlus className="w-4 h-4 me-1.5" />
          {t('social.follow')}
        </Button>
      )}

      {viewer.friendStatus === 'friends' && (
        <Button
          variant="outline"
          size={size}
          disabled={busy}
          onClick={() => removeFr.mutate({ id: userId })}
          data-testid="button-remove-friend"
        >
          <UserMinus className="w-4 h-4 me-1.5" />
          {t('social.removeFriend')}
        </Button>
      )}

      {viewer.friendStatus === 'none' && (
        <Button
          variant="secondary"
          size={size}
          disabled={busy}
          onClick={() => sendReq.mutate({ id: userId })}
          data-testid="button-add-friend"
        >
          <UserPlus className="w-4 h-4 me-1.5" />
          {t('social.addFriend')}
        </Button>
      )}

      {viewer.friendStatus === 'request_sent' && (
        <Button
          variant="outline"
          size={size}
          disabled={busy}
          onClick={() => cancelReq.mutate({ id: userId })}
          data-testid="button-cancel-request"
        >
          <Clock className="w-4 h-4 me-1.5" />
          {t('social.cancelRequest')}
        </Button>
      )}

      {viewer.friendStatus === 'request_received' && viewer.incomingRequestId && (
        <>
          <Button
            variant="secondary"
            size={size}
            disabled={busy}
            onClick={() =>
              respond.mutate({
                requestId: viewer.incomingRequestId!,
                data: { accept: true },
              })
            }
            data-testid="button-accept-request"
          >
            <Check className="w-4 h-4 me-1.5" />
            {t('social.accept')}
          </Button>
          <Button
            variant="outline"
            size={size}
            disabled={busy}
            onClick={() =>
              respond.mutate({
                requestId: viewer.incomingRequestId!,
                data: { accept: false },
              })
            }
            data-testid="button-decline-request"
          >
            <X className="w-4 h-4 me-1.5" />
            {t('social.decline')}
          </Button>
        </>
      )}
    </div>
  );
}
