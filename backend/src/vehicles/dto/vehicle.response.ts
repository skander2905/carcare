import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { toDecimalString, toMoneyString } from '../../common/http/decimal.js';
import { type Vehicle } from '../../prisma/model.types.js';

export class VehicleResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Volkswagen' })
  make: string;

  @ApiProperty({ example: 'Golf' })
  model: string;

  @ApiProperty({ example: 2019 })
  year: number;

  @ApiProperty({ example: '123 TUN 4567' })
  licensePlate: string;

  @ApiPropertyOptional({ example: 'WVWZZZ1KZAW123456', nullable: true })
  vin: string | null;

  @ApiProperty({ example: 'DIESEL' })
  fuelType: string;

  @ApiPropertyOptional({ example: '1.6', nullable: true, description: 'Litres, as a decimal string.' })
  engineSize: string | null;

  @ApiPropertyOptional({ example: 'MANUAL', nullable: true })
  transmission: string | null;

  @ApiProperty({ example: 121500 })
  currentOdometerKm: number;

  @ApiPropertyOptional({ example: '2021-03-15T00:00:00.000Z', nullable: true })
  purchaseDate: string | null;

  @ApiPropertyOptional({ example: '38500.000', nullable: true })
  purchasePrice: string | null;

  @ApiPropertyOptional({ example: 'Deep Black Pearl', nullable: true })
  color: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes: string | null;

  @ApiPropertyOptional({ example: null, nullable: true, description: 'Set when archived.' })
  archivedAt: string | null;

  @ApiProperty()
  createdAt: string;
}

/**
 * Row to response, by hand.
 *
 * Money and engine size leave as fixed-width **strings**. Prisma hands back a
 * `Decimal`; serialising it as a JSON number would round 38500.000 TND through
 * a float, and `toString()` alone would drop the trailing millimes — so the
 * width varies by value. See common/http/decimal.ts.
 */
export function toVehicleResponse(vehicle: Vehicle): VehicleResponse {
  return {
    id: vehicle.id,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    licensePlate: vehicle.licensePlate,
    vin: vehicle.vin,
    fuelType: vehicle.fuelType,
    engineSize: toDecimalString(vehicle.engineSize, 1),
    transmission: vehicle.transmission,
    currentOdometerKm: vehicle.currentOdometerKm,
    purchaseDate: vehicle.purchaseDate?.toISOString() ?? null,
    purchasePrice: toMoneyString(vehicle.purchasePrice),
    color: vehicle.color,
    notes: vehicle.notes,
    archivedAt: vehicle.archivedAt?.toISOString() ?? null,
    createdAt: vehicle.createdAt.toISOString(),
  };
}
