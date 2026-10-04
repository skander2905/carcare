import { api } from '@/lib/api/client';
import { type Completion, type Reminder, type ReminderInput } from './types';

export const remindersApi = {
  list: (vehicleId: string) => api.get<Reminder[]>(`/vehicles/${vehicleId}/reminders`),

  create: (vehicleId: string, input: ReminderInput) =>
    api.post<Reminder>(`/vehicles/${vehicleId}/reminders`, { body: input }),

  update: (id: string, input: Partial<ReminderInput>) =>
    api.patch<Reminder>(`/reminders/${id}`, { body: input }),

  complete: (id: string) => api.post<Completion>(`/reminders/${id}/complete`),

  remove: (id: string) => api.delete<void>(`/reminders/${id}`),
};

/** Under the vehicle's keys: a new mileage moves a km reminder's status, as it does a schedule's. */
export const reminderKeys = {
  all: (vehicleId: string) => ['vehicles', vehicleId, 'reminders'] as const,
};
