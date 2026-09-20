import { api } from '@/lib/api/client';
import {
  type CreateVehicleInput,
  type OdometerReading,
  type Paginated,
  type UpdateVehicleInput,
  type Vehicle,
} from './types';

export const vehiclesApi = {
  list: (includeArchived = false) => api.get<Vehicle[]>('/vehicles', { query: { includeArchived } }),

  get: (id: string) => api.get<Vehicle>(`/vehicles/${id}`),

  create: (input: CreateVehicleInput) => api.post<Vehicle>('/vehicles', { body: input }),

  update: (id: string, input: UpdateVehicleInput) => api.patch<Vehicle>(`/vehicles/${id}`, { body: input }),

  remove: (id: string) => api.delete<void>(`/vehicles/${id}`),

  readings: (vehicleId: string, page = 1, limit = 25) =>
    api.get<Paginated<OdometerReading>>(`/vehicles/${vehicleId}/odometer`, { query: { page, limit } }),

  recordReading: (vehicleId: string, body: { odometerKm: number; recordedAt?: string; notes?: string }) =>
    api.post<OdometerReading>(`/vehicles/${vehicleId}/odometer`, { body }),
};

/** Query keys in one place, so an invalidation cannot miss a cache. */
export const vehicleKeys = {
  all: ['vehicles'] as const,
  list: (includeArchived: boolean) => ['vehicles', 'list', includeArchived] as const,
  detail: (id: string) => ['vehicles', 'detail', id] as const,
  readings: (id: string, page: number) => ['vehicles', id, 'odometer', page] as const,
};
