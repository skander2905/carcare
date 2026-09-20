'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { FormField } from '@/features/auth/form-field';
import { ApiError } from '@/lib/api/client';
import { optionalNumber } from '@/lib/forms/optional-number';
import { FUEL_TYPES, TRANSMISSIONS, type Vehicle } from '@/lib/vehicles/types';
import { fuelLabel, transmissionLabel } from '@/lib/vehicles/format';
import { vehicleKeys, vehiclesApi } from '@/lib/vehicles/vehicles-api';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Mirrors the server's DTO so a slip is caught before a round trip. The API
 * validates all of it again — anything a browser checks can be skipped by not
 * using one.
 */
const vehicleSchema = z.object({
  make: z.string().trim().min(1, 'Enter the make').max(64),
  model: z.string().trim().min(1, 'Enter the model').max(64),
  year: z.coerce
    .number()
    .int('Enter a year')
    .min(1886, 'That is earlier than the first car')
    .max(CURRENT_YEAR + 1, 'That year is in the future'),
  licensePlate: z.string().trim().min(1, 'Enter the plate').max(32),
  fuelType: z.enum(FUEL_TYPES),
  transmission: z.union([z.enum(TRANSMISSIONS), z.literal('')]).optional(),
  // Emptiness is decided before coercion — see optionalNumber. A plain union
  // would turn an untouched mileage field into an explicit 0.
  engineSize: optionalNumber((n) => n.min(0.1).max(20)),
  initialOdometerKm: optionalNumber((n) => n.int().min(0).max(5_000_000)),
  // Kept as a string all the way to the API: parsing money to a float here
  // would round it before it ever reached the exact numeric column.
  purchasePrice: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,3})?$/, 'Use digits, with up to 3 decimal places')
    .or(z.literal(''))
    .optional(),
  color: z.string().trim().max(32).optional(),
});

type VehicleValues = z.input<typeof vehicleSchema>;

/** Strips the empty strings an untouched optional field leaves behind. */
function toPayload(values: z.output<typeof vehicleSchema>) {
  return {
    make: values.make,
    model: values.model,
    year: values.year,
    licensePlate: values.licensePlate,
    fuelType: values.fuelType,
    ...(values.transmission ? { transmission: values.transmission } : {}),
    // `undefined` now genuinely means "not given", so a real 0 survives.
    ...(values.engineSize === undefined ? {} : { engineSize: values.engineSize }),
    ...(values.initialOdometerKm === undefined ? {} : { initialOdometerKm: values.initialOdometerKm }),
    ...(values.purchasePrice ? { purchasePrice: values.purchasePrice } : {}),
    ...(values.color ? { color: values.color } : {}),
  };
}

const selectClass =
  'border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';

export function VehicleForm() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VehicleValues>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { fuelType: 'PETROL', transmission: '', engineSize: '', initialOdometerKm: '' },
    // Empty inputs stay empty strings in the form and become `undefined` in the
    // parsed output; the two shapes are deliberately different.
  });

  const create = useMutation({
    mutationFn: (values: z.output<typeof vehicleSchema>) => vehiclesApi.create(toPayload(values)),
    onSuccess: async (vehicle: Vehicle) => {
      toast.success(`${vehicle.make} ${vehicle.model} added`);
      await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
      router.replace(`/vehicles/${vehicle.id}`);
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not add that vehicle.');
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => create.mutate(values as z.output<typeof vehicleSchema>))}
      className="space-y-4"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="make"
          label="Make"
          placeholder="Volkswagen"
          error={errors.make?.message}
          {...register('make')}
        />
        <FormField
          id="model"
          label="Model"
          placeholder="Golf"
          error={errors.model?.message}
          {...register('model')}
        />
        <FormField
          id="year"
          label="Year"
          type="number"
          inputMode="numeric"
          placeholder={String(CURRENT_YEAR)}
          error={errors.year?.message}
          {...register('year')}
        />
        <FormField
          id="licensePlate"
          label="Licence plate"
          placeholder="123 TUN 4567"
          error={errors.licensePlate?.message}
          {...register('licensePlate')}
        />

        <div className="space-y-2">
          <label htmlFor="fuelType" className="text-sm font-medium">
            Fuel
          </label>
          <select id="fuelType" className={selectClass} {...register('fuelType')}>
            {FUEL_TYPES.map((value) => (
              <option key={value} value={value}>
                {fuelLabel(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="transmission" className="text-sm font-medium">
            Transmission
          </label>
          <select id="transmission" className={selectClass} {...register('transmission')}>
            <option value="">Not sure</option>
            {TRANSMISSIONS.map((value) => (
              <option key={value} value={value}>
                {transmissionLabel(value)}
              </option>
            ))}
          </select>
        </div>

        <FormField
          id="engineSize"
          label="Engine size"
          type="number"
          step="0.1"
          placeholder="1.6"
          hint="Litres. Leave blank for an EV."
          error={errors.engineSize?.message}
          {...register('engineSize')}
        />
        <FormField
          id="initialOdometerKm"
          label="Current mileage"
          type="number"
          inputMode="numeric"
          placeholder="120000"
          hint="Becomes the first point on the timeline. Leave blank if unknown."
          error={errors.initialOdometerKm?.message}
          {...register('initialOdometerKm')}
        />
        <FormField
          id="purchasePrice"
          label="Purchase price"
          inputMode="decimal"
          placeholder="38500.000"
          hint="Reported separately, and excluded from cost per kilometre."
          error={errors.purchasePrice?.message}
          {...register('purchasePrice')}
        />
        <FormField
          id="color"
          label="Colour"
          placeholder="Deep Black Pearl"
          error={errors.color?.message}
          {...register('color')}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || create.isPending}>
          {create.isPending ? 'Adding…' : 'Add vehicle'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
