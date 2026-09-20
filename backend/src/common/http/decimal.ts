import { type Prisma } from '../../generated/prisma/client.js';

/**
 * TND is a three-decimal currency: one dinar is 1000 millimes. Every monetary
 * column is `numeric(12,3)` for that reason, and every monetary response
 * carries all three places.
 */
export const MONEY_DECIMAL_PLACES = 3;

/**
 * Serialises a decimal to a fixed-width string.
 *
 * `Decimal.toString()` is not enough: it drops trailing zeros, so 38500.000
 * leaves as `"38500"` and 321.750 as `"321.75"`. Both are still exact, but the
 * width varies by value — which means a client either re-pads them or displays
 * a different number of millimes from one row to the next. Fixing the width
 * here keeps the contract in api.md true for every amount.
 */
export function toDecimalString(value: Prisma.Decimal | null, decimalPlaces: number): string | null {
  return value === null ? null : value.toFixed(decimalPlaces);
}

export function toMoneyString(value: Prisma.Decimal | null): string | null {
  return toDecimalString(value, MONEY_DECIMAL_PLACES);
}
