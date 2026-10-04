import { api } from '@/lib/api/client';
import { type MileageContext } from './mileage-entry';

export const odometerApi = {
  context: (vehicleId: string, at: string, excludeSourceId?: string) =>
    api.get<MileageContext>(`/vehicles/${vehicleId}/odometer/context`, {
      query: { at, ...(excludeSourceId ? { excludeSourceId } : {}) },
    }),
};

/** Under the vehicle's keys, so any change to the car's readings refreshes it. */
export const odometerKeys = {
  context: (vehicleId: string, at: string, excludeSourceId?: string) =>
    ['vehicles', vehicleId, 'odometer', 'context', at, excludeSourceId ?? null] as const,
};
