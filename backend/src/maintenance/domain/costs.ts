import { fromUnits, toUnits } from '../../common/money/units.js';
import { ExpenseCategory, MaintenanceType } from '../../generated/prisma/enums.js';

/** Decimal strings as the DTOs accept them; null where the user did not say. */
export interface CostInput {
  parts: string | null;
  labor: string | null;
  total: string | null;
}

export interface Costs {
  partsMillimes: number | null;
  laborMillimes: number | null;
  totalMillimes: number;
}

export type CostResult = { ok: true; costs: Costs } | { ok: false; message: string };

/**
 * Reconciles the three figures a workshop invoice may show.
 *
 * Invoices vary: some split parts from labour, many show only a total, and a
 * job done at home has parts and nothing else. So any of the three may be
 * left out, as long as a total can be known — and whatever is given has to
 * add up. Exactly, unlike a fuel pump's three roundings: an invoice's lines
 * are summed by whoever wrote it, so a millime off is a typo.
 */
export function resolveCosts({ parts, labor, total }: CostInput): CostResult {
  const p = parts === null ? null : toUnits(parts, 3);
  const l = labor === null ? null : toUnits(labor, 3);

  if (total === null) {
    if (p === null && l === null) {
      return { ok: false, message: 'Give totalCost, or the partsCost and laborCost it is made of' };
    }
    return { ok: true, costs: { partsMillimes: p, laborMillimes: l, totalMillimes: (p ?? 0) + (l ?? 0) } };
  }

  const t = toUnits(total, 3);

  if (p !== null && l !== null && p + l !== t) {
    return {
      ok: false,
      message: `partsCost ${parts} + laborCost ${labor} is ${fromUnits(p + l, 3)}, not the totalCost ${total}. Correct one of them, or leave the total out to have it added up.`,
    };
  }

  const part = p ?? l;
  if (part !== null && part > t) {
    const name = p !== null ? 'partsCost' : 'laborCost';
    return { ok: false, message: `${name} ${fromUnits(part, 3)} is more than the totalCost ${total}` };
  }

  return { ok: true, costs: { partsMillimes: p, laborMillimes: l, totalMillimes: t } };
}

/**
 * Where a service lands in the ledger. Tyres and inspections have categories
 * of their own, so a manual tyre purchase and a logged tyre change add up
 * together; everything else is maintenance.
 */
export function ledgerCategory(type: MaintenanceType): ExpenseCategory {
  if (type === MaintenanceType.TIRES) return ExpenseCategory.TIRES;
  if (type === MaintenanceType.INSPECTION) return ExpenseCategory.INSPECTION;
  return ExpenseCategory.MAINTENANCE;
}

const LABELS: Record<MaintenanceType, string> = {
  OIL_CHANGE: 'Oil change',
  OIL_FILTER: 'Oil filter',
  AIR_FILTER: 'Air filter',
  CABIN_FILTER: 'Cabin filter',
  BRAKE_PADS: 'Brake pads',
  BRAKE_DISCS: 'Brake discs',
  TIRES: 'Tyres',
  BATTERY: 'Battery',
  COOLANT: 'Coolant',
  TRANSMISSION: 'Transmission',
  TIMING_BELT: 'Timing belt',
  INSPECTION: 'Inspection',
  OTHER: 'Maintenance',
};

/** The ledger line for a service: its own description, or what kind of job it was. */
export function ledgerDescription(type: MaintenanceType, description: string | null): string {
  return description ?? LABELS[type];
}

export const maintenanceLabel = (type: MaintenanceType): string => LABELS[type];
