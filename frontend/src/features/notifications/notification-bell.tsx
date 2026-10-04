'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/features/auth/use-auth';
import { badgeCount } from '@/lib/notifications/format';
import { notificationKeys, notificationsApi } from '@/lib/notifications/notifications-api';
import { NotificationItem } from './notification-item';
import { useOpenNotification } from './use-open-notification';

const SHOWN = 5;
/** The sweep runs hourly; a minute is plenty, and the count is one index probe. */
const POLL_MS = 60_000;

/** The header's bell: how many are unread, and the latest few a click away. */
export function NotificationBell() {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const openNotification = useOpenNotification();

  const unread = useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: notificationsApi.unreadCount,
    enabled: signedIn,
    refetchInterval: POLL_MS,
  });

  const latest = useQuery({
    queryKey: notificationKeys.list({ limit: SHOWN }),
    queryFn: () => notificationsApi.list({ limit: SHOWN }),
    // Fetched when the menu opens, not on every page.
    enabled: signedIn && open,
  });

  const readAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });

  if (!signedIn) return null;

  const count = unread.data?.count ?? 0;
  const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={label}>
          <Bell className="size-4" aria-hidden />
          {count > 0 ? (
            <span
              className="bg-destructive text-destructive-foreground absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums leading-none"
              aria-hidden
            >
              {badgeCount(count)}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {count > 0 ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-xs"
              disabled={readAll.isPending}
              onClick={(event) => {
                // Keep the menu open: the list is what changes.
                event.preventDefault();
                readAll.mutate();
              }}
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {latest.isLoading ? (
          <p className="text-muted-foreground px-2 py-4 text-sm">Loading…</p>
        ) : latest.data?.data.length ? (
          latest.data.data.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              className="items-start py-2"
              onSelect={() => openNotification(notification)}
            >
              <NotificationItem notification={notification} />
            </DropdownMenuItem>
          ))
        ) : (
          <p className="text-muted-foreground px-2 py-4 text-sm">
            Nothing yet. When a service or a reminder comes due, it shows up here.
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications" className="justify-center text-sm">
            See all
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
