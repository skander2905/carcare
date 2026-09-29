import { type FuelType } from '@/lib/vehicles/types';
import { type FuelSuggestions } from './types';

export interface PriceChoice {
  /** TND per litre, three decimals. */
  price: string;
  /** The official grade the price belongs to, when it is one. */
  grade: string | null;
  source: 'official' | 'last-paid';
}

/**
 * The price per litre the form should assume, before anyone types one.
 *
 * The state's price first: it is what the pump charges, to the millime.
 * Among several grades, the one asked for, else the one matching what this
 * car was last filled with (someone who buys gasoil ordinaire keeps getting
 * it), else the pump's usual grade. Only a fuel with no official price falls
 * back to the last price paid.
 */
export function defaultPrice(
  fuel: FuelType,
  suggestions: Pick<FuelSuggestions, 'officialPrices' | 'lastPrices'> | undefined,
  preferredGrade: string | null = null,
): PriceChoice | null {
  const grades = suggestions?.officialPrices?.prices[fuel] ?? [];
  const lastPaid = suggestions?.lastPrices[fuel];

  const chosen =
    grades.find((g) => g.grade === preferredGrade) ??
    grades.find((g) => g.pricePerLiter === lastPaid) ??
    grades[0];

  if (chosen) return { price: chosen.pricePerLiter, grade: chosen.grade, source: 'official' };
  if (lastPaid) return { price: lastPaid, grade: null, source: 'last-paid' };
  return null;
}

/** Whether the official table is old enough that the pump deserves a glance. */
export function officialPricesNeedChecking(verifiedAt: string, now: Date = new Date(), months = 6): boolean {
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - months);
  return new Date(verifiedAt) < limit;
}
