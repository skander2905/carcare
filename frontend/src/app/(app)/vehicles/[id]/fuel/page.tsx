'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConsumptionPanel } from '@/features/fuel/consumption-panel';
import { FuelLog } from '@/features/fuel/fuel-log';
import { ApiError } from '@/lib/api/client';
import { vehicleTitle } from '@/lib/vehicles/format';
import { vehicleKeys, vehiclesApi } from '@/lib/vehicles/vehicles-api';

function VehicleFuel() {
  const { id } = useParams<{ id: string }>();
  // `?new=1` arrives from the vehicle page's "Log a fill-up", and opens the form.
  const startAdding = useSearchParams().get('new') === '1';

  const vehicle = useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: () => vehiclesApi.get(id),
    retry: false,
  });

  // Same answer as the vehicle page: absent, or not yours, deliberately alike.
  if (vehicle.error instanceof ApiError && vehicle.error.status === 404) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold">Vehicle not found</h1>
        <p className="text-muted-foreground text-sm">
          It may have been deleted, or it belongs to someone else.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/vehicles">Back to vehicles</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/vehicles/${id}`}>
          <ArrowLeft className="size-4" aria-hidden />
          {vehicle.data ? vehicleTitle(vehicle.data) : 'Vehicle'}
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Fuel</h1>
        {vehicle.data ? (
          <p className="text-muted-foreground text-sm">
            Fill-ups and fuel economy for {vehicleTitle(vehicle.data)} · {vehicle.data.licensePlate}
          </p>
        ) : null}
      </div>

      {/* Waits for the vehicle: it names the currency and the fuel the car takes. */}
      {vehicle.data ? (
        <>
          <ConsumptionPanel vehicleId={id} currency={vehicle.data.currency} />
          <FuelLog
            vehicleId={id}
            vehicleFuelType={vehicle.data.fuelType}
            currency={vehicle.data.currency}
            startAdding={startAdding}
          />
        </>
      ) : vehicle.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm font-medium">
            Could not load this vehicle
          </p>
          <p className="text-muted-foreground text-sm">
            {vehicle.error instanceof Error ? vehicle.error.message : 'Something went wrong.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void vehicle.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
    </div>
  );
}

export default function VehicleFuelPage() {
  // `useSearchParams` (for ?new=) opts the tree into client rendering, so it
  // needs a boundary or the build fails on the prerender — as on /login.
  return (
    <Suspense fallback={null}>
      <VehicleFuel />
    </Suspense>
  );
}
