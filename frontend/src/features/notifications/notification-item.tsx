import { AlertTriangle, Bell, Clock } from 'lucide-react';
import { timeAgo } from '@/lib/notifications/format';
import { type AppNotification } from '@/lib/notifications/types';
import { cn } from '@/lib/utils';

/** Icon by urgency, and the words say it too. */
function UrgencyIcon({ status }: { status: AppNotification['data']['status'] }) {
  if (status === 'OVERDUE') return <AlertTriangle className="text-destructive size-4" aria-hidden />;
  if (status === 'DUE') return <Bell className="text-warning size-4" aria-hidden />;
  return <Clock className="text-muted-foreground size-4" aria-hidden />;
}

/** One notification's content; the caller makes it a menu item or a list button. */
export function NotificationItem({ notification }: { notification: AppNotification }) {
  const unread = notification.readAt === null;
  return (
    <div className="flex w-full items-start gap-3 text-left">
      <span className="mt-0.5 shrink-0">
        <UrgencyIcon status={notification.data.status} />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className={cn('block text-sm leading-snug', unread ? 'font-medium' : 'text-muted-foreground')}>
          {notification.title}
        </span>
        <span className="text-muted-foreground block text-xs">
          {notification.body} · {timeAgo(notification.createdAt)}
        </span>
      </span>
      {unread ? (
        <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full">
          <span className="sr-only">Unread</span>
        </span>
      ) : null}
    </div>
  );
}
