/**
 * The full-to-full consumption engine (ADR-012, ADR-018).
 *
 * Pure and synchronous: it takes a vehicle's fill history and returns the
 * windows over which consumption can honestly be stated. Everything is in
 * integer centilitres and millimes, so summing forty fills cannot drift the way
 * `38.2 + 10.1 + …` does in floating point.
 */

/** One fill, reduced to what the engine needs. */
export interface Fill {
  id: string;
  filledAt: Date;
  odometerKm: number;
  /** Litres × 100. The column is numeric(7,2), so this is exact. */
  centilitres: number;
  /** Total cost × 1000. The column is numeric(12,3), so this is exact. */
  costMillimes: number;
  isFullTank: boolean;
  isMissedFill: boolean;
}

/**
 * The stretch between two full tanks with nothing missing in between.
 *
 * The litres are every fill *after* the opening full tank, up to and including
 * the closing one — the opening fill's fuel was burnt before the window began.
 */
export interface ConsumptionWindow {
  /** The full tank that opens the window. Its own litres are not counted. */
  startEntryId: string;
  /** The full tank that closes it; the figure is shown against this entry. */
  endEntryId: string;
  startedAt: Date;
  endedAt: Date;
  startOdometerKm: number;
  endOdometerKm: number;
  distanceKm: number;
  centilitres: number;
  costMillimes: number;
  /** Fills poured into the window, the closing one included. */
  fillCount: number;
}

/**
 * The order fills happened in.
 *
 * Odometer first: the timeline already guarantees mileage never runs backwards
 * against time, and two fills on the same day are told apart by the
 * kilometres far more reliably than by whatever time someone typed.
 */
export function chronological(fills: readonly Fill[]): Fill[] {
  return [...fills].sort(
    (a, b) =>
      a.odometerKm - b.odometerKm ||
      a.filledAt.getTime() - b.filledAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Every valid window in a fill history, oldest first.
 *
 * A partial fill adds to the open window without closing it. A missed fill
 * means litres went into the tank that nobody recorded, so the window it would
 * have closed is abandoned rather than reported low; if the missed-fill entry
 * is itself a full tank, it opens the next window cleanly.
 *
 * A window with no distance — two full tanks at the same mileage — produces no
 * figure: dividing by zero kilometres is "not enough data", never zero and
 * never infinity.
 */
export function consumptionWindows(fills: readonly Fill[]): ConsumptionWindow[] {
  const windows: ConsumptionWindow[] = [];

  let anchor: Fill | null = null;
  let centilitres = 0;
  let costMillimes = 0;
  let fillCount = 0;

  for (const fill of chronological(fills)) {
    if (fill.isMissedFill) {
      // The gap is before this fill, so whatever was open is unknowable.
      anchor = null;
    } else if (anchor) {
      centilitres += fill.centilitres;
      costMillimes += fill.costMillimes;
      fillCount += 1;

      const distanceKm = fill.odometerKm - anchor.odometerKm;

      if (fill.isFullTank && distanceKm > 0) {
        windows.push({
          startEntryId: anchor.id,
          endEntryId: fill.id,
          startedAt: anchor.filledAt,
          endedAt: fill.filledAt,
          startOdometerKm: anchor.odometerKm,
          endOdometerKm: fill.odometerKm,
          distanceKm,
          centilitres,
          costMillimes,
          fillCount,
        });
      }
    }

    // A full tank is a fresh starting line, whatever came before it. So is
    // a zero-distance one: topping off at the same pump resets nothing but
    // also measures nothing.
    if (fill.isFullTank) {
      anchor = fill;
      centilitres = 0;
      costMillimes = 0;
      fillCount = 0;
    }
  }

  return windows;
}

/** L/100 km for one window, unrounded. */
export function litresPer100Km(window: Pick<ConsumptionWindow, 'centilitres' | 'distanceKm'>): number {
  // centilitres / 100 = litres; litres / km * 100 = L/100km — the hundreds cancel.
  return window.centilitres / window.distanceKm;
}

export interface ConsumptionSummary {
  /** Σ litres ÷ Σ distance over the windows — not the mean of their figures. */
  averageLitresPer100Km: number | null;
  /** Kilometres covered by valid windows; the denominator of both averages. */
  measuredDistanceKm: number;
  /** Fuel cost per km over the same windows, in millimes. */
  costMillimesPerKm: number | null;
  windowCount: number;
}

/**
 * The period's consumption, weighted by distance.
 *
 * Averaging the per-window figures would let a 60 km top-up window with a
 * noisy 11 L/100km count as much as a 900 km motorway run. Summing litres and
 * distance first gives each kilometre one vote.
 */
export function summarise(windows: readonly ConsumptionWindow[]): ConsumptionSummary {
  let centilitres = 0;
  let costMillimes = 0;
  let distanceKm = 0;

  for (const window of windows) {
    centilitres += window.centilitres;
    costMillimes += window.costMillimes;
    distanceKm += window.distanceKm;
  }

  return {
    averageLitresPer100Km: distanceKm > 0 ? centilitres / distanceKm : null,
    measuredDistanceKm: distanceKm,
    costMillimesPerKm: distanceKm > 0 ? costMillimes / distanceKm : null,
    windowCount: windows.length,
  };
}

/** Windows that closed inside an inclusive date range. */
export function windowsEndingBetween(
  windows: readonly ConsumptionWindow[],
  from: Date | undefined,
  to: Date | undefined,
): ConsumptionWindow[] {
  return windows.filter((window) => (!from || window.endedAt >= from) && (!to || window.endedAt <= to));
}
