'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExpenseLedger } from '@/features/expenses/expense-ledger';
import { ApiError } from '@/lib/api/client';
import { vehicleTitle } from '@/lib/vehicles/format';
import { vehicleKeys, vehiclesApi } from '@/lib/vehicles/vehicles-api';

export default function VehicleExpensesPage() {
  const { id } = useParams<{ id: string }>();
  // `?new=1` arrives from the vehicle page's "Add expense", and opens the form.
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
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        {vehicle.isLoading ? (
          <Skeleton className="h-5 w-48" />
        ) : vehicle.data ? (
          <p className="text-muted-foreground text-sm">
            Every cost for {vehicleTitle(vehicle.data)} · {vehicle.data.licensePlate}
          </p>
        ) : null}
      </div>

      <ExpenseLedger vehicleId={id} startAdding={startAdding} />
    </div>
  );
}
