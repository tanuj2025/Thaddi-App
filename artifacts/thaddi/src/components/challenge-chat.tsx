import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { localeOf } from '../lib/matchUtils';
import {
  useGetChallengeMessages,
  usePostChallengeMessage,
  useDeleteChallengeMessage,
  getChallengeMessages,
  getGetChallengeMessagesQueryKey,
} from '@workspace/api-client-react';
import type { ChallengeMessage } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { MessagesSquare, Send, Smile, Trash2, Loader2, ChevronUp } from 'lucide-react';

const PAGE = 50;
const MAX_LENGTH = 1000;
const POLL_MS = 15000;

const EMOJIS = [
  '😀', '😂', '😍', '😎', '🤩', '😅', '😉', '😢', '😡', '🤔',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '🎉', '⚽', '🏆',
  '🥅', '🎯', '💯', '❤️', '💔', '😱', '😭', '🤯', '🥳', '😤',
];

export function ChallengeChat({ challengeId }: { challengeId: string }) {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetChallengeMessages(challengeId, undefined, {
    query: {
      queryKey: getGetChallengeMessagesQueryKey(challengeId),
      refetchInterval: () => (document.hidden ? false : POLL_MS),
      refetchIntervalInBackground: false,
    },
  });

  const post = usePostChallengeMessage();
  const del = useDeleteChallengeMessage();

  const [older, setOlder] = useState<ChallengeMessage[]>([]);
  const [olderHasMore, setOlderHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [body, setBody] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);

  const latest = useMemo(() => data?.messages ?? [], [data]);
  const canPost = data?.canPost ?? false;

  const messages = useMemo(() => {
    const seen = new Set<string>();
    const merged: ChallengeMessage[] = [];
    for (const m of [...older, ...latest]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
    merged.sort((a, b) => {
      const d = a.createdAt.localeCompare(b.createdAt);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
    return merged;
  }, [older, latest]);

  const hasMoreOlder = older.length > 0 ? olderHasMore : (data?.hasMore ?? false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastIdRef = useRef<string | null>(null);

  // Auto-scroll to bottom only when a new message lands at the bottom (not when
  // older history is prepended).
  useEffect(() => {
    const lastId = messages.length ? messages[messages.length - 1].id : null;
    if (lastId && lastId !== lastIdRef.current) {
      const isFirst = lastIdRef.current === null;
      lastIdRef.current = lastId;
      const el = scrollRef.current;
      if (el) {
        const nearBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        if (isFirst || nearBottom) {
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
          });
        }
      }
    }
  }, [messages]);

  const loadOlder = async () => {
    const oldestId = messages[0]?.id;
    if (!oldestId || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const r = await getChallengeMessages(challengeId, { before: oldestId, limit: PAGE });
      setOlder((prev) => [...r.messages, ...prev]);
      setOlderHasMore(r.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      toast({ title: t('chat.loadError'), variant: 'destructive' });
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = () => {
    const trimmed = body.trim();
    if (!trimmed || post.isPending) return;
    post.mutate(
      { id: challengeId, data: { body: trimmed } },
      {
        onSuccess: () => {
          setBody('');
          lastIdRef.current = null; // force scroll to bottom on next render
          queryClient.invalidateQueries({ queryKey: getGetChallengeMessagesQueryKey(challengeId) });
        },
        onError: (err) =>
          toast({ title: err.data?.error || t('chat.sendError'), variant: 'destructive' }),
      },
    );
  };

  const doDelete = (messageId: string) => {
    del.mutate(
      { id: challengeId, messageId },
      {
        onSuccess: () => {
          setOlder((prev) => prev.filter((m) => m.id !== messageId));
          queryClient.invalidateQueries({ queryKey: getGetChallengeMessagesQueryKey(challengeId) });
          toast({ title: t('chat.deleted') });
        },
        onError: (err) =>
          toast({ title: err.data?.error || t('chat.deleteError'), variant: 'destructive' }),
      },
    );
  };

  const insertEmoji = (emoji: string) => {
    setBody((b) => (b.length >= MAX_LENGTH ? b : b + emoji));
    setEmojiOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(localeOf(lang), {
        hour: 'numeric',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      }),
    [lang],
  );

  return (
    <Card className="card-premium">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MessagesSquare className="w-5 h-5 text-primary" />
          {t('chat.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          ref={scrollRef}
          className="h-80 overflow-y-auto rounded-lg border border-border/50 bg-background/30 p-3 space-y-3"
          data-testid="chat-scroll"
        >
          {hasMoreOlder && (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadOlder}
                disabled={loadingOlder}
                data-testid="button-load-older"
                className="text-xs text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                {loadingOlder ? (
                  <Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5 me-1.5" />
                )}
                {t('chat.loadOlder')}
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <MessagesSquare className="w-8 h-8 opacity-40" />
              <p className="text-sm">{t('chat.empty')}</p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className="group flex items-start gap-2.5"
                data-testid={`chat-message-${m.id}`}
              >
                <Avatar className="w-8 h-8 border border-primary/20 shrink-0 mt-0.5">
                  <AvatarImage src={m.author.avatarUrl || ''} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {m.author.displayName?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">
                      {m.isOwnMessage ? t('chat.you') : m.author.displayName || '—'}
                    </span>
                    <span className="text-[11px] text-muted-foreground" dir="ltr">
                      {timeFmt.format(new Date(m.createdAt))}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words mt-0.5">
                    {m.body}
                  </p>
                </div>
                {m.canDelete && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-delete-message-${m.id}`}
                        aria-label={t('chat.deleteMessage')}
                        className="h-7 w-7 shrink-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-card border-border/50">
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('chat.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('chat.deleteConfirmBody')}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-border/50 hover:bg-muted/50">
                          {t('common.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => doDelete(m.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t('chat.deleteMessage')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            ))
          )}
        </div>

        {canPost ? (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t('chat.emoji')}
                    data-testid="button-emoji"
                    className="shrink-0 border-secondary/30 text-secondary hover:bg-secondary/10 hover:text-secondary"
                  >
                    <Smile className="w-4 h-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2 bg-card border-border/50">
                  <div className="grid grid-cols-6 gap-1">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => insertEmoji(e)}
                        data-testid={`emoji-${e}`}
                        className="text-xl rounded-md p-1 hover:bg-primary/10 transition-colors"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, MAX_LENGTH))}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={MAX_LENGTH}
                placeholder={t('chat.placeholder')}
                data-testid="input-chat-message"
                className="flex-1 resize-none bg-background/50 focus-visible:ring-primary"
              />
              <Button
                onClick={send}
                disabled={!body.trim() || post.isPending}
                data-testid="button-send-message"
                aria-label={t('chat.send')}
                className="shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {post.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 rtl:rotate-180" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/50 bg-background/30 p-4 text-center text-sm text-muted-foreground">
            {t('chat.joinToChat')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
