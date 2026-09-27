'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { FormField } from '@/features/auth/form-field';
import { ApiError } from '@/lib/api/client';
import { IdempotencyKeys } from '@/lib/api/idempotency';
import { expensesApi } from '@/lib/expenses/expenses-api';
import { AMOUNT_PATTERN, categoryLabel, incurredAtFromDate, toDateInputValue } from '@/lib/expenses/format';
import {
  EXPENSE_CATEGORIES,
  type CreateExpenseInput,
  type Expense,
  type UpdateExpenseInput,
} from '@/lib/expenses/types';
import { optionalNumber } from '@/lib/forms/optional-number';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';

/** Mirrors the server's DTO; the API validates all of it again. */
const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  // Kept as a string all the way to the API — parsing money to a float here
  // would round it before it reached the exact numeric column.
  amount: z.string().trim().regex(AMOUNT_PATTERN, 'Enter a positive amount, with up to 3 decimal places'),
  date: z.string().min(1, 'Pick a date'),
  odometerKm: optionalNumber((n) => n.int('Whole kilometres').min(0).max(5_000_000)),
  vendor: z.string().trim().max(120),
  description: z.string().trim().max(200),
  notes: z.string().trim().max(2000, 'Keep notes under 2,000 characters'),
});

type ExpenseValues = z.input<typeof expenseSchema>;
type ParsedExpense = z.output<typeof expenseSchema>;

function defaultsFor(expense?: Expense): ExpenseValues {
  return {
    category: expense?.category ?? 'FUEL',
    amount: expense?.amount ?? '',
    date: toDateInputValue(expense ? new Date(expense.incurredAt) : new Date()),
    odometerKm: expense?.odometerKm?.toString() ?? '',
    vendor: expense?.vendor ?? '',
    description: expense?.description ?? '',
    notes: expense?.notes ?? '',
  };
}

function toCreatePayload(values: ParsedExpense): CreateExpenseInput {
  return {
    category: values.category,
    amount: values.amount,
    incurredAt: incurredAtFromDate(values.date),
    ...(values.odometerKm === undefined ? {} : { odometerKm: values.odometerKm }),
    ...(values.vendor ? { vendor: values.vendor } : {}),
    ...(values.description ? { description: values.description } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  };
}

/**
 * Everything the form shows, with blanks sent as null so clearing a box clears
 * the field.
 *
 * The date is sent only if it changed. Re-deriving it on every save would move
 * the expense to midday of the same day — and with it, its odometer reading,
 * which the server would then have to re-validate for no reason.
 */
function toUpdatePayload(values: ParsedExpense, original: Expense): UpdateExpenseInput {
  const originalDate = toDateInputValue(new Date(original.incurredAt));

  return {
    category: values.category,
    amount: values.amount,
    ...(values.date === originalDate ? {} : { incurredAt: incurredAtFromDate(values.date) }),
    odometerKm: values.odometerKm ?? null,
    vendor: values.vendor || null,
    description: values.description || null,
    notes: values.notes || null,
  };
}

export interface ExpenseFormProps {
  vehicleId: string;
  /** Present when editing. */
  expense?: Expense;
  onDone: () => void;
}

export function ExpenseForm({ vehicleId, expense, onDone }: ExpenseFormProps) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const keys = useRef(new IdempotencyKeys());

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: defaultsFor(expense),
  });

  const save = useMutation({
    mutationFn: (values: ParsedExpense) => {
      if (expense) return expensesApi.update(expense.id, toUpdatePayload(values, expense));

      // Keyed by what was entered, with the payload frozen on the first
      // attempt: a retry of an expense dated today must resend the original
      // timestamp, not a new one that would make it a different request.
      const { key, payload } = keys.current.submissionFor(values, () => toCreatePayload(values));
      return expensesApi.create(vehicleId, payload, key);
    },
    onSuccess: async () => {
      keys.current.reset();
      setServerError(null);
      toast.success(expense ? 'Expense updated' : 'Expense added');
      // The ledger, the vehicle's headline mileage and its timeline can all
      // have moved, and every one of them sits under the vehicle's keys.
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      onDone();
    },
    onError: (failure: unknown) => {
      // A 400 here is usually the mileage not fitting the timeline, and the
      // server's message names the reading in the way.
      setServerError(failure instanceof ApiError ? failure.message : 'Could not save that expense.');
    },
  });

  const idPrefix = expense ? `expense-${expense.id}` : 'new-expense';
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <form
      onSubmit={handleSubmit((values) => save.mutate(values as ParsedExpense))}
      className="space-y-4"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={id('category')}>Category</Label>
          <NativeSelect id={id('category')} {...register('category')}>
            {EXPENSE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value)}
              </option>
            ))}
          </NativeSelect>
        </div>

        <FormField
          id={id('amount')}
          label="Amount"
          inputMode="decimal"
          placeholder="45.500"
          autoComplete="off"
          error={errors.amount?.message}
          {...register('amount')}
        />

        <FormField
          id={id('date')}
          label="Date"
          type="date"
          max={toDateInputValue(new Date())}
          error={errors.date?.message}
          {...register('date')}
        />

        <FormField
          id={id('odometerKm')}
          label="Mileage"
          type="number"
          inputMode="numeric"
          placeholder="121500"
          hint="Optional. Also added to the mileage timeline."
          error={errors.odometerKm?.message}
          {...register('odometerKm')}
        />

        <FormField
          id={id('vendor')}
          label="Where"
          placeholder="Garage, station, insurer…"
          error={errors.vendor?.message}
          {...register('vendor')}
        />

        <FormField
          id={id('description')}
          label="What for"
          placeholder="Annual cover"
          error={errors.description?.message}
          {...register('description')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={id('notes')}>Notes</Label>
        <textarea
          id={id('notes')}
          rows={2}
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={errors.notes ? id('notes-error') : undefined}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          {...register('notes')}
        />
        {errors.notes ? (
          <p id={id('notes-error')} role="alert" className="text-destructive text-sm">
            {errors.notes.message}
          </p>
        ) : null}
      </div>

      {serverError ? (
        <p role="alert" className="text-destructive text-sm">
          {serverError}
        </p>
      ) : null}

      <div className="flex gap-2">
        {/* Disabled while pending, so a double-tap cannot send two requests. */}
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
