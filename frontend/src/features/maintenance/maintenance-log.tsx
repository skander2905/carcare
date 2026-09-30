'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { AttachmentsPanel } from '@/features/expenses/attachments-panel';
import { ApiError } from '@/lib/api/client';
import { dayRange, formatExpenseDate } from '@/lib/expenses/format';
import { ALL_TYPES, isFree, maintenanceLabel } from '@/lib/maintenance/format';
import { maintenanceApi, maintenanceKeys } from '@/lib/maintenance/maintenance-api';
import {
  type MaintenanceFilters,
  type MaintenanceRecord,
  type MaintenanceType,
} from '@/lib/maintenance/types';
import { useDebounced } from '@/lib/use-debounced';
import { formatKm, formatMoney } from '@/lib/vehicles/format';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';
import { MaintenanceForm } from './maintenance-form';

const PAGE_SIZE = 20;

/** "Oil change on 30 Sept 2026" — tells a screen reader which row a button acts on. */
const describe = (record: MaintenanceRecord) =>
  `${maintenanceLabel(record.type)} on ${formatExpenseDate(record.performedAt)}`;

function DeleteButton({ record }: { record: MaintenanceRecord }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => maintenanceApi.remove(record.id),
    onSuccess: async () => {
      toast.success('Service deleted');
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast.error(error instanceof ApiError ? error.message : 'Could not delete that service.');
    },
  });

  return confirming ? (
    <span className="flex gap-1">
      <Button
        size="xs"
        variant="destructive"
        aria-label={`Confirm deleting ${describe(record)}`}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? 'Deleting…' : 'Delete'}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Keep ${describe(record)}`}
        onClick={() => setConfirming(false)}
      >
        Keep
      </Button>
    </span>
  ) : (
    <Button
      size="xs"
      variant="ghost"
      aria-label={`Delete ${describe(record)}`}
      onClick={() => setConfirming(true)}
    >
      Delete
    </Button>
  );
}

export function MaintenanceRow({
  record,
  currency,
  actions,
}: {
  record: MaintenanceRecord;
  currency: string;
  actions?: React.ReactNode;
}) {
  const split = [
    record.partsCost ? `parts ${formatMoney(record.partsCost, currency)}` : null,
    record.laborCost ? `labour ${formatMoney(record.laborCost, currency)}` : null,
  ].filter(Boolean);

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{maintenanceLabel(record.type)}</span>
          {record.scheduleName ? (
            <Badge variant="outline" className="gap-1">
              <CalendarClock className="size-3" aria-hidden />
              {record.scheduleName}
            </Badge>
          ) : null}
        </div>
        {record.description || record.serviceProvider ? (
          <p className="text-muted-foreground truncate text-sm">
            {[record.description, record.serviceProvider].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <p className="text-muted-foreground/80 text-xs">
          {formatExpenseDate(record.performedAt)} · {formatKm(record.odometerKm)}
          {split.length ? ` · ${split.join(', ')}` : null}
          {record.attachmentCount > 0 ? (
            <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle">
              <Paperclip className="size-3" aria-hidden />
              <span className="sr-only">
                {record.attachmentCount === 1 ? '1 invoice' : `${record.attachmentCount} invoices`}
              </span>
              <span aria-hidden>{record.attachmentCount}</span>
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums">
          {isFree(record.totalCost) ? 'Free' : formatMoney(record.totalCost, currency)}
        </span>
        {actions}
      </div>
    </div>
  );
}

export interface MaintenanceLogProps {
  vehicleId: string;
  currency: string;
}

/** Every service logged, newest first, with filters. */
export function MaintenanceLog({ vehicleId, currency }: MaintenanceLogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filesId, setFilesId] = useState<string | null>(null);

  const [type, setType] = useState<MaintenanceType | ''>('');
  const [provider, setProvider] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');

  const debouncedProvider = useDebounced(provider.trim(), 300);

  // As in the ledger: the page belongs to the query it was chosen for.
  const identity = JSON.stringify([type, debouncedProvider, fromDay, toDay]);
  const [paging, setPaging] = useState({ query: identity, page: 1 });
  const page = paging.query === identity ? paging.page : 1;

  const invertedRange = Boolean(fromDay && toDay && fromDay > toDay);

  const filters: MaintenanceFilters = {
    ...(type ? { type } : {}),
    ...(debouncedProvider ? { provider: debouncedProvider } : {}),
    ...dayRange(fromDay, toDay),
    page,
    limit: PAGE_SIZE,
  };

  const records = useQuery({
    queryKey: maintenanceKeys.list(vehicleId, filters),
    queryFn: () => maintenanceApi.list(vehicleId, filters),
    enabled: !invertedRange,
    placeholderData: (previous) => previous,
  });

  const filtered = Boolean(type || debouncedProvider || fromDay || toDay);

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="maintenance-provider">Workshop</Label>
            <Input
              id="maintenance-provider"
              type="search"
              placeholder="Any workshop"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maintenance-type">Job</Label>
            <NativeSelect
              id="maintenance-type"
              value={type}
              onChange={(event) => setType(event.target.value as MaintenanceType | '')}
            >
              <option value="">All jobs</option>
              {ALL_TYPES.map((value) => (
                <option key={value} value={value}>
                  {maintenanceLabel(value)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maintenance-from">From</Label>
            <Input
              id="maintenance-from"
              type="date"
              value={fromDay}
              aria-invalid={invertedRange}
              onChange={(event) => setFromDay(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maintenance-to">To</Label>
            <Input
              id="maintenance-to"
              type="date"
              value={toDay}
              aria-invalid={invertedRange}
              aria-describedby={invertedRange ? 'maintenance-range-error' : undefined}
              onChange={(event) => setToDay(event.target.value)}
            />
          </div>
        </div>

        {invertedRange ? (
          <p id="maintenance-range-error" role="alert" className="text-destructive text-sm">
            The start date is after the end date.
          </p>
        ) : records.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : records.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-medium">
              Could not load services
            </p>
            <Button variant="outline" size="sm" onClick={() => void records.refetch()}>
              Try again
            </Button>
          </div>
        ) : records.data?.data.length ? (
          <ul className="divide-border divide-y">
            {records.data.data.map((record) => (
              <li key={record.id}>
                {editingId === record.id ? (
                  <div className="py-4">
                    <MaintenanceForm
                      vehicleId={vehicleId}
                      currency={currency}
                      record={record}
                      onDone={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <>
                    <MaintenanceRow
                      record={record}
                      currency={currency}
                      actions={
                        <span className="flex gap-1">
                          {/* A free service has no expense, so nothing to hang an invoice on. */}
                          {record.expenseId ? (
                            <Button
                              size="xs"
                              variant={filesId === record.id ? 'secondary' : 'ghost'}
                              aria-expanded={filesId === record.id}
                              aria-controls={`maintenance-files-${record.id}`}
                              aria-label={`Invoices for ${describe(record)}`}
                              onClick={() => setFilesId((open) => (open === record.id ? null : record.id))}
                            >
                              <Paperclip className="size-3" aria-hidden />
                              Files
                            </Button>
                          ) : null}
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={`Edit ${describe(record)}`}
                            onClick={() => setEditingId(record.id)}
                          >
                            Edit
                          </Button>
                          <DeleteButton record={record} />
                        </span>
                      }
                    />
                    {filesId === record.id && record.expenseId ? (
                      <div id={`maintenance-files-${record.id}`} className="pb-3">
                        <AttachmentsPanel vehicleId={vehicleId} expenseId={record.expenseId} />
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : filtered ? (
          <p className="text-muted-foreground text-sm">No services match these filters.</p>
        ) : (
          <p className="text-muted-foreground text-sm">No services logged yet.</p>
        )}

        {records.data && records.data.meta.totalPages > 1 && !invertedRange ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs tabular-nums">
              Page {records.data.meta.page} of {records.data.meta.totalPages} · {records.data.meta.total}{' '}
              services
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1 || records.isFetching}
                onClick={() => setPaging({ query: identity, page: Math.max(1, page - 1) })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!records.data.meta.hasNext || records.isFetching}
                onClick={() => setPaging({ query: identity, page: page + 1 })}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
