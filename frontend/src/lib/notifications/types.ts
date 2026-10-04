export type NotificationType = 'MAINTENANCE_DUE' | 'REMINDER_DUE';

/** Mirrors `NotificationResponse`. */
export interface AppNotification {
  id: string;
  type: NotificationType;
  vehicleId: string | null;
  title: string;
  body: string;
  /** Where in the app to deal with it. */
  path: string;
  data: { status?: 'DUE_SOON' | 'DUE' | 'OVERDUE' } & Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
