'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, LoaderCircle, MapPin } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormField } from '@/features/auth/form-field';
import { MileageInput } from '@/features/vehicles/mileage-input';
import { AttachmentPicker } from '@/features/expenses/attachment-picker';
import { useAttachFiles } from '@/features/expenses/use-attach-files';
import { ApiError } from '@/lib/api/client';
import { IdempotencyKeys } from '@/lib/api/idempotency';
import { attachmentProblem, formatFileSize } from '@/lib/documents/files';
import { incurredAtFromDate, toDateInputValue } from '@/lib/expenses/format';
import { fuelApi, fuelKeys } from '@/lib/fuel/fuel-api';
import { LIKELY_MISSED_FILL_KM, PUMP_FUELS, defaultPumpFuel, formatDistance } from '@/lib/fuel/format';
import { defaultPrice, officialPricesNeedChecking } from '@/lib/fuel/price-source';
import { litresFor, normaliseDecimal, priceFor, totalFor } from '@/lib/fuel/pump-math';
import { type CreateFuelInput, type FuelEntry, type UpdateFuelInput } from '@/lib/fuel/types';
import { formatKm, formatMoney, fuelLabel } from '@/lib/vehicles/format';
import { type FuelType } from '@/lib/vehicles/types';
import { vehicleKeys } from '@/lib/vehicles/vehicles-api';
import { ChoiceChip } from './choice-chip';
import { useStationFinder } from './use-station-finder';

/** Which of litres and total the person typed, rather than had worked out. */
interface Typed {
  litres: boolean;
  total: boolean;
}

interface Values {
  date: string;
  odometerKm: string;
  fuelType: FuelType;
  litres: string;
  total: string;
  price: string;
  isFullTank: boolean;
  isMissedFill: boolean;
  stationName: string;
  notes: string;
}

type Errors = Partial<Record<'date' | 'odometerKm' | 'litres' | 'total' | 'price', string>>;

function validate(values: Values, typed: Typed): Errors {
  const errors: Errors = {};
  if (!values.date) errors.date = 'Pick a date';

  const km = Number(values.odometerKm);
  if (values.odometerKm.trim() === '') errors.odometerKm = 'Enter the mileage on the dashboard';
  else if (!Number.isInteger(km) || km < 0 || km > 5_000_000) errors.odometerKm = 'Whole kilometres';

  if (!normaliseDecimal(values.litres, 2)) errors.litres = 'Litres, up to 2 decimal places';
  if (!normaliseDecimal(values.total, 3)) errors.total = 'A positive amount, up to 3 decimal places';
  // With both figures typed, the price is worked out from them and not needed.
  if (!(typed.litres && typed.total) && !normaliseDecimal(values.price, 3)) {
    errors.price = 'Enter the price per litre, or both the amount paid and the litres';
  }
  return errors;
}

export interface FuelFormProps {
  vehicleId: string;
  vehicleFuelType: FuelType;
  currency: string;
  /** Present when editing. */
  entry?: FuelEntry;
  onDone: () => void;
}

/**
 * The fill-up form, built to be filled in standing at a pump with one thumb.
 *
 * What can be known is already there: today, the car's fuel, the last price
 * paid, a full tank, and the station, from where the phone is. The rest is
 * one tap — usual amounts, recent stations — or one field, since litres and
 * total are tied together by the price and either gives the other.
 *
 * The mileage is the exception. It is shown as a hint and never prefilled: a
 * guessed odometer that happens to fit the timeline would be accepted, and
 * would quietly corrupt every consumption figure after it.
 */
export function FuelForm({ vehicleId, vehicleFuelType, currency, entry, onDone }: FuelFormProps) {
  const queryClient = useQueryClient();
  const keys = useRef(new IdempotencyKeys());
  const [receipts, setReceipts] = useState<File[]>([]);
  const { attach, progress, busy: uploading } = useAttachFiles(vehicleId);
  const [serverError, setServerError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [showMore, setShowMore] = useState(Boolean(entry?.notes));

  const [values, setValues] = useState<Values>(() => ({
    date: toDateInputValue(entry ? new Date(entry.filledAt) : new Date()),
    odometerKm: entry ? String(entry.odometerKm) : '',
    fuelType: entry?.fuelType ?? defaultPumpFuel(vehicleFuelType),
    litres: entry?.volumeLiters ?? '',
    total: entry?.totalCost ?? '',
    price: entry?.pricePerLiter ?? '',
    isFullTank: entry?.isFullTank ?? true,
    isMissedFill: entry?.isMissedFill ?? false,
    stationName: entry?.stationName ?? '',
    notes: entry?.notes ?? '',
  }));
  // An existing entry's figures came off a pump; neither is "worked out".
  const [typed, setTyped] = useState<Typed>({ litres: Boolean(entry), total: Boolean(entry) });
  // Set once the person chooses a price or station, so a late suggestion never overwrites them.
  const [touched, setTouched] = useState({ price: Boolean(entry), station: Boolean(entry) });
  // The official grade chosen (by hand, or matched from history); null lets the default pick.
  const [grade, setGrade] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState(Boolean(entry));

  const suggestions = useQuery({
    queryKey: fuelKeys.suggestions(vehicleId, null),
    queryFn: () => fuelApi.suggestions(vehicleId),
  });

  // Location only for a new fill-up: an edit is not happening at the pump.
  const finder = useStationFinder(vehicleId, !entry);

  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));
  const setOdometer = useCallback(
    (odometerKm: string) => setValues((current) => ({ ...current, odometerKm })),
    [],
  );

  /** Recomputes whichever figure was worked out, after one of the three moved. */
  const derive = (next: Values, nextTyped: Typed): Values => {
    if (nextTyped.litres && !nextTyped.total) {
      return { ...next, total: totalFor(next.litres, next.price) ?? next.total };
    }
    if (nextTyped.total && !nextTyped.litres) {
      return { ...next, litres: litresFor(next.total, next.price) ?? next.litres };
    }
    return next;
  };

  /*
   * Defaults that arrive after the first render. Applied during render rather
   * than in an effect, and only to fields nobody has touched, so they fill in
   * the blanks without ever fighting the person's own input.
   */
  const priceChoice = defaultPrice(values.fuelType, suggestions.data, grade);
  if (!touched.price && priceChoice && values.price !== priceChoice.price) {
    // Through `derive`, so an amount typed before the prices arrived gets its litres.
    setValues((current) => derive({ ...current, price: priceChoice.price }, typed));
  }
  const located = finder.candidates[0];
  if (!touched.station && located && values.stationName === '') {
    set({ stationName: located.name });
  }

  const typeFigure = (field: 'litres' | 'total', value: string) => {
    const nextTyped = { ...typed, [field]: value.trim() !== '' };
    setTyped(nextTyped);
    setValues((current) => derive({ ...current, [field]: value }, nextTyped));
  };

  const setPrice = (price: string) => {
    setTouched((t) => ({ ...t, price: true }));
    setValues((current) => derive({ ...current, price }, typed));
  };

  const chooseFuel = (fuelType: FuelType) => {
    // The price follows on the next render, from that fuel's official grade.
    setGrade(null);
    set({ fuelType });
  };

  const chooseGrade = (next: string) => {
    // Picking a grade is choosing its official price, even after a hand edit.
    setGrade(next);
    setTouched((t) => ({ ...t, price: false }));
    setEditingPrice(false);
  };

  const chooseAmount = (amount: string) => {
    // A usual amount is what the attendant was asked for: the total drives.
    const nextTyped = { litres: false, total: true };
    setTyped(nextTyped);
    setValues((current) => derive({ ...current, total: amount }, nextTyped));
  };

  const chooseStation = (name: string) => {
    setTouched((t) => ({ ...t, station: true }));
    set({ stationName: values.stationName === name ? '' : name });
  };

  const bothTyped = typed.litres && typed.total;
  // With both figures off the pump, the price is theirs to imply, not ours to guess.
  const workedOutPrice = bothTyped ? priceFor(values.total, values.litres) : null;

  const isToday = values.date === toDateInputValue(new Date());

  const buildCreate = (): CreateFuelInput => ({
    filledAt: incurredAtFromDate(values.date),
    odometerKm: Number(values.odometerKm),
    volumeLiters: normaliseDecimal(values.litres, 2)!,
    totalCost: normaliseDecimal(values.total, 3)!,
    ...(bothTyped ? {} : { pricePerLiter: normaliseDecimal(values.price, 3)! }),
    fuelType: values.fuelType,
    isFullTank: values.isFullTank,
    isMissedFill: values.isMissedFill,
    ...(values.stationName.trim() ? { stationName: values.stationName.trim() } : {}),
    // Where the phone is, only if the fill is happening now. A fill-up logged
    // from the sofa a day later did not happen on the sofa.
    ...(isToday && finder.position ? finder.position : {}),
    ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
  });

  const buildUpdate = (original: FuelEntry): UpdateFuelInput => {
    const volumeLiters = normaliseDecimal(values.litres, 2)!;
    const totalCost = normaliseDecimal(values.total, 3)!;
    const price = normaliseDecimal(values.price, 3);
    const figuresMoved = volumeLiters !== original.volumeLiters || totalCost !== original.totalCost;
    const originalDate = toDateInputValue(new Date(original.filledAt));

    return {
      ...(values.date === originalDate ? {} : { filledAt: incurredAtFromDate(values.date) }),
      odometerKm: Number(values.odometerKm),
      volumeLiters,
      totalCost,
      // Changed figures re-derive the price unless one was deliberately set.
      ...(price && price !== original.pricePerLiter && !bothTyped
        ? { pricePerLiter: price }
        : figuresMoved
          ? { pricePerLiter: null }
          : {}),
      fuelType: values.fuelType,
      isFullTank: values.isFullTank,
      isMissedFill: values.isMissedFill,
      stationName: values.stationName.trim() || null,
      notes: values.notes.trim() || null,
    };
  };

  const save = useMutation({
    mutationFn: () => {
      if (entry) return fuelApi.update(entry.id, buildUpdate(entry));
      const { key, payload } = keys.current.submissionFor({ values, typed }, buildCreate);
      return fuelApi.create(vehicleId, payload, key);
    },
    onSuccess: async (saved) => {
      keys.current.reset();
      setServerError(null);
      toast.success(entry ? 'Fill-up updated' : 'Fill-up logged');
      // The log, consumption, the ledger, the mileage and the suggestions all moved.
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      if (!entry && receipts.length > 0) await attach(saved.expenseId, receipts);
      onDone();
    },
    onError: (failure: unknown) => {
      // Usually the mileage not fitting the timeline, or a price that
      // contradicts the other two — both messages say what is wrong.
      setServerError(failure instanceof ApiError ? failure.message : 'Could not save that fill-up.');
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(values, typed);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate();
  };

  const idPrefix = entry ? `fuel-${entry.id}` : 'new-fuel';
  const id = (field: string) => `${idPrefix}-${field}`;

  const hints = suggestions.data;
  const lastFill = hints?.lastFill;
  const gapKm = lastFill && values.odometerKm ? Number(values.odometerKm) - lastFill.odometerKm : null;
  const pumpFuels = PUMP_FUELS.includes(values.fuelType) ? PUMP_FUELS : [values.fuelType, ...PUMP_FUELS];

  const grades = hints?.officialPrices?.prices[values.fuelType] ?? [];
  const usingDefault = !touched.price && priceChoice !== null && values.price === priceChoice.price;
  const priceSource = usingDefault
    ? priceChoice.source === 'official'
      ? `Official price${priceChoice.grade ? `, ${priceChoice.grade}` : ''}`
      : 'Last price you paid'
    : 'Your price';
  const checkPump =
    usingDefault &&
    priceChoice.source === 'official' &&
    hints?.officialPrices &&
    officialPricesNeedChecking(hints.officialPrices.verifiedAt);

  const recent = (hints?.recentStations ?? []).filter(
    (name) => !finder.candidates.some((c) => c.name.toLowerCase() === name.toLowerCase()),
  );

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {/* Fuel type: the car's own is preselected. */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Fuel</legend>
        <div className="flex flex-wrap gap-2">
          {pumpFuels.map((fuel) => (
            <ChoiceChip key={fuel} selected={values.fuelType === fuel} onClick={() => chooseFuel(fuel)}>
              {fuelLabel(fuel)}
            </ChoiceChip>
          ))}
        </div>
        {grades.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Grade">
            {grades.map((option) => (
              <ChoiceChip
                key={option.grade}
                className="min-h-8 text-xs"
                selected={usingDefault && priceChoice?.grade === option.grade}
                onClick={() => chooseGrade(option.grade)}
              >
                {option.grade}
                <span className="opacity-70">{option.pricePerLiter}</span>
              </ChoiceChip>
            ))}
          </div>
        ) : null}
      </fieldset>

      {/* Station: from where the phone is, then from history. */}
      <div className="space-y-2">
        <Label htmlFor={id('station')}>Station</Label>
        <Input
          id={id('station')}
          placeholder="Station name"
          autoComplete="off"
          maxLength={120}
          value={values.stationName}
          onChange={(event) => {
            setTouched((t) => ({ ...t, station: true }));
            set({ stationName: event.target.value });
          }}
        />
        <StationStatus finder={finder} />
        {finder.candidates.length > 0 || recent.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {finder.candidates.map((candidate) => (
              <ChoiceChip
                key={`here-${candidate.name}`}
                selected={values.stationName === candidate.name}
                onClick={() => chooseStation(candidate.name)}
              >
                <MapPin className="size-3.5" aria-hidden />
                {candidate.name}
                <span className="text-xs opacity-70">{formatDistance(candidate.distanceMeters)}</span>
              </ChoiceChip>
            ))}
            {recent.map((name) => (
              <ChoiceChip
                key={`recent-${name}`}
                selected={values.stationName === name}
                onClick={() => chooseStation(name)}
              >
                <History className="size-3.5" aria-hidden />
                {name}
              </ChoiceChip>
            ))}
          </div>
        ) : null}
      </div>

      {/*
       * The pump figures. Amount paid comes first because it is what someone
       * asks the attendant for; the litres follow from the price. Either can
       * be typed, and typing both — straight off the pump display — lets the
       * server work out the price instead.
       */}
      <div className="space-y-3">
        <FormField
          id={id('total')}
          label={`Amount paid (${currency})`}
          inputMode="decimal"
          placeholder="50"
          autoComplete="off"
          className="h-11 text-lg"
          value={values.total}
          error={errors.total}
          hint={!typed.total && values.total ? 'Worked out from the litres' : undefined}
          onChange={(event) => typeFigure('total', event.target.value)}
        />
        {hints?.usualAmounts.length ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Your usual amounts">
            {hints.usualAmounts.map((amount) => (
              <ChoiceChip
                key={amount}
                selected={values.total === amount && !typed.litres}
                onClick={() => chooseAmount(amount)}
              >
                {formatMoney(amount, currency)}
              </ChoiceChip>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id={id('litres')}
            label="Litres"
            inputMode="decimal"
            placeholder="19.80"
            autoComplete="off"
            value={values.litres}
            error={errors.litres}
            hint={
              !typed.litres && values.litres
                ? 'Worked out. Correct it if the pump shows different.'
                : undefined
            }
            onChange={(event) => typeFigure('litres', event.target.value)}
          />

          {bothTyped ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Price / litre</p>
              <p className="text-sm tabular-nums">
                {workedOutPrice ? `${formatMoney(workedOutPrice, currency)}/L` : '—'}
              </p>
              <p className="text-muted-foreground text-sm">Worked out from the amount and litres</p>
            </div>
          ) : editingPrice || !values.price ? (
            <FormField
              id={id('price')}
              label="Price / litre"
              inputMode="decimal"
              placeholder="2.525"
              autoComplete="off"
              value={values.price}
              error={errors.price}
              hint={values.price ? priceSource : undefined}
              onChange={(event) => setPrice(event.target.value)}
            />
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">Price / litre</p>
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="tabular-nums">{formatMoney(values.price, currency)}/L</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() => setEditingPrice(true)}
                >
                  Change
                </Button>
              </p>
              <p className="text-muted-foreground text-sm">
                {priceSource}
                {checkPump ? ' · last checked a while ago, so glance at the pump' : null}
              </p>
            </div>
          )}
        </div>
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
          excludeSourceId={entry?.id}
          allowTrip
          error={errors.odometerKm}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Tank</legend>
        <div className="flex flex-wrap gap-2">
          <ChoiceChip selected={values.isFullTank} onClick={() => set({ isFullTank: true })}>
            Filled up
          </ChoiceChip>
          <ChoiceChip selected={!values.isFullTank} onClick={() => set({ isFullTank: false })}>
            Partial
          </ChoiceChip>
        </div>
        <p className="text-muted-foreground text-xs">
          Consumption is measured between two fill-ups to the brim.
        </p>
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={values.isMissedFill}
          onChange={(event) => set({ isMissedFill: event.target.checked })}
        />
        <span>
          I missed logging a fill-up before this one
          {gapKm !== null && gapKm > LIKELY_MISSED_FILL_KM && !values.isMissedFill ? (
            <span className="text-muted-foreground block text-xs">
              {formatKm(gapKm)} since the last one logged. If you filled up in between, tick this so it is not
              counted as one tank.
            </span>
          ) : null}
        </span>
      </label>

      {showMore ? (
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
          onClick={() => setShowMore(true)}
        >
          Add a note
        </Button>
      )}

      {entry ? null : (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Receipt <span className="text-muted-foreground font-normal">· optional</span>
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
          {uploading ? 'Uploading…' : save.isPending ? 'Saving…' : entry ? 'Save changes' : 'Log fill-up'}
        </Button>
        <Button type="button" variant="ghost" disabled={uploading} onClick={onDone}>
          Cancel
        </Button>
        {progress ? (
          <p className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
            {progress.fileName} · {Math.round(progress.fraction * 100)}%
          </p>
        ) : null}
      </div>
    </form>
  );
}

function StationStatus({ finder }: { finder: ReturnType<typeof useStationFinder> }) {
  const message: Record<typeof finder.status, string | null> = {
    locating: 'Finding where you are…',
    searching: 'Looking for stations near you…',
    found:
      finder.candidates[0]?.source === 'history'
        ? 'A station you have used before is right here.'
        : 'Stations near you, from OpenStreetMap.',
    'none-nearby': 'No station found near you. Pick a recent one or type its name.',
    unavailable: null,
  };

  const text = message[finder.status];
  if (!text) return null;

  const busy = finder.status === 'locating' || finder.status === 'searching';
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs" aria-live="polite">
      {busy ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null}
      {text}
    </p>
  );
}
