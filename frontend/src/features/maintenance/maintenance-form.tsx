'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, History } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormField } from '@/features/auth/form-field';
import { MileageInput } from '@/features/vehicles/mileage-input';
import { AttachmentPicker } from '@/features/expenses/attachment-picker';
import { useAttachFiles } from '@/features/expenses/use-attach-files';
import { ChoiceChip } from '@/features/fuel/choice-chip';
import { ApiError } from '@/lib/api/client';
import { IdempotencyKeys } from '@/lib/api/idempotency';
import { attachmentProblem, formatFileSize } from '@/lib/documents/files';
import { incurredAtFromDate, toDateInputValue } from '@/lib/expenses/format';
import {
  ALL_TYPES,
  COMMON_TYPES,
  isFree,
  maintenanceLabel,
  matchingSchedule,
  normaliseCost,
  sumCosts,
} from '@/lib/maintenance/format';
import { maintenanceApi, maintenanceKeys } from '@/lib/maintenance/maintenance-api';
import {
  type CreateRecordInput,
  type MaintenanceRecord,
  type MaintenanceType,
  type UpdateRecordInput,
} from '@/lib/maintenance/types';
import { formatMoney } from '@/lib/vehicles/format';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';

interface Values {
  type: MaintenanceType;
  /** '' for "doesn't count toward a schedule". */
  scheduleId: string;
  date: string;
  odometerKm: string;
  total: string;
  parts: string;
  labor: string;
  serviceProvider: string;
  description: string;
  notes: string;
}

type Errors = Partial<Record<'date' | 'odometerKm' | 'total' | 'parts' | 'labor', string>>;

function validate(values: Values, split: boolean, totalTyped: boolean): Errors {
  const errors: Errors = {};
  if (!values.date) errors.date = 'Pick a date';

  const km = Number(values.odometerKm);
  if (values.odometerKm.trim() === '') errors.odometerKm = 'Enter the mileage on the invoice or dashboard';
  else if (!Number.isInteger(km) || km < 0 || km > 5_000_000) errors.odometerKm = 'Whole kilometres';

  if (split) {
    if (values.parts.trim() && !normaliseCost(values.parts))
      errors.parts = 'An amount, up to 3 decimal places';
    if (values.labor.trim() && !normaliseCost(values.labor))
      errors.labor = 'An amount, up to 3 decimal places';
  }
  const splitGiven = split && (values.parts.trim() !== '' || values.labor.trim() !== '');
  if (!normaliseCost(values.total) && !(splitGiven && !totalTyped)) {
    errors.total = 'Enter what you paid — 0 if it was free';
  }
  return errors;
}

export interface MaintenanceFormProps {
  vehicleId: string;
  currency: string;
  /** Present when editing. */
  record?: MaintenanceRecord;
  /** From a schedule's "Log it": the job and the schedule it satisfies. */
  draft?: { type: MaintenanceType; scheduleId: string };
  onDone: () => void;
}

/**
 * Logging a service, as it appears on the invoice.
 *
 * The job and the schedule it counts toward are chips, with the one schedule
 * that matches the job already chosen — so logging an oil change restarts the
 * oil-change countdown without anyone having to think about it. Most invoices
 * show only a total, so that is the one field asked for; parts and labour are
 * a tap away for those that split them.
 *
 * As on the fuel form, the mileage is a hint and never prefilled.
 */
export function MaintenanceForm({ vehicleId, currency, record, draft, onDone }: MaintenanceFormProps) {
  const queryClient = useQueryClient();
  const keys = useRef(new IdempotencyKeys());
  const [receipts, setReceipts] = useState<File[]>([]);
  const { attach, progress, busy: uploading } = useAttachFiles(vehicleId);
  const [serverError, setServerError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [showNotes, setShowNotes] = useState(Boolean(record?.notes));

  const initialType = record?.type ?? draft?.type ?? 'OIL_CHANGE';
  const [showAllTypes, setShowAllTypes] = useState(!COMMON_TYPES.includes(initialType));
  const [split, setSplit] = useState(Boolean(record?.partsCost ?? record?.laborCost));

  const [values, setValues] = useState<Values>(() => ({
    type: initialType,
    scheduleId: record ? (record.scheduleId ?? '') : (draft?.scheduleId ?? ''),
    date: toDateInputValue(record ? new Date(record.performedAt) : new Date()),
    odometerKm: record ? String(record.odometerKm) : '',
    total: record?.totalCost ?? '',
    parts: record?.partsCost ?? '',
    labor: record?.laborCost ?? '',
    serviceProvider: record?.serviceProvider ?? '',
    description: record?.description ?? '',
    notes: record?.notes ?? '',
  }));
  // Once the person picks a schedule (or none), a change of job no longer re-picks it.
  const [scheduleTouched, setScheduleTouched] = useState(Boolean(record ?? draft));
  // A total typed by hand is kept; one worked out from parts and labour follows
  // them. A saved record with both halves of the split had its total added up.
  const [totalTyped, setTotalTyped] = useState(Boolean(record) && !(record?.partsCost && record.laborCost));

  const schedules = useQuery({
    queryKey: maintenanceKeys.schedules(vehicleId),
    queryFn: () => maintenanceApi.schedules(vehicleId),
  });
  const suggestions = useQuery({
    queryKey: maintenanceKeys.suggestions(vehicleId),
    queryFn: () => maintenanceApi.suggestions(vehicleId),
  });

  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));
  const setOdometer = useCallback(
    (odometerKm: string) => setValues((current) => ({ ...current, odometerKm })),
    [],
  );

  /*
   * The matching schedule, applied during render once schedules arrive and
   * only while nobody has chosen, so it fills the blank without overriding.
   */
  const matched = schedules.data ? matchingSchedule(values.type, schedules.data) : null;
  if (!scheduleTouched && schedules.data && values.scheduleId !== (matched?.id ?? '')) {
    set({ scheduleId: matched?.id ?? '' });
  }

  const chooseType = (type: MaintenanceType) => set({ type });

  const chooseSchedule = (scheduleId: string) => {
    setScheduleTouched(true);
    set({ scheduleId });
  };

  const typeSplit = (field: 'parts' | 'labor', value: string) => {
    setValues((current) => {
      const next = { ...current, [field]: value };
      const sum = sumCosts(next.parts || '0', next.labor || '0');
      return !totalTyped && sum && (next.parts.trim() || next.labor.trim()) ? { ...next, total: sum } : next;
    });
  };

  const free = values.total.trim() !== '' && isFree(values.total);

  const buildCreate = (): CreateRecordInput => {
    const parts = split ? normaliseCost(values.parts) : null;
    const labor = split ? normaliseCost(values.labor) : null;
    return {
      type: values.type,
      performedAt: incurredAtFromDate(values.date),
      odometerKm: Number(values.odometerKm),
      ...(values.scheduleId ? { scheduleId: values.scheduleId } : {}),
      ...(parts ? { partsCost: parts } : {}),
      ...(labor ? { laborCost: labor } : {}),
      // A worked-out total is left to the server to add up, so the two can never disagree.
      ...(totalTyped || !(parts ?? labor) ? { totalCost: normaliseCost(values.total)! } : {}),
      ...(values.serviceProvider.trim() ? { serviceProvider: values.serviceProvider.trim() } : {}),
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
      ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
    };
  };

  const buildUpdate = (original: MaintenanceRecord): UpdateRecordInput => {
    const originalDate = toDateInputValue(new Date(original.performedAt));
    const parts = split ? normaliseCost(values.parts) : null;
    const labor = split ? normaliseCost(values.labor) : null;
    return {
      type: values.type,
      ...(values.date === originalDate ? {} : { performedAt: incurredAtFromDate(values.date) }),
      odometerKm: Number(values.odometerKm),
      scheduleId: values.scheduleId || null,
      partsCost: parts,
      laborCost: labor,
      ...(totalTyped || !(parts && labor) ? { totalCost: normaliseCost(values.total)! } : {}),
      serviceProvider: values.serviceProvider.trim() || null,
      description: values.description.trim() || null,
      notes: values.notes.trim() || null,
    };
  };

  const save = useMutation({
    mutationFn: () => {
      if (record) return maintenanceApi.update(record.id, buildUpdate(record));
      const { key, payload } = keys.current.submissionFor({ values, split, totalTyped }, buildCreate);
      return maintenanceApi.create(vehicleId, payload, key);
    },
    onSuccess: async (saved) => {
      keys.current.reset();
      setServerError(null);
      toast.success(record ? 'Service updated' : 'Service logged');
      // The log, the schedules, the ledger and the mileage all moved.
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      if (!record && saved.expenseId && receipts.length > 0) await attach(saved.expenseId, receipts);
      onDone();
    },
    onError: (failure: unknown) => {
      // A mileage that does not fit the timeline, or costs that do not add up:
      // the server's message names which.
      setServerError(failure instanceof ApiError ? failure.message : 'Could not save that service.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(values, split, totalTyped);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate();
  };

  const idPrefix = record ? `service-${record.id}` : 'new-service';
  const id = (field: string) => `${idPrefix}-${field}`;

  const types = showAllTypes ? ALL_TYPES : COMMON_TYPES;
  const active = (schedules.data ?? []).filter((s) => s.isActive || s.id === values.scheduleId);
  const providers = suggestions.data?.recentProviders ?? [];

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What was done</legend>
        <div className="flex flex-wrap gap-2">
          {types.map((type) => (
            <ChoiceChip key={type} selected={values.type === type} onClick={() => chooseType(type)}>
              {maintenanceLabel(type)}
            </ChoiceChip>
          ))}
          {showAllTypes ? null : <ChoiceChip onClick={() => setShowAllTypes(true)}>More…</ChoiceChip>}
        </div>
      </fieldset>

      {active.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Counts toward</legend>
          <div className="flex flex-wrap gap-2">
            {active.map((schedule) => (
              <ChoiceChip
                key={schedule.id}
                selected={values.scheduleId === schedule.id}
                onClick={() => chooseSchedule(schedule.id)}
              >
                <CalendarClock className="size-3.5" aria-hidden />
                {schedule.name}
              </ChoiceChip>
            ))}
            <ChoiceChip selected={values.scheduleId === ''} onClick={() => chooseSchedule('')}>
              No schedule
            </ChoiceChip>
          </div>
          <p className="text-muted-foreground text-xs">
            {values.scheduleId
              ? 'Its countdown restarts from this service.'
              : 'A one-off: no schedule restarts.'}
          </p>
        </fieldset>
      ) : null}

      <div className="space-y-3">
        <FormField
          id={id('total')}
          label={`Total paid (${currency})`}
          inputMode="decimal"
          placeholder="180"
          autoComplete="off"
          className="h-11 text-lg"
          value={values.total}
          error={errors.total}
          hint={
            !totalTyped && split && values.total
              ? 'Parts + labour'
              : free
                ? 'Free: it will not appear in your costs'
                : undefined
          }
          onChange={(event) => {
            setTotalTyped(event.target.value.trim() !== '');
            set({ total: event.target.value });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceChip
            selected={free && totalTyped}
            onClick={() => {
              setTotalTyped(true);
              setSplit(false);
              set({ total: '0', parts: '', labor: '' });
            }}
          >
            Free · under warranty
          </ChoiceChip>
          {split ? null : (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setSplit(true)}
            >
              Split parts and labour
            </Button>
          )}
        </div>
        {split ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id={id('parts')}
              label="Parts"
              inputMode="decimal"
              placeholder="120"
              autoComplete="off"
              value={values.parts}
              error={errors.parts}
              onChange={(event) => typeSplit('parts', event.target.value)}
            />
            <FormField
              id={id('labor')}
              label="Labour"
              inputMode="decimal"
              placeholder="60"
              autoComplete="off"
              value={values.labor}
              error={errors.labor}
              onChange={(event) => typeSplit('labor', event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor={id('provider')}>Workshop</Label>
        <Input
          id={id('provider')}
          placeholder="Garage, dealer, or yourself"
          autoComplete="off"
          maxLength={120}
          value={values.serviceProvider}
          onChange={(event) => set({ serviceProvider: event.target.value })}
        />
        {providers.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {providers.map((name) => (
              <ChoiceChip
                key={name}
                selected={values.serviceProvider === name}
                onClick={() => set({ serviceProvider: values.serviceProvider === name ? '' : name })}
              >
                <History className="size-3.5" aria-hidden />
                {name}
              </ChoiceChip>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id={id('date')}
          label="Date"
          type="date"
          max={toDateInputValue(new Date())}
          value={values.date}
          error={errors.date}
          onChange={(event) => set({ date: event.target.value })}
        />
        <MileageInput
          id={id('odometer')}
          vehicleId={vehicleId}
          value={values.odometerKm}
          onChange={setOdometer}
          date={values.date}
          excludeSourceId={record?.id}
          error={errors.odometerKm}
        />
      </div>

      <FormField
        id={id('description')}
        label="Details"
        placeholder="5W-30, Total Quartz · front pads only"
        autoComplete="off"
        maxLength={200}
        value={values.description}
        hint="Optional. Shown in the log and your costs."
        onChange={(event) => set({ description: event.target.value })}
      />

      {showNotes ? (
        <div className="space-y-2">
          <Label htmlFor={id('notes')}>Notes</Label>
          <textarea
            id={id('notes')}
            rows={2}
            maxLength={2000}
            className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            value={values.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={() => setShowNotes(true)}
        >
          Add a note
        </Button>
      )}

      {record || free ? null : (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Invoice <span className="text-muted-foreground font-normal">· optional</span>
          </p>
          {receipts.length > 0 ? (
            <ul className="space-y-1">
              {receipts.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {file.name}{' '}
                    <span className="text-muted-foreground text-xs">{formatFileSize(file.size)}</span>
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    aria-label={`Don't attach ${file.name}`}
                    onClick={() => setReceipts((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <AttachmentPicker
            label="Add photo or PDF"
            disabled={save.isPending || uploading}
            onFiles={(files) => {
              const accepted = files.filter((file) => {
                const problem = attachmentProblem(file);
                if (problem) toast.error(problem);
                return problem === null;
              });
              setReceipts((current) => [...current, ...accepted]);
            }}
          />
        </div>
      )}

      {serverError ? (
        <p role="alert" className="text-destructive text-sm">
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending || uploading}>
          {uploading ? 'Uploading…' : save.isPending ? 'Saving…' : record ? 'Save changes' : 'Log service'}
        </Button>
        <Button type="button" variant="ghost" disabled={uploading} onClick={onDone}>
          Cancel
        </Button>
        {!record && values.total && !free && normaliseCost(values.total) ? (
          <p className="text-muted-foreground text-xs">
            Adds {formatMoney(normaliseCost(values.total), currency)} to your costs
          </p>
        ) : null}
        {progress ? (
          <p className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
            {progress.fileName} · {Math.round(progress.fraction * 100)}%
          </p>
        ) : null}
      </div>
    </form>
  );
}
