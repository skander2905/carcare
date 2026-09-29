import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { toDecimalString, toMoneyString } from '../../common/http/decimal.js';
import { FuelType } from '../../generated/prisma/enums.js';
import { type ConsumptionWindow, litresPer100Km } from '../domain/consumption.js';
import { fromUnits } from '../domain/units.js';
import { type FuelConsumption, type FuelSuggestions } from '../fuel.service.js';
import { type FuelEntryWithAttachments } from '../fuel.repository.js';

/** Two places: finer than a tenth of a litre per hundred km is noise. */
const per100 = (value: number | null) => (value === null ? null : value.toFixed(2));

export class WindowResponse {
  @ApiProperty({ example: '6.85', description: 'L/100 km, two decimal places.' })
  litresPer100Km: string;

  @ApiProperty({ example: 612 })
  distanceKm: number;

  @ApiProperty({ example: '41.93', description: 'Every litre poured into the window.' })
  litres: string;

  @ApiProperty({ example: '105.873' })
  cost: string;

  @ApiProperty({ example: 2, description: 'Fills in the window, the closing one included.' })
  fillCount: number;

  @ApiProperty({ format: 'uuid' })
  startEntryId: string;

  @ApiProperty({ format: 'uuid' })
  endEntryId: string;

  @ApiProperty()
  startedAt: string;

  @ApiProperty()
  endedAt: string;
}

export function toWindowResponse(window: ConsumptionWindow): WindowResponse {
  return {
    litresPer100Km: per100(litresPer100Km(window))!,
    distanceKm: window.distanceKm,
    litres: fromUnits(window.centilitres, 2),
    cost: fromUnits(window.costMillimes, 3),
    fillCount: window.fillCount,
    startEntryId: window.startEntryId,
    endEntryId: window.endEntryId,
    startedAt: window.startedAt.toISOString(),
    endedAt: window.endedAt.toISOString(),
  };
}

export class FuelEntryResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  vehicleId: string;

  @ApiProperty({ format: 'uuid', description: 'The ledger row; receipts attach to it.' })
  expenseId: string;

  @ApiProperty()
  filledAt: string;

  @ApiProperty({ example: 121_480 })
  odometerKm: number;

  @ApiProperty({ example: '38.20' })
  volumeLiters: string;

  @ApiProperty({ example: '2.525' })
  pricePerLiter: string;

  @ApiProperty({ example: '96.455' })
  totalCost: string;

  @ApiProperty({ enum: FuelType })
  fuelType: FuelType;

  @ApiProperty()
  isFullTank: boolean;

  @ApiProperty()
  isMissedFill: boolean;

  @ApiPropertyOptional({ nullable: true })
  stationName: string | null;

  @ApiPropertyOptional({ nullable: true, example: 36.8442 })
  latitude: number | null;

  @ApiPropertyOptional({ nullable: true, example: 10.2425 })
  longitude: number | null;

  @ApiPropertyOptional({ nullable: true })
  notes: string | null;

  @ApiPropertyOptional({
    type: WindowResponse,
    nullable: true,
    description: 'Set on a full tank that closes a valid window; null when there is not enough data.',
  })
  consumption: WindowResponse | null;

  @ApiProperty({ example: 1 })
  attachmentCount: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  createdById: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export function toFuelEntryResponse(
  entry: FuelEntryWithAttachments,
  window: ConsumptionWindow | null = null,
): FuelEntryResponse {
  return {
    id: entry.id,
    vehicleId: entry.vehicleId,
    expenseId: entry.expenseId,
    filledAt: entry.filledAt.toISOString(),
    odometerKm: entry.odometerKm,
    volumeLiters: toDecimalString(entry.volumeLiters, 2)!,
    pricePerLiter: toMoneyString(entry.pricePerLiter)!,
    totalCost: toMoneyString(entry.totalCost)!,
    fuelType: entry.fuelType,
    isFullTank: entry.isFullTank,
    isMissedFill: entry.isMissedFill,
    stationName: entry.stationName,
    latitude: entry.latitude?.toNumber() ?? null,
    longitude: entry.longitude?.toNumber() ?? null,
    notes: entry.notes,
    consumption: window ? toWindowResponse(window) : null,
    attachmentCount: entry.expense._count.documents,
    createdById: entry.createdById,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export class ConsumptionSummaryResponse {
  @ApiPropertyOptional({
    nullable: true,
    example: '6.72',
    description: 'Σ litres ÷ Σ distance. Null: not enough data.',
  })
  averageLitresPer100Km: string | null;

  @ApiProperty({ example: 4_210, description: 'Kilometres covered by valid windows.' })
  measuredDistanceKm: number;

  @ApiPropertyOptional({
    nullable: true,
    example: '0.170',
    description: 'Fuel cost per km over the same windows.',
  })
  costPerKm: string | null;

  @ApiProperty({ example: 7 })
  windowCount: number;

  @ApiProperty({ example: 9, description: 'Every fill in the period, measured or not.' })
  fillCount: number;

  @ApiProperty({ example: '301.40' })
  totalLitres: string;

  @ApiProperty({ example: '761.035', description: 'Fuel spend in the period.' })
  totalCost: string;

  @ApiPropertyOptional({ nullable: true, example: '2.525', description: 'Volume-weighted.' })
  averagePricePerLiter: string | null;
}

export class ConsumptionResponse {
  @ApiProperty({ type: ConsumptionSummaryResponse })
  summary: ConsumptionSummaryResponse;

  @ApiProperty({ type: [WindowResponse], description: 'Oldest first, for a chart.' })
  windows: WindowResponse[];
}

export function toConsumptionResponse({ summary, windows, fills }: FuelConsumption): ConsumptionResponse {
  return {
    summary: {
      averageLitresPer100Km: per100(summary.averageLitresPer100Km),
      measuredDistanceKm: summary.measuredDistanceKm,
      // Millimes per km, rounded to the millime.
      costPerKm:
        summary.costMillimesPerKm === null ? null : fromUnits(Math.round(summary.costMillimesPerKm), 3),
      windowCount: summary.windowCount,
      fillCount: fills.count,
      totalLitres: fromUnits(fills.centilitres, 2),
      totalCost: fromUnits(fills.costMillimes, 3),
      averagePricePerLiter:
        fills.centilitres > 0
          ? fromUnits(Math.round((fills.costMillimes * 100) / fills.centilitres), 3)
          : null,
    },
    windows: windows.map(toWindowResponse),
  };
}

export class NearbyStationResponse {
  @ApiProperty({ example: 'Shell Lac 2' })
  name: string;

  @ApiProperty({ example: 42 })
  distanceMeters: number;
}

export class LastFillResponse {
  @ApiProperty()
  filledAt: string;

  @ApiProperty({ example: 121_480 })
  odometerKm: number;
}

export class OfficialGradeResponse {
  @ApiProperty({ example: 'Sans plomb' })
  grade: string;

  @ApiProperty({ example: '2.525' })
  pricePerLiter: string;
}

export class OfficialPricesResponse {
  @ApiProperty({ example: '2022-11-24' })
  effectiveFrom: string;

  @ApiProperty({ example: '2026-09-29', description: 'When the table was last confirmed current.' })
  verifiedAt: string;

  @ApiProperty()
  source: string;

  @ApiProperty({
    example: { PETROL: [{ grade: 'Sans plomb', pricePerLiter: '2.525' }] },
    description: "Per fuel type, the pump's usual grade first.",
  })
  prices: Partial<Record<string, OfficialGradeResponse[]>>;
}

export class FuelSuggestionsResponse {
  @ApiProperty({ enum: FuelType, description: "The vehicle's own fuel type." })
  fuelType: FuelType;

  @ApiProperty({ example: 121_480, description: 'Shown as a hint, never prefilled.' })
  currentOdometerKm: number;

  @ApiPropertyOptional({ type: LastFillResponse, nullable: true })
  lastFill: LastFillResponse | null;

  @ApiProperty({
    example: { PETROL: '2.525' },
    description: 'The last price paid per litre, by fuel type.',
    additionalProperties: { type: 'string' },
  })
  lastPrices: Partial<Record<FuelType, string>>;

  @ApiProperty({
    type: [NearbyStationResponse],
    description: 'Stations this vehicle filled at within 300 m.',
  })
  nearbyStations: NearbyStationResponse[];

  @ApiProperty({ type: [String], example: ['Shell Lac 2', 'Agil La Marsa'] })
  recentStations: string[];

  @ApiProperty({
    type: [String],
    example: ['50.000', '100.000'],
    description: 'Whole amounts paid at least twice.',
  })
  usualAmounts: string[];

  @ApiPropertyOptional({
    type: OfficialPricesResponse,
    nullable: true,
    description: 'State-set pump prices in force today; null where none apply.',
  })
  officialPrices: OfficialPricesResponse | null;
}

export function toSuggestionsResponse(suggestions: FuelSuggestions): FuelSuggestionsResponse {
  return {
    fuelType: suggestions.fuelType,
    currentOdometerKm: suggestions.currentOdometerKm,
    lastFill: suggestions.lastFill
      ? { filledAt: suggestions.lastFill.filledAt.toISOString(), odometerKm: suggestions.lastFill.odometerKm }
      : null,
    lastPrices: Object.fromEntries(
      Object.entries(suggestions.lastPrices).map(([type, millimes]) => [type, fromUnits(millimes, 3)]),
    ),
    nearbyStations: suggestions.nearbyStations,
    recentStations: suggestions.recentStations,
    usualAmounts: suggestions.usualAmountsMillimes.map((millimes) => fromUnits(millimes, 3)),
    officialPrices: suggestions.officialPrices
      ? {
          effectiveFrom: suggestions.officialPrices.effectiveFrom,
          verifiedAt: suggestions.officialPrices.verifiedAt,
          source: suggestions.officialPrices.source,
          prices: Object.fromEntries(
            Object.entries(suggestions.officialPrices.prices).map(([fuel, grades]) => [
              fuel,
              grades.map(({ grade, priceMillimes }) => ({
                grade,
                pricePerLiter: fromUnits(priceMillimes, 3),
              })),
            ]),
          ),
        }
      : null,
  };
}
