import { z } from 'zod';

/**
 * An optional numeric input that an untouched field leaves empty.
 *
 * `z.union([z.coerce.number()…, z.literal('')])` looks equivalent and is not:
 * union branches are tried in order, and `Number('')` is `0`, so an empty
 * string satisfies the first branch whenever `0` is inside its range. A blank
 * "current mileage" therefore submitted an explicit `0` — which, now that the
 * API treats zero as a genuine first reading, would file a brand-new timeline
 * entry for a car with 120,000 km on it.
 *
 * An empty engine size escaped only because `.min(0.1)` happens to reject the
 * coerced zero and the union falls through. That is luck, not design.
 *
 * Emptiness is decided *before* any coercion here, so the result is `undefined`
 * and the field is omitted from the payload entirely.
 */
export function optionalNumber(rules: (schema: z.ZodNumber) => z.ZodNumber = (s) => s) {
  return z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? undefined : value),
    rules(z.coerce.number()).optional(),
  );
}
