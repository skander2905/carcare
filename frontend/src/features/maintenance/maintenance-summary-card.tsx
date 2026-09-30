'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { needsAttention } from '@/lib/maintenance/format';
import { maintenanceApi, maintenanceKeys } from '@/lib/maintenance/maintenance-api';
import { ScheduleRow } from './due-panel';

const SHOWN = 3;

/** The vehicle page's view of maintenance: the few schedules closest to due, and the way in. */
export function MaintenanceSummaryCard({ vehicleId }: { vehicleId: string }) {
  const schedules = useQuery({
    queryKey: maintenanceKeys.schedules(vehicleId),
    queryFn: () => maintenanceApi.schedules(vehicleId),
  });

  // The API lists the most urgent first, paused last.
  const active = schedules.data?.filter((s) => s.isActive) ?? [];
  const attention = active.filter((s) => needsAttention(s.due.status)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Maintenance</CardTitle>
        <CardDescription>
          {active.length === 0
            ? 'Schedules for oil, tyres, inspection and the rest.'
            : attention > 0
              ? `${attention} ${attention === 1 ? 'service needs' : 'services need'} attention.`
              : 'Nothing due.'}
        </CardDescription>
        <CardAction className="flex gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/vehicles/${vehicleId}/maintenance`}>{active.length ? 'View all' : 'Set up'}</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/vehicles/${vehicleId}/maintenance?new=1`}>
              <Wrench className="size-3.5" aria-hidden />
              Log a service
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {schedules.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : schedules.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-medium">
              Could not load schedules
            </p>
            <Button variant="outline" size="sm" onClick={() => void schedules.refetch()}>
              Try again
            </Button>
          </div>
        ) : active.length ? (
          <ul className="divide-border divide-y">
            {active.slice(0, SHOWN).map((schedule) => (
              <li key={schedule.id}>
                <ScheduleRow schedule={schedule} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No schedules yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
