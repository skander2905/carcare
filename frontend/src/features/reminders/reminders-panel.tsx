'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AttachmentsPanel } from '@/features/expenses/attachments-panel';
import { StatusBadge } from '@/features/maintenance/status-badge';
import { ApiError } from '@/lib/api/client';
import { formatCalendarDate, needsAttention } from '@/lib/maintenance/format';
import { reminderSummary, repeatSummary } from '@/lib/reminders/format';
import { reminderKeys, remindersApi } from '@/lib/reminders/reminders-api';
import { type Reminder } from '@/lib/reminders/types';
import { formatKm } from '@/lib/vehicles/format';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';
import { ReminderForm } from './reminder-form';

function duePoint(reminder: Reminder): string | null {
  const parts = [
    reminder.dueDate ? formatCalendarDate(reminder.dueDate) : null,
    reminder.dueOdometerKm != null ? formatKm(reminder.dueOdometerKm) : null,
  ].filter(Boolean);
  return parts.length ? `Due ${parts.join(' or ')}` : null;
}

export function ReminderRow({ reminder, actions }: { reminder: Reminder; actions?: React.ReactNode }) {
  const done = reminder.status === 'COMPLETED';
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={done ? 'text-muted-foreground text-sm line-through' : 'text-sm font-medium'}>
            {reminder.title}
          </span>
          {reminder.due ? <StatusBadge status={reminder.due.status} /> : null}
        </div>
        <p className={done ? 'text-muted-foreground text-sm' : 'text-sm'}>{reminderSummary(reminder)}</p>
        <p className="text-muted-foreground/80 text-xs">
          {[done ? null : duePoint(reminder), repeatSummary(reminder.repeatEveryMonths), reminder.description]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap justify-end gap-1">{actions}</div> : null}
    </div>
  );
}

function ReminderActions({
  reminder,
  onEdit,
  onToggleFiles,
  onNextNeedsFiles,
}: {
  reminder: Reminder;
  onEdit: () => void;
  onToggleFiles: () => void;
  /** A repeating reminder that held papers was done: offer to add the new ones to its successor. */
  onNextNeedsFiles: (nextId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
  const fail = (fallback: string) => (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : fallback);

  const complete = useMutation({
    mutationFn: () => remindersApi.complete(reminder.id),
    onSuccess: async ({ next }) => {
      const message = next?.dueDate
        ? `Done. Next one set for ${formatCalendarDate(next.dueDate)}.`
        : 'Marked as done';
      if (next && reminder.attachmentCount > 0) {
        // The old certificate stays with the old reminder; the new one goes on the next.
        toast.success(message, {
          duration: 10_000,
          action: { label: 'Add the new one', onClick: () => onNextNeedsFiles(next.id) },
        });
      } else {
        toast.success(message);
      }
      await invalidate();
    },
    onError: fail('Could not mark that as done.'),
  });

  const remove = useMutation({
    mutationFn: () => remindersApi.remove(reminder.id),
    onSuccess: async () => {
      toast.success('Reminder deleted');
      await invalidate();
    },
    onError: (error: unknown) => {
      setConfirming(false);
      fail('Could not delete that reminder.')(error);
    },
  });

  if (confirming) {
    return (
      <>
        <Button
          size="xs"
          variant="destructive"
          aria-label={`Confirm deleting ${reminder.title}`}
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
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Files for ${reminder.title}${reminder.attachmentCount ? `, ${reminder.attachmentCount} attached` : ''}`}
        onClick={onToggleFiles}
      >
        <Paperclip className="size-3.5" aria-hidden />
        {reminder.attachmentCount > 0 ? reminder.attachmentCount : 'Files'}
      </Button>
      {reminder.status === 'PENDING' ? (
        <>
          <Button
            size="xs"
            variant={reminder.due && needsAttention(reminder.due.status) ? 'default' : 'outline'}
            aria-label={`Mark ${reminder.title} as done`}
            disabled={complete.isPending}
            onClick={() => complete.mutate()}
          >
            Done
          </Button>
          <Button size="xs" variant="ghost" aria-label={`Edit ${reminder.title}`} onClick={onEdit}>
            Edit
          </Button>
        </>
      ) : null}
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Delete ${reminder.title}`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    </>
  );
}

export interface RemindersPanelProps {
  vehicleId: string;
  currentOdometerKm: number;
  startAdding?: boolean;
}

/** A car's reminders: pending ones most urgent first, then a few recently done. */
export function RemindersPanel({ vehicleId, currentOdometerKm, startAdding = false }: RemindersPanelProps) {
  const [adding, setAdding] = useState(startAdding);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filesId, setFilesId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const reminders = useQuery({
    queryKey: reminderKeys.all(vehicleId),
    queryFn: () => remindersApi.list(vehicleId),
  });

  const pending = reminders.data?.filter((r) => r.status === 'PENDING') ?? [];
  const done = reminders.data?.filter((r) => r.status === 'COMPLETED') ?? [];
  const attention = pending.filter((r) => r.due && needsAttention(r.due.status)).length;

  const row = (reminder: Reminder) =>
    editingId === reminder.id ? (
      <div className="bg-muted/40 my-2 rounded-lg border p-4">
        <ReminderForm
          vehicleId={vehicleId}
          currentOdometerKm={currentOdometerKm}
          reminder={reminder}
          onDone={() => setEditingId(null)}
        />
      </div>
    ) : (
      <>
        <ReminderRow
          reminder={reminder}
          actions={
            <ReminderActions
              reminder={reminder}
              onEdit={() => setEditingId(reminder.id)}
              onToggleFiles={() => setFilesId((id) => (id === reminder.id ? null : reminder.id))}
              onNextNeedsFiles={setFilesId}
            />
          }
        />
        {filesId === reminder.id ? (
          <div className="mb-3">
            <AttachmentsPanel
              vehicleId={vehicleId}
              reminderId={reminder.id}
              emptyText="Nothing kept with it yet. Add the certificate or the contract."
            />
          </div>
        ) : null}
      </>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reminders</CardTitle>
        <CardDescription>
          {pending.length
            ? attention > 0
              ? `${attention} ${attention === 1 ? 'needs' : 'need'} attention.`
              : 'Nothing due yet.'
            : 'Renewals, payments and anything else with a date or a mileage.'}
        </CardDescription>
        {adding ? null : (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" aria-hidden />
              Add a reminder
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding ? (
          <div className="bg-muted/40 rounded-lg border p-4">
            <ReminderForm
              vehicleId={vehicleId}
              currentOdometerKm={currentOdometerKm}
              onDone={() => setAdding(false)}
            />
          </div>
        ) : null}

        {reminders.isLoading ? (
          <Skeleton className="h-16 w-full" />
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
            {pending.map((reminder) => (
              <li key={reminder.id}>{row(reminder)}</li>
            ))}
          </ul>
        ) : adding ? null : (
          <p className="text-muted-foreground text-sm">No reminders yet.</p>
        )}

        {done.length ? (
          <div className="space-y-1">
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? 'Hide' : 'Show'} {done.length} done
            </Button>
            {showDone ? (
              <ul className="divide-border divide-y">
                {done.map((reminder) => (
                  <li key={reminder.id}>{row(reminder)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
