'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { notificationKeys, notificationsApi } from '@/lib/notifications/notifications-api';
import { type AppNotification } from '@/lib/notifications/types';

/** Opening a notification reads it and goes where it can be dealt with. */
export function useOpenNotification() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });

  return (notification: AppNotification) => {
    if (!notification.readAt) markRead.mutate(notification.id);
    router.push(notification.path);
  };
}
