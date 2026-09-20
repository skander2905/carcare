'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Car, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { vehicleKeys, vehiclesApi } from '@/lib/vehicles/vehicles-api';
import { VehicleCard } from './vehicle-card';

export function VehicleList() {
  const [includeArchived, setIncludeArchived] = useState(false);

  const vehicles = useQuery({
    queryKey: vehicleKeys.list(includeArchived),
    queryFn: () => vehiclesApi.list(includeArchived),
  });

  if (vehicles.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    );
  }

  if (vehicles.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p role="alert" className="text-sm font-medium">
            Could not load your vehicles
          </p>
          <p className="text-muted-foreground text-sm">
            {vehicles.error instanceof Error ? vehicles.error.message : 'Something went wrong.'}
          </p>
          <Button variant="outline" size="sm" onClick={() => void vehicles.refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!vehicles.data?.length && !includeArchived) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Car className="text-muted-foreground size-8" aria-hidden />
          <div>
            <p className="font-medium">No vehicles yet</p>
            <p className="text-muted-foreground text-sm">
              Add your car to start tracking what it costs to run.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/vehicles/new">
              <Plus className="size-4" aria-hidden />
              Add a vehicle
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vehicles.data?.map((vehicle) => (
          <VehicleCard key={vehicle.id} vehicle={vehicle} />
        ))}
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={() => setIncludeArchived((shown) => !shown)}>
        {includeArchived ? 'Hide archived' : 'Show archived'}
      </Button>
    </div>
  );
}
