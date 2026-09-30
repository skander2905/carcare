'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DuePanel, type ServiceDraft } from '@/features/maintenance/due-panel';
import { MaintenanceForm } from '@/features/maintenance/maintenance-form';
import { MaintenanceLog } from '@/features/maintenance/maintenance-log';
import { ApiError } from '@/lib/api/client';
import { vehicleTitle } from '@/lib/vehicles/format';
import { vehicleKeys, vehiclesApi } from '@/lib/vehicles/vehicles-api';

/** Null: the form is closed. An empty object: open, with nothing chosen for it. */
type Adding = Partial<ServiceDraft> | null;

function VehicleMaintenance() {
  const { id } = useParams<{ id: string }>();
  // `?new=1` arrives from the vehicle page's "Log a service", and opens the form.
  const [adding, setAdding] = useState<Adding>(useSearchParams().get('new') === '1' ? {} : null);
  // Bumped on every "Log it", so a second one restarts the form rather than keeping the first's input.
  const [formKey, setFormKey] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

  const vehicle = useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: () => vehiclesApi.get(id),
    retry: false,
  });

  const openForm = (draft: Partial<ServiceDraft>) => {
    setAdding(draft);
    setFormKey((k) => k + 1);
    // After the form renders; the due panel can be long enough to push it off screen.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

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
        <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
        {vehicle.data ? (
          <p className="text-muted-foreground text-sm">
            Schedules and service history for {vehicleTitle(vehicle.data)} · {vehicle.data.licensePlate}
          </p>
        ) : null}
      </div>

      {vehicle.data ? (
        <>
          <DuePanel
            vehicleId={id}
            currentOdometerKm={vehicle.data.currentOdometerKm}
            onLog={(draft) => openForm(draft)}
          />

          <div ref={formRef} className="scroll-mt-6">
            {adding ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">New service</CardTitle>
                </CardHeader>
                <CardContent>
                  <MaintenanceForm
                    key={formKey}
                    vehicleId={id}
                    currency={vehicle.data.currency}
                    draft={
                      adding.type && adding.scheduleId
                        ? { type: adding.type, scheduleId: adding.scheduleId }
                        : undefined
                    }
                    onDone={() => setAdding(null)}
                  />
                </CardContent>
              </Card>
            ) : (
              <Button onClick={() => openForm({})}>
                <Plus className="size-4" aria-hidden />
                Log a service
              </Button>
            )}
          </div>

          <MaintenanceLog vehicleId={id} currency={vehicle.data.currency} />
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

export default function VehicleMaintenancePage() {
  // `useSearchParams` (for ?new=) needs a boundary, as on the fuel page.
  return (
    <Suspense fallback={null}>
      <VehicleMaintenance />
    </Suspense>
  );
}
