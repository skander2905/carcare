'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { OdometerTimeline } from '@/features/vehicles/odometer-timeline';
import { ApiError } from '@/lib/api/client';
import { formatKm, formatMoney, vehicleSpec, vehicleTitle } from '@/lib/vehicles/format';
import { vehicleKeys, vehiclesApi } from '@/lib/vehicles/vehicles-api';

/** Label/value pairs, skipping anything the owner never recorded. */
function Spec({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const vehicle = useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: () => vehiclesApi.get(id),
    retry: false,
  });

  const archive = useMutation({
    mutationFn: (isArchived: boolean) => vehiclesApi.update(id, { isArchived }),
    onSuccess: async (updated) => {
      toast.success(updated.archivedAt ? 'Vehicle archived' : 'Vehicle restored');
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not update that vehicle.');
    },
  });

  if (vehicle.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-10 sm:px-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // A 404 here is the API saying "absent, or not yours" — deliberately the same
  // answer, so an id cannot be probed for existence.
  if (vehicle.isError || !vehicle.data) {
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

  const data = vehicle.data;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/vehicles">
          <ArrowLeft className="size-4" aria-hidden />
          Vehicles
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{vehicleTitle(data)}</h1>
            {data.archivedAt ? <Badge variant="secondary">Archived</Badge> : null}
          </div>
          <p className="text-muted-foreground text-sm">
            {data.year} · {data.licensePlate} · {vehicleSpec(data)}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={archive.isPending}
          onClick={() => archive.mutate(!data.archivedAt)}
        >
          {data.archivedAt ? 'Restore' : 'Archive'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Spec label="Mileage" value={formatKm(data.currentOdometerKm)} />
            <Spec label="Purchase price" value={formatMoney(data.purchasePrice)} />
            <Spec label="Colour" value={data.color} />
            <Spec label="VIN" value={data.vin} />
          </dl>
        </CardContent>
      </Card>

      <OdometerTimeline vehicleId={data.id} />

      <p className="text-muted-foreground text-xs">
        Costs, fuel and maintenance for this vehicle arrive in the next phases.
      </p>
    </div>
  );
}
