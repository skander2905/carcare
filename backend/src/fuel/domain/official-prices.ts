/**
 * Official pump prices, where the state sets them (ADR-018).
 *
 * Tunisia fixes retail fuel prices nationally, so the price at every pump is
 * known to the millime. Published aggregators round it (2.53 for 2.525), and
 * a price 0.2% off makes every litres figure worked out from an amount paid
 * — and every consumption figure after it — 0.2% wrong. So the table is kept
 * here, exact, with its source, rather than fetched approximately.
 *
 * When the government changes prices: add a new `OfficialPriceList` with the
 * new `effectiveFrom`, keep the old one (backdated entries still need it),
 * and update `verifiedAt`. `official-prices.spec.ts` checks the ordering.
 */

export interface OfficialGrade {
  /** As it is written on the pump. */
  grade: string;
  /** Millimes per litre. */
  priceMillimes: number;
}

export interface OfficialPriceList {
  /** The day these prices took effect, local midnight. */
  effectiveFrom: string;
  /** Per fuel type, the pump's usual grade first. Fuels with no exact official figure are left out. */
  prices: Partial<Record<'PETROL' | 'DIESEL' | 'LPG', OfficialGrade[]>>;
}

export interface OfficialPriceTable {
  /** ISO 4217 — the table applies only to vehicles whose amounts are in this currency. */
  currency: string;
  /** When someone last confirmed the newest list is still current. */
  verifiedAt: string;
  source: string;
  /** Oldest first. */
  lists: OfficialPriceList[];
}

export const TUNISIA_PRICES: OfficialPriceTable = {
  currency: 'TND',
  verifiedAt: '2026-09-29',
  source:
    'https://www.energiemines.gov.tn/fr/themes/energie/hydrocarbures/prix-et-marges-des-produits-petroliers/',
  lists: [
    {
      // Ministry of Energy, and Anadolu Agency's report of the same announcement.
      // LPG was left unchanged and neither source states it, so it is not listed:
      // the form falls back to the last price paid.
      effectiveFrom: '2022-11-24',
      prices: {
        PETROL: [
          { grade: 'Sans plomb', priceMillimes: 2525 },
          { grade: 'Sans plomb premier', priceMillimes: 2855 },
        ],
        DIESEL: [
          { grade: 'Gasoil sans soufre', priceMillimes: 2205 },
          { grade: 'Gasoil sans soufre super', priceMillimes: 2550 },
          { grade: 'Gasoil ordinaire', priceMillimes: 1985 },
        ],
      },
    },
  ],
};

export interface OfficialPrices {
  effectiveFrom: string;
  verifiedAt: string;
  source: string;
  prices: OfficialPriceList['prices'];
}

/**
 * The official list in force on a day, for a vehicle in a currency — or null
 * where no state price applies (another currency, or a day before the table).
 */
export function officialPricesOn(
  currency: string,
  day: Date,
  table: OfficialPriceTable = TUNISIA_PRICES,
): OfficialPrices | null {
  if (currency !== table.currency) return null;

  const iso = day.toISOString().slice(0, 10);
  const list = [...table.lists].reverse().find((candidate) => candidate.effectiveFrom <= iso);
  if (!list) return null;

  return {
    effectiveFrom: list.effectiveFrom,
    verifiedAt: table.verifiedAt,
    source: table.source,
    prices: list.prices,
  };
}
