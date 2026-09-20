/** Mirrors the API's `VehicleResponse`. Money and engine size are strings. */
export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  vin: string | null;
  fuelType: FuelType;
  /** Litres, fixed to one decimal place, e.g. "1.6". */
  engineSize: string | null;
  transmission: Transmission | null;
  currentOdometerKm: number;
  purchaseDate: string | null;
  /** Fixed to three decimal places — TND has millimes. Never parse to a float. */
  purchasePrice: string | null;
  color: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export const FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'LPG', 'OTHER'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const TRANSMISSIONS = ['MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC', 'CVT'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export interface OdometerReading {
  id: string;
  odometerKm: number;
  recordedAt: string;
  source: 'MANUAL' | 'FUEL' | 'EXPENSE' | 'MAINTENANCE' | 'TRIP';
  sourceId: string | null;
  notes: string | null;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface CreateVehicleInput {
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  fuelType: FuelType;
  vin?: string;
  engineSize?: number;
  transmission?: Transmission;
  initialOdometerKm?: number;
  purchaseDate?: string;
  purchasePrice?: string;
  color?: string;
  notes?: string;
}

export type UpdateVehicleInput = Partial<Omit<CreateVehicleInput, 'initialOdometerKm'>> & {
  isArchived?: boolean;
};
