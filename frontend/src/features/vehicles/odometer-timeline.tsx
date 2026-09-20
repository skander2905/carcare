'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { formatKm } from '@/lib/vehicles/format';
import { vehicleKeys, vehiclesApi } from '@/lib/vehicles/vehicles-api';

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Entered by hand',
  FUEL: 'From a fill-up',
  EXPENSE: 'From an expense',
  MAINTENANCE: 'From a service',
  TRIP: 'From a trip',
};

export function OdometerTimeline({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const readings = useQuery({
    queryKey: vehicleKeys.readings(vehicleId, 1),
    queryFn: () => vehiclesApi.readings(vehicleId),
  });

  const record = useMutation({
    mutationFn: (odometerKm: number) => vehiclesApi.recordReading(vehicleId, { odometerKm }),
    onSuccess: async () => {
      setValue('');
      setError(null);
      toast.success('Reading recorded');
      // The vehicle's headline mileage moves with it, so both caches go.
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
    onError: (failure: unknown) => {
      // The server's message names the reading in the way, with its value and
      // date — far more useful than anything that could be written here.
      setError(failure instanceof ApiError ? failure.message : 'Could not record that reading.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const km = Number(value);

    if (!Number.isInteger(km) || km < 0) {
      setError('Enter the mileage as a whole number of kilometres.');
      return;
    }

    record.mutate(km);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mileage</CardTitle>
        <CardDescription>
          Every reading, newest first. Backdating is fine — a reading only has to fit between the ones around
          it.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1 space-y-2">
            <Label htmlFor="odometerKm">Add a reading</Label>
            <Input
              id="odometerKm"
              inputMode="numeric"
              placeholder="121500"
              value={value}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'odometer-error' : undefined}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!value || record.isPending}>
            {record.isPending ? 'Saving…' : 'Record'}
          </Button>
        </form>

        {error ? (
          <p id="odometer-error" role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {readings.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : readings.data?.data.length ? (
          <ol className="divide-border divide-y">
            {readings.data.data.map((reading) => (
              <li key={reading.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <span className="font-medium tabular-nums">{formatKm(reading.odometerKm)}</span>
                <span className="text-muted-foreground text-right text-sm">
                  {new Date(reading.recordedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                  <span className="text-muted-foreground/70 block text-xs">
                    {SOURCE_LABELS[reading.source] ?? reading.source}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted-foreground text-sm">No readings yet.</p>
        )}

        {readings.data && readings.data.meta.total > readings.data.data.length ? (
          <p className="text-muted-foreground text-xs">
            Showing {readings.data.data.length} of {readings.data.meta.total} readings.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
