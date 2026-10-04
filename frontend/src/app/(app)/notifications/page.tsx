'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChoiceChip } from '@/features/fuel/choice-chip';
import { NotificationItem } from '@/features/notifications/notification-item';
import { useOpenNotification } from '@/features/notifications/use-open-notification';
import { notificationKeys, notificationsApi } from '@/lib/notifications/notifications-api';

const LIMIT = 20;

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const openNotification = useOpenNotification();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const query = { unreadOnly, page, limit: LIMIT };
  const list = useQuery({
    queryKey: notificationKeys.list(query),
    queryFn: () => notificationsApi.list(query),
  });
  const unread = useQuery({ queryKey: notificationKeys.unreadCount, queryFn: notificationsApi.unreadCount });

  const readAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });

  const filter = (only: boolean) => {
    setUnreadOnly(only);
    setPage(1);
  };

  const count = unread.data?.count ?? 0;
  const items = list.data?.data ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground text-sm">
            Services and reminders as they come due.{' '}
            <Link href="/settings" className="underline underline-offset-4">
              Email settings
            </Link>
          </p>
        </div>
        {count > 0 ? (
          <Button variant="outline" size="sm" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
            Mark all read
          </Button>
        ) : null}
      </div>

      <div className="flex gap-2">
        <ChoiceChip selected={!unreadOnly} onClick={() => filter(false)}>
          All
        </ChoiceChip>
        <ChoiceChip selected={unreadOnly} onClick={() => filter(true)}>
          Unread{count > 0 ? ` · ${count}` : ''}
        </ChoiceChip>
      </div>

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : list.isError ? (
            <div className="space-y-2 p-4">
              <p role="alert" className="text-sm font-medium">
                Could not load notifications
              </p>
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length ? (
            <ul className="divide-border divide-y">
              {items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    className="hover:bg-muted/50 focus-visible:bg-muted/50 w-full px-4 py-3 outline-none"
                    onClick={() => openNotification(notification)}
                  >
                    <NotificationItem notification={notification} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground p-6 text-center text-sm">
              {unreadOnly
                ? 'All caught up.'
                : 'Nothing yet. Add maintenance schedules or reminders to a car, and you will hear about them here when they come due.'}
            </p>
          )}
        </CardContent>
      </Card>

      {list.data && list.data.meta.totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {page} of {list.data.meta.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!list.data.meta.hasNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
