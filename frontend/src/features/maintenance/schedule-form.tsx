'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { FormField } from '@/features/auth/form-field';
import { ChoiceChip } from '@/features/fuel/choice-chip';
import { ApiError } from '@/lib/api/client';
import { incurredAtFromDate, toDateInputValue } from '@/lib/expenses/format';
import { ALL_TYPES, SCHEDULE_PRESETS, maintenanceLabel } from '@/lib/maintenance/format';
import { maintenanceApi } from '@/lib/maintenance/maintenance-api';
import { type MaintenanceType, type Schedule, type ScheduleInput } from '@/lib/maintenance/types';
import { formatKm } from '@/lib/vehicles/format';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';

interface Values {
  type: MaintenanceType;
  name: string;
  intervalKm: string;
  intervalMonths: string;
  /** Whether the owner knows when it was last done. */
  knowsLast: boolean;
  lastKm: string;
  lastDate: string;
  notifyKm: string;
  notifyDays: string;
}

type Errors = Partial<
  Record<'name' | 'interval' | 'intervalKm' | 'intervalMonths' | 'lastKm' | 'notify', string>
>;

const wholeOrEmpty = (value: string, max: number) => {
  if (value.trim() === '') return true;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max;
};

function validate(values: Values): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) errors.name = 'Give it a name';
  if (!values.intervalKm.trim() && !values.intervalMonths.trim()) {
    errors.interval = 'Set a distance, a time, or both — whichever comes first makes it due';
  }
  if (!wholeOrEmpty(values.intervalKm, 1_000_000) || values.intervalKm.trim() === '0') {
    errors.intervalKm = 'Whole kilometres';
  }
  if (!wholeOrEmpty(values.intervalMonths, 240) || values.intervalMonths.trim() === '0') {
    errors.intervalMonths = 'Whole months';
  }
  if (values.knowsLast && !wholeOrEmpty(values.lastKm, 5_000_000)) errors.lastKm = 'Whole kilometres';
  if (!wholeOrEmpty(values.notifyKm, 100_000) || !wholeOrEmpty(values.notifyDays, 365)) {
    errors.notify = 'Whole kilometres and days';
  }
  return errors;
}

const orNull = (value: string) => (value.trim() === '' ? null : Number(value));

export interface ScheduleFormProps {
  vehicleId: string;
  currentOdometerKm: number;
  schedule?: Schedule;
  onDone: () => void;
}

/**
 * Setting up a recurring service.
 *
 * Common services are one tap: the chip fills in the name and a typical
 * interval, which the owner then checks against their handbook. "When was it
 * last done" is optional and says so — without it the schedule waits for its
 * first logged service rather than guessing a starting point.
 */
export function ScheduleForm({ vehicleId, currentOdometerKm, schedule, onDone }: ScheduleFormProps) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [showWindows, setShowWindows] = useState(false);
  const [custom, setCustom] = useState(Boolean(schedule));

  const [values, setValues] = useState<Values>(() => ({
    type: schedule?.type ?? 'OIL_CHANGE',
    name: schedule?.name ?? '',
    intervalKm: schedule?.intervalKm ? String(schedule.intervalKm) : '',
    intervalMonths: schedule?.intervalMonths ? String(schedule.intervalMonths) : '',
    knowsLast: Boolean(schedule?.lastServiceOdometerKm ?? schedule?.lastServiceAt),
    lastKm: schedule?.lastServiceOdometerKm != null ? String(schedule.lastServiceOdometerKm) : '',
    lastDate: schedule?.lastServiceAt ? toDateInputValue(new Date(schedule.lastServiceAt)) : '',
    notifyKm: String(schedule?.notifyBeforeKm ?? 1000),
    notifyDays: String(schedule?.notifyBeforeDays ?? 30),
  }));
  const [preset, setPreset] = useState<MaintenanceType | null>(null);

  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));

  const choosePreset = (type: MaintenanceType) => {
    const found = SCHEDULE_PRESETS.find((p) => p.type === type)!;
    setPreset(type);
    setCustom(false);
    set({
      type,
      name: found.name,
      intervalKm: found.intervalKm ? String(found.intervalKm) : '',
      intervalMonths: found.intervalMonths ? String(found.intervalMonths) : '',
    });
  };

  const build = (): ScheduleInput => ({
    type: values.type,
    name: values.name.trim(),
    intervalKm: orNull(values.intervalKm),
    intervalMonths: orNull(values.intervalMonths),
    lastServiceOdometerKm: values.knowsLast ? orNull(values.lastKm) : null,
    lastServiceAt: values.knowsLast && values.lastDate ? incurredAtFromDate(values.lastDate) : null,
    notifyBeforeKm: Number(values.notifyKm || 0),
    notifyBeforeDays: Number(values.notifyDays || 0),
  });

  const save = useMutation({
    mutationFn: () => {
      const input = build();
      if (schedule) return maintenanceApi.updateSchedule(schedule.id, input);
      // A create has nothing to clear: nulls are simply left out.
      const created = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== null),
      ) as ScheduleInput;
      return maintenanceApi.createSchedule(vehicleId, created);
    },
    onSuccess: async () => {
      toast.success(schedule ? 'Schedule updated' : 'Schedule added');
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      onDone();
    },
    onError: (failure: unknown) => {
      setServerError(failure instanceof ApiError ? failure.message : 'Could not save that schedule.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate();
  };

  const idPrefix = schedule ? `schedule-${schedule.id}` : 'new-schedule';
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {schedule ? null : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What needs doing</legend>
          <div className="flex flex-wrap gap-2">
            {SCHEDULE_PRESETS.map((option) => (
              <ChoiceChip
                key={option.type}
                selected={preset === option.type && !custom}
                onClick={() => choosePreset(option.type)}
              >
                {option.name}
              </ChoiceChip>
            ))}
            <ChoiceChip
              selected={custom}
              onClick={() => {
                setCustom(true);
                setPreset(null);
                set({ type: 'OTHER', name: '', intervalKm: '', intervalMonths: '' });
              }}
            >
              Something else
            </ChoiceChip>
          </div>
          {preset ? (
            <p className="text-muted-foreground text-xs">
              Typical intervals, filled in to save typing. Your handbook has the right ones for this car.
            </p>
          ) : null}
        </fieldset>
      )}

      {preset || custom ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id={id('name')}
              label="Name"
              placeholder="Oil and filter"
              maxLength={120}
              value={values.name}
              error={errors.name}
              onChange={(event) => set({ name: event.target.value })}
            />
            {custom ? (
              <div className="space-y-2">
                <Label htmlFor={id('type')}>Kind of job</Label>
                <NativeSelect
                  id={id('type')}
                  value={values.type}
                  onChange={(event) => set({ type: event.target.value as MaintenanceType })}
                >
                  {ALL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {maintenanceLabel(type)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Every</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                id={id('interval-km')}
                label="Kilometres"
                type="number"
                inputMode="numeric"
                placeholder="10000"
                value={values.intervalKm}
                error={errors.intervalKm}
                onChange={(event) => set({ intervalKm: event.target.value })}
              />
              <FormField
                id={id('interval-months')}
                label="Months"
                type="number"
                inputMode="numeric"
                placeholder="12"
                value={values.intervalMonths}
                error={errors.intervalMonths}
                onChange={(event) => set({ intervalMonths: event.target.value })}
              />
            </div>
            {errors.interval ? (
              <p role="alert" className="text-destructive text-sm">
                {errors.interval}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Whichever comes first. Leave one empty to track only the other.
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">When was it last done?</legend>
            <div className="flex flex-wrap gap-2">
              <ChoiceChip selected={!values.knowsLast} onClick={() => set({ knowsLast: false })}>
                Not sure
              </ChoiceChip>
              <ChoiceChip selected={values.knowsLast} onClick={() => set({ knowsLast: true })}>
                I know
              </ChoiceChip>
            </div>
            {values.knowsLast ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  id={id('last-km')}
                  label="At (km)"
                  type="number"
                  inputMode="numeric"
                  placeholder={String(currentOdometerKm)}
                  value={values.lastKm}
                  error={errors.lastKm}
                  hint={`Now at ${formatKm(currentOdometerKm)}`}
                  onChange={(event) => set({ lastKm: event.target.value })}
                />
                <FormField
                  id={id('last-date')}
                  label="On"
                  type="date"
                  max={toDateInputValue(new Date())}
                  value={values.lastDate}
                  onChange={(event) => set({ lastDate: event.target.value })}
                />
              </div>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {values.knowsLast
                ? 'Either is enough. Services you log from now on take over from this.'
                : 'Tracking starts from the first time you log it.'}
            </p>
          </fieldset>

          {showWindows ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Warn me</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  id={id('notify-km')}
                  label="Kilometres before"
                  type="number"
                  inputMode="numeric"
                  value={values.notifyKm}
                  onChange={(event) => set({ notifyKm: event.target.value })}
                />
                <FormField
                  id={id('notify-days')}
                  label="Days before"
                  type="number"
                  inputMode="numeric"
                  value={values.notifyDays}
                  onChange={(event) => set({ notifyDays: event.target.value })}
                />
              </div>
              {errors.notify ? (
                <p role="alert" className="text-destructive text-sm">
                  {errors.notify}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  &ldquo;Due soon&rdquo; starts this early. Once reached, it stays &ldquo;due&rdquo; for the
                  same distance or time before it counts as overdue.
                </p>
              )}
            </fieldset>
          ) : (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setShowWindows(true)}
            >
              Warn me {values.notifyKm} km or {values.notifyDays} days before · change
            </Button>
          )}
        </>
      ) : null}

      {serverError ? (
        <p role="alert" className="text-destructive text-sm">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending || !(preset || custom)}>
          {save.isPending ? 'Saving…' : schedule ? 'Save changes' : 'Add schedule'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
