'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/features/auth/form-field';
import { ChoiceChip } from '@/features/fuel/choice-chip';
import { ApiError } from '@/lib/api/client';
import { REMINDER_PRESETS, todayInputValue } from '@/lib/reminders/format';
import { remindersApi } from '@/lib/reminders/reminders-api';
import { type Reminder, type ReminderInput, type ReminderType } from '@/lib/reminders/types';
import { formatKm } from '@/lib/vehicles/format';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';

interface Values {
  type: ReminderType;
  title: string;
  dueDate: string;
  withKm: boolean;
  dueKm: string;
  repeat: number | null;
  notifyDays: number;
  description: string;
}

type Errors = Partial<Record<'title' | 'due' | 'dueKm', string>>;

const REPEATS: { label: string; months: number | null }[] = [
  { label: 'Just once', months: null },
  { label: 'Every month', months: 1 },
  { label: 'Every year', months: 12 },
];
const WARN_DAYS = [7, 14, 30, 60];

function validate(values: Values): Errors {
  const errors: Errors = {};
  if (!values.title.trim()) errors.title = 'Say what it is';
  const km = values.dueKm.trim();
  if (values.withKm && km !== '' && !(Number.isInteger(Number(km)) && Number(km) >= 0)) {
    errors.dueKm = 'Whole kilometres';
  }
  if (!values.dueDate && !(values.withKm && km !== '')) errors.due = 'Give it a date, a mileage, or both';
  else if (values.repeat && !values.dueDate) errors.due = 'A repeating reminder needs a date to count from';
  return errors;
}

export interface ReminderFormProps {
  vehicleId: string;
  currentOdometerKm: number;
  reminder?: Reminder;
  onDone: () => void;
}

/**
 * Adding something that falls due: a renewal, a payment, the end of a warranty.
 *
 * The common ones are one tap, and fill in how often they repeat and how early
 * to warn. The date itself is left for the owner — a guessed renewal date would
 * be wrong and look right.
 */
export function ReminderForm({ vehicleId, currentOdometerKm, reminder, onDone }: ReminderFormProps) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [chosen, setChosen] = useState<ReminderType | 'CUSTOM' | null>(reminder ? 'CUSTOM' : null);

  const [values, setValues] = useState<Values>(() => ({
    type: reminder?.type ?? 'OTHER',
    title: reminder?.title ?? '',
    dueDate: reminder?.dueDate ?? '',
    withKm: reminder?.dueOdometerKm != null,
    dueKm: reminder?.dueOdometerKm != null ? String(reminder.dueOdometerKm) : '',
    repeat: reminder?.repeatEveryMonths ?? null,
    notifyDays: reminder?.notifyBeforeDays ?? 30,
    description: reminder?.description ?? '',
  }));
  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));

  const choose = (type: ReminderType | 'CUSTOM') => {
    setChosen(type);
    const preset = REMINDER_PRESETS.find((p) => p.type === type);
    set(
      preset
        ? {
            type: preset.type,
            title: preset.title,
            repeat: preset.repeatEveryMonths,
            withKm: preset.withKm,
            notifyDays: preset.notifyBeforeDays,
          }
        : { type: 'OTHER', title: '', repeat: null, withKm: false, notifyDays: 30 },
    );
  };

  const build = (): ReminderInput => ({
    type: values.type,
    title: values.title.trim(),
    description: values.description.trim() || null,
    dueDate: values.dueDate || null,
    dueOdometerKm: values.withKm && values.dueKm.trim() !== '' ? Number(values.dueKm) : null,
    repeatEveryMonths: values.repeat,
    notifyBeforeDays: values.notifyDays,
  });

  const save = useMutation({
    mutationFn: () => {
      const input = build();
      if (reminder) return remindersApi.update(reminder.id, input);
      // A create has nothing to clear: nulls are simply left out.
      return remindersApi.create(
        vehicleId,
        Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null)) as ReminderInput,
      );
    },
    onSuccess: async () => {
      toast.success(reminder ? 'Reminder updated' : 'Reminder added');
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      onDone();
    },
    onError: (failure: unknown) => {
      setServerError(failure instanceof ApiError ? failure.message : 'Could not save that reminder.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate();
  };

  const id = (field: string) => `${reminder ? `reminder-${reminder.id}` : 'new-reminder'}-${field}`;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {reminder ? null : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What is it</legend>
          <div className="flex flex-wrap gap-2">
            {REMINDER_PRESETS.map((preset) => (
              <ChoiceChip
                key={preset.type}
                selected={chosen === preset.type}
                onClick={() => choose(preset.type)}
              >
                {preset.title}
              </ChoiceChip>
            ))}
            <ChoiceChip selected={chosen === 'CUSTOM'} onClick={() => choose('CUSTOM')}>
              Something else
            </ChoiceChip>
          </div>
        </fieldset>
      )}

      {chosen ? (
        <>
          <FormField
            id={id('title')}
            label="Name"
            placeholder="Parking permit"
            maxLength={120}
            value={values.title}
            error={errors.title}
            onChange={(event) => set({ title: event.target.value })}
          />

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">When is it due?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                id={id('date')}
                label="On"
                type="date"
                min={reminder ? undefined : todayInputValue()}
                value={values.dueDate}
                onChange={(event) => set({ dueDate: event.target.value })}
              />
              {values.withKm ? (
                <FormField
                  id={id('km')}
                  label="Or at (km)"
                  type="number"
                  inputMode="numeric"
                  value={values.dueKm}
                  error={errors.dueKm}
                  hint={`Now at ${formatKm(currentOdometerKm)}`}
                  onChange={(event) => set({ dueKm: event.target.value })}
                />
              ) : (
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => set({ withKm: true })}
                  >
                    Also at a mileage
                  </Button>
                </div>
              )}
            </div>
            {errors.due ? (
              <p role="alert" className="text-destructive text-sm">
                {errors.due}
              </p>
            ) : values.withKm ? (
              <p className="text-muted-foreground text-xs">Whichever comes first.</p>
            ) : null}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Repeats</legend>
            <div className="flex flex-wrap gap-2">
              {REPEATS.map((option) => (
                <ChoiceChip
                  key={option.label}
                  selected={values.repeat === option.months}
                  onClick={() => set({ repeat: option.months })}
                >
                  {option.label}
                </ChoiceChip>
              ))}
            </div>
            {values.repeat ? (
              <p className="text-muted-foreground text-xs">
                Marking it done sets up the next one, counted from this due date.
              </p>
            ) : null}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Warn me</legend>
            <div className="flex flex-wrap gap-2">
              {WARN_DAYS.map((days) => (
                <ChoiceChip
                  key={days}
                  selected={values.notifyDays === days}
                  onClick={() => set({ notifyDays: days })}
                >
                  {days} days before
                </ChoiceChip>
              ))}
            </div>
          </fieldset>

          <FormField
            id={id('description')}
            label="Note (optional)"
            placeholder="Policy number, who to call"
            maxLength={500}
            value={values.description}
            onChange={(event) => set({ description: event.target.value })}
          />
        </>
      ) : null}

      {serverError ? (
        <p role="alert" className="text-destructive text-sm">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending || !chosen}>
          {save.isPending ? 'Saving…' : reminder ? 'Save changes' : 'Add reminder'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
