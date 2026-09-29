import { api } from '@/lib/api/client';
import { type Paginated } from '@/lib/vehicles/types';
import {
  type Consumption,
  type CreateFuelInput,
  type FuelEntry,
  type FuelFilters,
  type FuelSuggestions,
  type UpdateFuelInput,
} from './types';

export const fuelApi = {
  list: (vehicleId: string, filters: FuelFilters = {}) =>
    api.get<Paginated<FuelEntry>>(`/vehicles/${vehicleId}/fuel`, { query: { ...filters } }),

  /** As with expenses, the key makes a retry of the same fill-up replay rather than duplicate. */
  create: (vehicleId: string, input: CreateFuelInput, idempotencyKey?: string) =>
    api.post<FuelEntry>(`/vehicles/${vehicleId}/fuel`, {
      body: input,
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    }),

  update: (id: string, input: UpdateFuelInput) => api.patch<FuelEntry>(`/fuel/${id}`, { body: input }),

  remove: (id: string) => api.delete<void>(`/fuel/${id}`),

  consumption: (vehicleId: string, range: { from?: string; to?: string } = {}) =>
    api.get<Consumption>(`/vehicles/${vehicleId}/analytics/consumption`, { query: { ...range } }),

  /** Coordinates are sent only to match stations this vehicle already logged; nothing is stored. */
  suggestions: (vehicleId: string, position?: { latitude: number; longitude: number }) =>
    api.get<FuelSuggestions>(`/vehicles/${vehicleId}/fuel/suggestions`, {
      query: position ? { lat: position.latitude, lng: position.longitude } : {},
    }),
};

/** Under the vehicle's keys, so any vehicle-wide invalidation reaches fuel too. */
export const fuelKeys = {
  all: (vehicleId: string) => ['vehicles', vehicleId, 'fuel'] as const,
  list: (vehicleId: string, filters: FuelFilters) =>
    ['vehicles', vehicleId, 'fuel', 'list', filters] as const,
  consumption: (vehicleId: string, range: { from?: string; to?: string }) =>
    ['vehicles', vehicleId, 'fuel', 'consumption', range] as const,
  suggestions: (vehicleId: string, position: { latitude: number; longitude: number } | null) =>
    ['vehicles', vehicleId, 'fuel', 'suggestions', position] as const,
};
