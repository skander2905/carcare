'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BellPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { needsAttention } from '@/lib/maintenance/format';
import { reminderKeys, remindersApi } from '@/lib/reminders/reminders-api';
import { ReminderRow } from './reminders-panel';

const SHOWN = 3;

/** The vehicle page's view of reminders: the few closest to due, and the way in. */
export function RemindersSummaryCard({ vehicleId }: { vehicleId: string }) {
  const reminders = useQuery({
    queryKey: reminderKeys.all(vehicleId),
    queryFn: () => remindersApi.list(vehicleId),
  });

  // The API lists pending ones most urgent first.
  const pending = reminders.data?.filter((r) => r.status === 'PENDING') ?? [];
  const attention = pending.filter((r) => r.due && needsAttention(r.due.status)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reminders</CardTitle>
        <CardDescription>
          {pending.length === 0
            ? 'Insurance, road tax, loan payments, warranty.'
            : attention > 0
              ? `${attention} ${attention === 1 ? 'needs' : 'need'} attention.`
              : 'Nothing due.'}
        </CardDescription>
        <CardAction className="flex gap-2">
          {pending.length ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/vehicles/${vehicleId}/reminders`}>View all</Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={`/vehicles/${vehicleId}/reminders?new=1`}>
              <BellPlus className="size-3.5" aria-hidden />
              Add
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {reminders.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : reminders.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-medium">
              Could not load reminders
            </p>
            <Button variant="outline" size="sm" onClick={() => void reminders.refetch()}>
              Try again
            </Button>
          </div>
        ) : pending.length ? (
          <ul className="divide-border divide-y">
            {pending.slice(0, SHOWN).map((reminder) => (
              <li key={reminder.id}>
                <ReminderRow reminder={reminder} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No reminders yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
