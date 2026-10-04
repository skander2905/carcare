import { api } from '@/lib/api/client';
import { type Paginated } from '@/lib/vehicles/types';
import { type AppNotification } from './types';

export const notificationsApi = {
  list: (query: { unreadOnly?: boolean; page?: number; limit?: number } = {}) =>
    api.get<Paginated<AppNotification>>('/notifications', { query }),

  unreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) => api.patch<AppNotification>(`/notifications/${id}/read`),

  markAllRead: () => api.post<{ updated: number }>('/notifications/read-all'),
};

export const notificationKeys = {
  all: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  list: (query: { unreadOnly?: boolean; page?: number; limit?: number }) =>
    ['notifications', 'list', query] as const,
};
