'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatExpenseDate } from '@/lib/expenses/format';
import { fuelApi, fuelKeys } from '@/lib/fuel/fuel-api';
import { type ConsumptionWindow } from '@/lib/fuel/types';
import { formatKm, formatMoney } from '@/lib/vehicles/format';
import { ChoiceChip } from './choice-chip';

const PERIODS = [
  { key: '3m', label: '3 months', months: 3 },
  { key: '12m', label: '12 months', months: 12 },
  { key: 'all', label: 'All time', months: null },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

/** The start of a period, to the day, so the query key is stable across renders. */
function periodStart(months: number | null): string | undefined {
  if (months === null) return undefined;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - months);
  return start.toISOString();
}

function Stat({ label, value, detail }: { label: string; value: string | null; detail?: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value ?? '—'}</dd>
      {detail ? <dd className="text-muted-foreground text-xs">{detail}</dd> : null}
    </div>
  );
}

interface Point {
  endedAt: string;
  value: number;
  window: ConsumptionWindow;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;

  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{formatExpenseDate(point.endedAt)}</p>
      <p className="tabular-nums">{point.window.litresPer100Km} L/100 km</p>
      <p className="text-muted-foreground tabular-nums">
        {point.window.litres} L over {formatKm(point.window.distanceKm)}
      </p>
    </div>
  );
}

/**
 * Fuel economy for a period: headline figures, then the trend.
 *
 * The average is the API's Σ litres ÷ Σ distance, never a mean of the
 * points on the chart, and a blank stays a blank — "—" rather than a zero
 * when there are not yet two full tanks to measure between.
 */
export function ConsumptionPanel({ vehicleId, currency }: { vehicleId: string; currency: string }) {
  const [period, setPeriod] = useState<PeriodKey>('12m');
  const months = PERIODS.find((p) => p.key === period)!.months;
  const range = months === null ? {} : { from: periodStart(months) };

  const consumption = useQuery({
    queryKey: fuelKeys.consumption(vehicleId, range),
    queryFn: () => fuelApi.consumption(vehicleId, range),
    placeholderData: (previous) => previous,
  });

  const summary = consumption.data?.summary;
  const points: Point[] = (consumption.data?.windows ?? []).map((window) => ({
    endedAt: window.endedAt,
    value: Number(window.litresPer100Km),
    window,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fuel economy</CardTitle>
        <CardDescription>Measured between fill-ups to the brim.</CardDescription>
        <CardAction>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <ChoiceChip
                key={p.key}
                selected={period === p.key}
                className="min-h-7 px-2.5 text-xs"
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </ChoiceChip>
            ))}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-6">
        {consumption.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : consumption.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-medium">
              Could not load fuel economy
            </p>
            <Button variant="outline" size="sm" onClick={() => void consumption.refetch()}>
              Try again
            </Button>
          </div>
        ) : summary ? (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Average"
                value={summary.averageLitresPer100Km ? `${summary.averageLitresPer100Km} L/100 km` : null}
                detail={
                  summary.measuredDistanceKm > 0
                    ? `over ${formatKm(summary.measuredDistanceKm)}`
                    : 'Needs two full tanks'
                }
              />
              <Stat
                label="Fuel spend"
                value={formatMoney(summary.totalCost, currency)}
                detail={`${summary.fillCount} fill-up${summary.fillCount === 1 ? '' : 's'}`}
              />
              <Stat
                label="Average price"
                value={
                  summary.averagePricePerLiter
                    ? `${formatMoney(summary.averagePricePerLiter, currency)}/L`
                    : null
                }
                detail={`${summary.totalLitres} L bought`}
              />
              <Stat
                label="Fuel cost per km"
                value={summary.costPerKm ? formatMoney(summary.costPerKm, currency) : null}
              />
            </dl>

            {points.length >= 2 ? (
              <figure className="space-y-2">
                <figcaption className="text-muted-foreground text-xs">L/100 km, per full tank</figcaption>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="endedAt"
                        tickFormatter={(iso: string) =>
                          new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                        }
                        tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                        tickLine={false}
                        axisLine={{ stroke: 'var(--border)' }}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                        domain={[
                          (min: number) => Math.max(0, Math.floor(min - 1)),
                          (max: number) => Math.ceil(max + 1),
                        ]}
                        allowDecimals={false}
                      />
                      <Tooltip
                        content={<ChartTooltip />}
                        cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
                      />
                      <Line
                        // Straight segments: each point is one tank, and a smoothed curve
                        // would draw readings between them that were never measured.
                        type="linear"
                        dataKey="value"
                        stroke="var(--chart-fuel)"
                        strokeWidth={2}
                        dot={{ r: 4, fill: 'var(--chart-fuel)', stroke: 'var(--card)', strokeWidth: 2 }}
                        activeDot={{ r: 5, fill: 'var(--chart-fuel)', stroke: 'var(--card)', strokeWidth: 2 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </figure>
            ) : (
              <p className="text-muted-foreground text-sm">
                {points.length === 1
                  ? 'One tank measured so far. The trend appears after the next full fill-up.'
                  : 'Log two fill-ups to the brim and the trend appears here.'}
              </p>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
