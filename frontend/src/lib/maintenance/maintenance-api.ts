import { api } from '@/lib/api/client';
import { type Paginated } from '@/lib/vehicles/types';
import {
  type CreateRecordInput,
  type MaintenanceFilters,
  type MaintenanceRecord,
  type MaintenanceSuggestions,
  type Schedule,
  type ScheduleInput,
  type UpdateRecordInput,
} from './types';

export const maintenanceApi = {
  list: (vehicleId: string, filters: MaintenanceFilters = {}) =>
    api.get<Paginated<MaintenanceRecord>>(`/vehicles/${vehicleId}/maintenance`, { query: { ...filters } }),

  /** As with fill-ups, the key makes a retry replay rather than log the service twice. */
  create: (vehicleId: string, input: CreateRecordInput, idempotencyKey?: string) =>
    api.post<MaintenanceRecord>(`/vehicles/${vehicleId}/maintenance`, {
      body: input,
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    }),

  update: (id: string, input: UpdateRecordInput) =>
    api.patch<MaintenanceRecord>(`/maintenance/${id}`, { body: input }),

  remove: (id: string) => api.delete<void>(`/maintenance/${id}`),

  suggestions: (vehicleId: string) =>
    api.get<MaintenanceSuggestions>(`/vehicles/${vehicleId}/maintenance/suggestions`),

  schedules: (vehicleId: string) => api.get<Schedule[]>(`/vehicles/${vehicleId}/maintenance-schedules`),

  createSchedule: (vehicleId: string, input: ScheduleInput) =>
    api.post<Schedule>(`/vehicles/${vehicleId}/maintenance-schedules`, { body: input }),

  updateSchedule: (id: string, input: Partial<ScheduleInput>) =>
    api.patch<Schedule>(`/maintenance-schedules/${id}`, { body: input }),

  removeSchedule: (id: string) => api.delete<void>(`/maintenance-schedules/${id}`),
};

/**
 * Under the vehicle's keys, so any vehicle-wide invalidation reaches
 * maintenance too — which matters: a fill-up moves the mileage, and with it
 * every schedule's status.
 */
export const maintenanceKeys = {
  all: (vehicleId: string) => ['vehicles', vehicleId, 'maintenance'] as const,
  list: (vehicleId: string, filters: MaintenanceFilters) =>
    ['vehicles', vehicleId, 'maintenance', 'list', filters] as const,
  schedules: (vehicleId: string) => ['vehicles', vehicleId, 'maintenance', 'schedules'] as const,
  suggestions: (vehicleId: string) => ['vehicles', vehicleId, 'maintenance', 'suggestions'] as const,
};
