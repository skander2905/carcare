import { type FuelType } from '@/lib/vehicles/types';

/** One full-to-full window, as the API reports it. */
export interface ConsumptionWindow {
  /** L/100 km, two decimal places. */
  litresPer100Km: string;
  distanceKm: number;
  litres: string;
  cost: string;
  fillCount: number;
  startEntryId: string;
  endEntryId: string;
  startedAt: string;
  endedAt: string;
}

/** Mirrors the API's `FuelEntryResponse`. Figures are strings; never parse to floats for storage. */
export interface FuelEntry {
  id: string;
  vehicleId: string;
  /** The ledger row; receipts attach to it. */
  expenseId: string;
  filledAt: string;
  odometerKm: number;
  volumeLiters: string;
  pricePerLiter: string;
  totalCost: string;
  fuelType: FuelType;
  isFullTank: boolean;
  isMissedFill: boolean;
  stationName: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  /** Set on a full tank that closes a valid window. */
  consumption: ConsumptionWindow | null;
  attachmentCount: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FuelFilters {
  from?: string;
  to?: string;
  fuelType?: FuelType;
  station?: string;
  page?: number;
  limit?: number;
}

export interface CreateFuelInput {
  filledAt?: string;
  odometerKm: number;
  volumeLiters: string;
  totalCost: string;
  pricePerLiter?: string;
  fuelType?: FuelType;
  isFullTank?: boolean;
  isMissedFill?: boolean;
  stationName?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

export type UpdateFuelInput = Partial<
  Pick<
    CreateFuelInput,
    'filledAt' | 'odometerKm' | 'volumeLiters' | 'totalCost' | 'fuelType' | 'isFullTank' | 'isMissedFill'
  >
> & {
  pricePerLiter?: string | null;
  stationName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
};

export interface ConsumptionSummary {
  averageLitresPer100Km: string | null;
  measuredDistanceKm: number;
  costPerKm: string | null;
  windowCount: number;
  fillCount: number;
  totalLitres: string;
  totalCost: string;
  averagePricePerLiter: string | null;
}

export interface Consumption {
  summary: ConsumptionSummary;
  /** Oldest first. */
  windows: ConsumptionWindow[];
}

export interface FuelSuggestions {
  fuelType: FuelType;
  currentOdometerKm: number;
  lastFill: { filledAt: string; odometerKm: number } | null;
  lastPrices: Partial<Record<FuelType, string>>;
  nearbyStations: { name: string; distanceMeters: number }[];
  recentStations: string[];
  usualAmounts: string[];
}
