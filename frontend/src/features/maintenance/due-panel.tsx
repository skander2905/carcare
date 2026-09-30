'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import {
  dueProgress,
  dueSummary,
  formatCalendarDate,
  intervalSummary,
  needsAttention,
} from '@/lib/maintenance/format';
import { maintenanceApi, maintenanceKeys } from '@/lib/maintenance/maintenance-api';
import { type Schedule } from '@/lib/maintenance/types';
import { formatKm } from '@/lib/vehicles/format';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';
import { ScheduleForm } from './schedule-form';
import { DueBar, StatusBadge } from './status-badge';

/** What "Log it" hands the service form: the job, and the schedule it satisfies. */
export interface ServiceDraft {
  type: Schedule['type'];
  scheduleId: string;
}

function lastDone(schedule: Schedule): string | null {
  const { km, time } = schedule.due;
  if (!km && !time) return null;
  const parts = [km ? formatKm(km.lastKm) : null, time ? formatCalendarDate(time.lastDate) : null].filter(
    Boolean,
  );
  return `Last done ${parts.join(' · ')}${schedule.serviceCount === 0 ? ' (as you remembered it)' : ''}`;
}

export function ScheduleRow({ schedule, actions }: { schedule: Schedule; actions?: React.ReactNode }) {
  const paused = !schedule.isActive;
  return (
    <div className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{schedule.name}</span>
            <StatusBadge status={schedule.due.status} paused={paused} />
          </div>
          <p className={paused ? 'text-muted-foreground text-sm' : 'text-sm'}>{dueSummary(schedule.due)}</p>
          <p className="text-muted-foreground/80 text-xs">
            {[intervalSummary(schedule), lastDone(schedule)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap justify-end gap-1">{actions}</div> : null}
      </div>
      {schedule.due.status === 'UNKNOWN' || paused ? null : (
        <DueBar status={schedule.due.status} progress={dueProgress(schedule.due)} />
      )}
    </div>
  );
}

function ScheduleActions({
  schedule,
  onLog,
  onEdit,
}: {
  schedule: Schedule;
  onLog: () => void;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
  const fail = (fallback: string) => (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : fallback);

  const toggle = useMutation({
    mutationFn: () => maintenanceApi.updateSchedule(schedule.id, { isActive: !schedule.isActive }),
    onSuccess: async () => {
      toast.success(schedule.isActive ? 'Schedule paused' : 'Schedule resumed');
      await invalidate();
    },
    onError: fail('Could not change that schedule.'),
  });

  const remove = useMutation({
    mutationFn: () => maintenanceApi.removeSchedule(schedule.id),
    onSuccess: async () => {
      toast.success('Schedule deleted. The services logged against it are kept.');
      await invalidate();
    },
    onError: (error: unknown) => {
      setConfirming(false);
      fail('Could not delete that schedule.')(error);
    },
  });

  if (confirming) {
    return (
      <>
        <Button
          size="xs"
          variant="destructive"
          aria-label={`Confirm deleting the ${schedule.name} schedule`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </>
    );
  }

  return (
    <>
      {schedule.isActive ? (
        <Button
          size="xs"
          variant={needsAttention(schedule.due.status) ? 'default' : 'outline'}
          aria-label={`Log a service for ${schedule.name}`}
          onClick={onLog}
        >
          Log it
        </Button>
      ) : null}
      <Button size="xs" variant="ghost" aria-label={`Edit the ${schedule.name} schedule`} onClick={onEdit}>
        Edit
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={toggle.isPending}
        aria-label={`${schedule.isActive ? 'Pause' : 'Resume'} the ${schedule.name} schedule`}
        onClick={() => toggle.mutate()}
      >
        {schedule.isActive ? 'Pause' : 'Resume'}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Delete the ${schedule.name} schedule`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    </>
  );
}

export interface DuePanelProps {
  vehicleId: string;
  currentOdometerKm: number;
  onLog: (draft: ServiceDraft) => void;
}

/** The top of the maintenance page: every schedule, most urgent first, with what to do about it. */
export function DuePanel({ vehicleId, currentOdometerKm, onLog }: DuePanelProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const schedules = useQuery({
    queryKey: maintenanceKeys.schedules(vehicleId),
    queryFn: () => maintenanceApi.schedules(vehicleId),
  });

  const attention = schedules.data?.filter((s) => s.isActive && needsAttention(s.due.status)).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What&rsquo;s due</CardTitle>
        <CardDescription>
          {schedules.data?.length
            ? attention > 0
              ? `${attention} ${attention === 1 ? 'service needs' : 'services need'} attention, at ${formatKm(currentOdometerKm)}.`
              : `Nothing due at ${formatKm(currentOdometerKm)}.`
            : 'Recurring services, by distance, by time, or whichever comes first.'}
        </CardDescription>
        {adding ? null : (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" aria-hidden />
              Add a schedule
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding ? (
          <div className="bg-muted/40 rounded-lg border p-4">
            <ScheduleForm
              vehicleId={vehicleId}
              currentOdometerKm={currentOdometerKm}
              onDone={() => setAdding(false)}
            />
          </div>
        ) : null}

        {schedules.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : schedules.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-medium">
              Could not load schedules
            </p>
            <Button variant="outline" size="sm" onClick={() => void schedules.refetch()}>
              Try again
            </Button>
          </div>
        ) : schedules.data?.length ? (
          <ul className="divide-border divide-y">
            {schedules.data.map((schedule) => (
              <li key={schedule.id}>
                {editingId === schedule.id ? (
                  <div className="py-4">
                    <ScheduleForm
                      vehicleId={vehicleId}
                      currentOdometerKm={currentOdometerKm}
                      schedule={schedule}
                      onDone={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <ScheduleRow
                    schedule={schedule}
                    actions={
                      <ScheduleActions
                        schedule={schedule}
                        onLog={() => onLog({ type: schedule.type, scheduleId: schedule.id })}
                        onEdit={() => setEditingId(schedule.id)}
                      />
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        ) : adding ? null : (
          <p className="text-muted-foreground text-sm">
            No schedules yet. Add the oil change first — it is the one most cars need most often.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
