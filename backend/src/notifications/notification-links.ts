import { type NotificationType } from '../generated/prisma/enums.js';

/** The web app page that deals with a notification, as a path. Emails prefix the origin. */
export function notificationPath(type: NotificationType, data: unknown, vehicleId: string | null): string {
  const vehicle = vehicleId ?? (isRecord(data) && typeof data.vehicleId === 'string' ? data.vehicleId : null);
  if (!vehicle) return '/notifications';
  return type === 'REMINDER_DUE' ? `/vehicles/${vehicle}/reminders` : `/vehicles/${vehicle}/maintenance`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
