'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Fuel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fuelApi, fuelKeys } from '@/lib/fuel/fuel-api';
import { type FuelFilters } from '@/lib/fuel/types';
import { FuelRow } from './fuel-log';

const LATEST: FuelFilters = { page: 1, limit: 1 };

/** The vehicle page's view of fuel: the all-time average, the last fill, and the way in. */
export function FuelSummaryCard({ vehicleId, currency }: { vehicleId: string; currency: string }) {
  const latest = useQuery({
    queryKey: fuelKeys.list(vehicleId, LATEST),
    queryFn: () => fuelApi.list(vehicleId, LATEST),
  });
  const consumption = useQuery({
    queryKey: fuelKeys.consumption(vehicleId, {}),
    queryFn: () => fuelApi.consumption(vehicleId),
  });

  const total = latest.data?.meta.total ?? 0;
  const average = consumption.data?.summary.averageLitresPer100Km;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fuel</CardTitle>
        <CardDescription>
          {average ? `Averaging ${average} L/100 km across ${total} fill-ups.` : 'Fill-ups and fuel economy.'}
        </CardDescription>
        <CardAction className="flex gap-2">
          {total > 0 ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/vehicles/${vehicleId}/fuel`}>View all</Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={`/vehicles/${vehicleId}/fuel?new=1`}>
              <Fuel className="size-3.5" aria-hidden />
              Log a fill-up
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {latest.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : latest.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-medium">
              Could not load fill-ups
            </p>
            <Button variant="outline" size="sm" onClick={() => void latest.refetch()}>
              Try again
            </Button>
          </div>
        ) : latest.data?.data[0] ? (
          <FuelRow entry={latest.data.data[0]} currency={currency} />
        ) : (
          <p className="text-muted-foreground text-sm">No fill-ups yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
