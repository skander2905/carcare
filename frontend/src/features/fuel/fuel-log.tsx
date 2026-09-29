'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { AttachmentsPanel } from '@/features/expenses/attachments-panel';
import { ApiError } from '@/lib/api/client';
import { dayRange, formatExpenseDate } from '@/lib/expenses/format';
import { fuelApi, fuelKeys } from '@/lib/fuel/fuel-api';
import { PUMP_FUELS, formatLitres, formatPer100 } from '@/lib/fuel/format';
import { type FuelEntry, type FuelFilters } from '@/lib/fuel/types';
import { formatKm, formatMoney, fuelLabel } from '@/lib/vehicles/format';
import { type FuelType } from '@/lib/vehicles/types';
import { useDebounced } from '@/lib/use-debounced';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';
import { FuelForm } from './fuel-form';

const PAGE_SIZE = 20;

/** "38.20 L on 29 Sept 2026" — tells a screen reader which row a button acts on. */
const describe = (entry: FuelEntry) =>
  `${formatLitres(entry.volumeLiters)} on ${formatExpenseDate(entry.filledAt)}`;

function DeleteButton({ entry }: { entry: FuelEntry }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => fuelApi.remove(entry.id),
    onSuccess: async () => {
      toast.success('Fill-up deleted');
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast.error(error instanceof ApiError ? error.message : 'Could not delete that fill-up.');
    },
  });

  return confirming ? (
    <span className="flex gap-1">
      <Button
        size="xs"
        variant="destructive"
        aria-label={`Confirm deleting ${describe(entry)}`}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? 'Deleting…' : 'Delete'}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Keep ${describe(entry)}`}
        onClick={() => setConfirming(false)}
      >
        Keep
      </Button>
    </span>
  ) : (
    <Button
      size="xs"
      variant="ghost"
      aria-label={`Delete ${describe(entry)}`}
      onClick={() => setConfirming(true)}
    >
      Delete
    </Button>
  );
}

export function FuelRow({
  entry,
  currency,
  actions,
}: {
  entry: FuelEntry;
  currency: string;
  actions?: React.ReactNode;
}) {
  const figure = entry.consumption ? formatPer100(entry.consumption.litresPer100Km) : null;

  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tabular-nums">{formatLitres(entry.volumeLiters)}</span>
          <span className="text-muted-foreground text-sm">{fuelLabel(entry.fuelType)}</span>
          {entry.isFullTank ? null : <Badge variant="outline">Partial</Badge>}
          {entry.isMissedFill ? <Badge variant="outline">After a missed fill</Badge> : null}
        </div>
        <p className="text-muted-foreground truncate text-sm">
          {[entry.stationName, `${entry.pricePerLiter}/L`].filter(Boolean).join(' · ')}
        </p>
        <p className="text-muted-foreground/80 text-xs">
          {formatExpenseDate(entry.filledAt)} · {formatKm(entry.odometerKm)}
          {entry.attachmentCount > 0 ? (
            <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle">
              <Paperclip className="size-3" aria-hidden />
              <span className="sr-only">
                {entry.attachmentCount === 1 ? '1 receipt' : `${entry.attachmentCount} receipts`}
              </span>
              <span aria-hidden>{entry.attachmentCount}</span>
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums">{formatMoney(entry.totalCost, currency)}</span>
        {figure ? (
          <span
            className="text-muted-foreground text-xs tabular-nums"
            title={`${entry.consumption!.litres} L over ${formatKm(entry.consumption!.distanceKm)}`}
          >
            {figure}
          </span>
        ) : null}
        {actions}
      </div>
    </div>
  );
}

export interface FuelLogProps {
  vehicleId: string;
  vehicleFuelType: FuelType;
  currency: string;
  startAdding?: boolean;
}

export function FuelLog({ vehicleId, vehicleFuelType, currency, startAdding = false }: FuelLogProps) {
  const [adding, setAdding] = useState(startAdding);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filesId, setFilesId] = useState<string | null>(null);

  const [fuelType, setFuelType] = useState<FuelType | ''>('');
  const [station, setStation] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');

  const debouncedStation = useDebounced(station.trim(), 300);

  // As in the ledger: the page belongs to the query it was chosen for.
  const identity = JSON.stringify([fuelType, debouncedStation, fromDay, toDay]);
  const [paging, setPaging] = useState({ query: identity, page: 1 });
  const page = paging.query === identity ? paging.page : 1;

  const invertedRange = Boolean(fromDay && toDay && fromDay > toDay);

  const filters: FuelFilters = {
    ...(fuelType ? { fuelType } : {}),
    ...(debouncedStation ? { station: debouncedStation } : {}),
    ...dayRange(fromDay, toDay),
    page,
    limit: PAGE_SIZE,
  };

  const entries = useQuery({
    queryKey: fuelKeys.list(vehicleId, filters),
    queryFn: () => fuelApi.list(vehicleId, filters),
    enabled: !invertedRange,
    placeholderData: (previous) => previous,
  });

  const filtered = Boolean(fuelType || debouncedStation || fromDay || toDay);

  return (
    <div className="space-y-6">
      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New fill-up</CardTitle>
          </CardHeader>
          <CardContent>
            <FuelForm
              vehicleId={vehicleId}
              vehicleFuelType={vehicleFuelType}
              currency={currency}
              onDone={() => setAdding(false)}
            />
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          Log a fill-up
        </Button>
      )}

      <Card>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="fuel-station">Station</Label>
              <Input
                id="fuel-station"
                type="search"
                placeholder="Any station"
                value={station}
                onChange={(event) => setStation(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fuel-type">Fuel</Label>
              <NativeSelect
                id="fuel-type"
                value={fuelType}
                onChange={(event) => setFuelType(event.target.value as FuelType | '')}
              >
                <option value="">All fuels</option>
                {PUMP_FUELS.map((value) => (
                  <option key={value} value={value}>
                    {fuelLabel(value)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fuel-from">From</Label>
              <Input
                id="fuel-from"
                type="date"
                value={fromDay}
                aria-invalid={invertedRange}
                onChange={(event) => setFromDay(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fuel-to">To</Label>
              <Input
                id="fuel-to"
                type="date"
                value={toDay}
                aria-invalid={invertedRange}
                aria-describedby={invertedRange ? 'fuel-range-error' : undefined}
                onChange={(event) => setToDay(event.target.value)}
              />
            </div>
          </div>

          {invertedRange ? (
            <p id="fuel-range-error" role="alert" className="text-destructive text-sm">
              The start date is after the end date.
            </p>
          ) : entries.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : entries.isError ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm font-medium">
                Could not load fill-ups
              </p>
              <Button variant="outline" size="sm" onClick={() => void entries.refetch()}>
                Try again
              </Button>
            </div>
          ) : entries.data?.data.length ? (
            <ul className="divide-border divide-y">
              {entries.data.data.map((entry) => (
                <li key={entry.id}>
                  {editingId === entry.id ? (
                    <div className="py-4">
                      <FuelForm
                        vehicleId={vehicleId}
                        vehicleFuelType={vehicleFuelType}
                        currency={currency}
                        entry={entry}
                        onDone={() => setEditingId(null)}
                      />
                    </div>
                  ) : (
                    <>
                      <FuelRow
                        entry={entry}
                        currency={currency}
                        actions={
                          <span className="flex gap-1">
                            <Button
                              size="xs"
                              variant={filesId === entry.id ? 'secondary' : 'ghost'}
                              aria-expanded={filesId === entry.id}
                              aria-controls={`fuel-files-${entry.id}`}
                              aria-label={`Receipts for ${describe(entry)}`}
                              onClick={() => setFilesId((open) => (open === entry.id ? null : entry.id))}
                            >
                              <Paperclip className="size-3" aria-hidden />
                              Files
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              aria-label={`Edit ${describe(entry)}`}
                              onClick={() => setEditingId(entry.id)}
                            >
                              Edit
                            </Button>
                            <DeleteButton entry={entry} />
                          </span>
                        }
                      />
                      {filesId === entry.id ? (
                        <div id={`fuel-files-${entry.id}`} className="pb-3">
                          {/* Receipts live on the fill-up's ledger expense. */}
                          <AttachmentsPanel vehicleId={vehicleId} expenseId={entry.expenseId} />
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : filtered ? (
            <p className="text-muted-foreground text-sm">No fill-ups match these filters.</p>
          ) : (
            <p className="text-muted-foreground text-sm">
              No fill-ups yet. Log two full tanks and consumption appears here.
            </p>
          )}

          {entries.data && entries.data.meta.totalPages > 1 && !invertedRange ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs tabular-nums">
                Page {entries.data.meta.page} of {entries.data.meta.totalPages} · {entries.data.meta.total}{' '}
                fill-ups
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1 || entries.isFetching}
                  onClick={() => setPaging({ query: identity, page: Math.max(1, page - 1) })}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!entries.data.meta.hasNext || entries.isFetching}
                  onClick={() => setPaging({ query: identity, page: page + 1 })}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
