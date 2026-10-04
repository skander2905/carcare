'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RemindersPanel } from '@/features/reminders/reminders-panel';
import { ApiError } from '@/lib/api/client';
import { vehicleTitle } from '@/lib/vehicles/format';
import { vehicleKeys, vehiclesApi } from '@/lib/vehicles/vehicles-api';

function VehicleReminders() {
  const { id } = useParams<{ id: string }>();
  // `?new=1` arrives from the vehicle page's "Add", and opens the form.
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
        <h1 className="text-2xl font-semibold tracking-tight">Reminders</h1>
        <p className="text-muted-foreground text-sm">
          Renewals and payments with a date or a mileage. Recurring services live under{' '}
          <Link href={`/vehicles/${id}/maintenance`} className="underline underline-offset-4">
            maintenance
          </Link>
          .
        </p>
      </div>

      {vehicle.data ? (
        <RemindersPanel
          vehicleId={id}
          currentOdometerKm={vehicle.data.currentOdometerKm}
          startAdding={startAdding}
        />
      ) : vehicle.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm font-medium">
            Could not load this vehicle
          </p>
          <Button variant="outline" size="sm" onClick={() => void vehicle.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </div>
  );
}

export default function VehicleRemindersPage() {
  // `useSearchParams` (for ?new=) needs a boundary, as on the maintenance page.
  return (
    <Suspense fallback={null}>
      <VehicleReminders />
    </Suspense>
  );
}
