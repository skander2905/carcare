'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChoiceChip } from '@/features/fuel/choice-chip';
import { toDateInputValue } from '@/lib/expenses/format';
import {
  type Assessment,
  assessReading,
  completeReading,
  digitsOnly,
  estimateReading,
  fromTrip,
  groupDigits,
  photoCandidates,
} from '@/lib/odometer/mileage-entry';
import { odometerApi, odometerKeys } from '@/lib/odometer/odometer-api';
import { cn } from '@/lib/utils';

type Mode = 'odometer' | 'trip';

type PhotoState =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'found'; candidates: number[] }
  | { kind: 'failed'; message: string };

export interface MileageInputProps {
  id: string;
  vehicleId: string;
  /** The full reading, as digits, or '' — what the form submits. */
  value: string;
  onChange: (value: string) => void;
  /** The day the reading was taken (YYYY-MM-DD), so it is compared with the readings around it. */
  date: string;
  /** The record being edited, left out of the comparison. */
  excludeSourceId?: string;
  /** Fuel only: offer the trip counter, reset at the last fill-up. */
  allowTrip?: boolean;
  label?: string;
  optional?: boolean;
  error?: string;
}

/** The moment the context is fetched for: now for today, otherwise midday of that day. */
function momentFor(date: string, now: Date): Date {
  if (!date || date === toDateInputValue(now)) return now;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

const toneClass: Record<Assessment['level'], string> = {
  ok: 'text-muted-foreground',
  warn: 'text-warning',
  error: 'text-destructive',
};

/**
 * The mileage box, made for a phone.
 *
 * Type only the end of the number — the start comes from the last reading — or
 * the trip counter at a fill-up, or tap a suggestion, or read it from a photo.
 * Whatever the route, the full reading is spelled out underneath, with how far
 * that is since last time and a warning if it looks like a typo. Nothing is
 * ever filled in without a tap.
 */
export function MileageInput({
  id,
  vehicleId,
  value,
  onChange,
  date,
  excludeSourceId,
  allowTrip = false,
  label = 'Mileage',
  optional = false,
  error,
}: MileageInputProps) {
  // "Now" is fixed when the form opens, so the context is not refetched every render.
  const [openedAt] = useState(() => new Date());
  const at = useMemo(() => momentFor(date, openedAt), [date, openedAt]);
  const atIso = at.toISOString();

  const context = useQuery({
    queryKey: odometerKeys.context(vehicleId, atIso, excludeSourceId),
    queryFn: () => odometerApi.context(vehicleId, atIso, excludeSourceId),
    staleTime: 60_000,
  });
  const ctx = context.data;
  const previousKm = ctx?.previous?.odometerKm ?? null;
  const lastFillKm = ctx?.lastFuelFill?.odometerKm ?? null;
  const tripAvailable = allowTrip && lastFillKm !== null;

  const [mode, setMode] = useState<Mode>('odometer');
  const [raw, setRaw] = useState(() => groupDigits(value));
  const [photo, setPhoto] = useState<PhotoState>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef(value);

  // What the typed text means as a full reading.
  const resolved = useMemo(() => {
    const digits = digitsOnly(raw);
    if (digits === '') return null;
    if (mode === 'trip' && lastFillKm !== null) {
      return { km: fromTrip(Number(digits), lastFillKm), completed: true };
    }
    return completeReading(digits, previousKm);
  }, [raw, mode, lastFillKm, previousKm]);

  // Hand the full reading to the form whenever it changes.
  useEffect(() => {
    const next = resolved ? String(resolved.km) : '';
    if (next !== lastEmitted.current) {
      lastEmitted.current = next;
      onChange(next);
    }
  }, [resolved, onChange]);

  // The form reset or replaced the value itself: show that.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setMode('odometer');
      setRaw(groupDigits(value));
    }
  }, [value]);

  const setFull = (km: number) => {
    setMode('odometer');
    setRaw(groupDigits(String(km)));
  };

  const nudge = (delta: number) => {
    if (!resolved) return;
    setFull(Math.max(0, resolved.km + delta));
  };

  const estimate = ctx ? estimateReading(ctx, at) : null;
  const assessment = resolved && ctx ? assessReading(resolved.km, ctx, at) : null;

  const onPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !ctx) return;
    setPhoto({ kind: 'reading' });
    try {
      const { readPhotoText } = await import('@/lib/odometer/read-photo');
      const candidates = photoCandidates(await readPhotoText(file), ctx, estimate);
      setPhoto(
        candidates.length
          ? { kind: 'found', candidates }
          : {
              kind: 'failed',
              message: "Couldn't find the mileage in that photo. Try closer, without glare, or type it.",
            },
      );
    } catch {
      setPhoto({ kind: 'failed', message: "Couldn't read the photo. Check your connection, or type it." });
    }
  };

  const hintId = `${id}-hint`;
  const placeholder =
    mode === 'trip' ? 'Trip km' : previousKm !== null ? `${String(previousKm).slice(0, -3)}…` : '122700';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {optional ? <span className="text-muted-foreground font-normal"> (optional)</span> : null}
        </Label>
        {tripAvailable ? (
          <div className="flex gap-1.5" role="group" aria-label="What you're reading">
            <ChoiceChip
              className="min-h-7 px-2.5 text-xs"
              selected={mode === 'odometer'}
              onClick={() => {
                setMode('odometer');
                if (resolved) setRaw(groupDigits(String(resolved.km)));
              }}
            >
              Odometer
            </ChoiceChip>
            <ChoiceChip
              className="min-h-7 px-2.5 text-xs"
              selected={mode === 'trip'}
              onClick={() => {
                setMode('trip');
                setRaw(
                  resolved && lastFillKm !== null
                    ? groupDigits(String(Math.max(0, resolved.km - lastFillKm)))
                    : '',
                );
              }}
            >
              Trip since fill-up
            </ChoiceChip>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="next"
            placeholder={placeholder}
            value={raw}
            aria-invalid={Boolean(error) || assessment?.level === 'error'}
            aria-describedby={hintId}
            className="pr-10 text-base tabular-nums"
            onChange={(event) => setRaw(groupDigits(digitsOnly(event.target.value).slice(0, 7)))}
          />
          <span className="text-muted-foreground pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm">
            km
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Read the mileage from a photo of the dashboard"
          disabled={!ctx || photo.kind === 'reading'}
          onClick={() => fileRef.current?.click()}
        >
          {photo.kind === 'reading' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-4" aria-hidden />
          )}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void onPhoto(event)}
        />
      </div>

      <div id={hintId} aria-live="polite" className="space-y-2 text-sm">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : resolved && (resolved.completed || mode === 'trip') ? (
          <p>
            <span className="font-medium tabular-nums">= {resolved.km.toLocaleString('en-GB')} km</span>
            {assessment ? (
              <span className={cn(toneClass[assessment.level])}> · {assessment.message}</span>
            ) : null}
          </p>
        ) : assessment ? (
          <p className={toneClass[assessment.level]}>{assessment.message}</p>
        ) : ctx?.previous ? (
          <p className="text-muted-foreground">
            {mode === 'trip'
              ? `Last fill-up at ${lastFillKm?.toLocaleString('en-GB')} km. Type what the trip counter shows.`
              : `Last reading ${ctx.previous.odometerKm.toLocaleString('en-GB')} km. Typing only the last digits is enough.`}
          </p>
        ) : null}

        {photo.kind === 'reading' ? (
          <p className="text-muted-foreground">Reading the photo… the first time takes a few seconds.</p>
        ) : photo.kind === 'failed' ? (
          <p className="text-warning">{photo.message}</p>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {photo.kind === 'found'
            ? photo.candidates.map((km) => (
                <ChoiceChip
                  key={km}
                  className="min-h-8 text-xs"
                  onClick={() => {
                    setFull(km);
                    setPhoto({ kind: 'idle' });
                  }}
                >
                  From photo: {km.toLocaleString('en-GB')} km
                </ChoiceChip>
              ))
            : null}
          {!resolved && estimate !== null && mode === 'odometer' ? (
            <ChoiceChip className="min-h-8 text-xs" onClick={() => setFull(estimate)}>
              About {estimate.toLocaleString('en-GB')} km?
            </ChoiceChip>
          ) : null}
          {resolved && mode === 'odometer'
            ? [-10, 10, 100].map((delta) => (
                <ChoiceChip
                  key={delta}
                  className="min-h-8 px-2.5 text-xs tabular-nums"
                  aria-label={`${delta > 0 ? 'Add' : 'Take away'} ${Math.abs(delta)} km`}
                  onClick={() => nudge(delta)}
                >
                  {delta > 0 ? `+${delta}` : `−${-delta}`}
                </ChoiceChip>
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
