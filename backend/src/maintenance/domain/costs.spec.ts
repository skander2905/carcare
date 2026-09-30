import { describe, expect, it } from 'vitest';
import { ExpenseCategory, MaintenanceType } from '../../generated/prisma/enums.js';
import { ledgerCategory, ledgerDescription, resolveCosts } from './costs.js';

describe('resolveCosts', () => {
  it('accepts a total alone, as most invoices show', () => {
    expect(resolveCosts({ parts: null, labor: null, total: '180.5' })).toEqual({
      ok: true,
      costs: { partsMillimes: null, laborMillimes: null, totalMillimes: 180_500 },
    });
  });

  it('adds up the total when only the split is given', () => {
    expect(resolveCosts({ parts: '120.250', labor: '60', total: null })).toEqual({
      ok: true,
      costs: { partsMillimes: 120_250, laborMillimes: 60_000, totalMillimes: 180_250 },
    });
  });

  it('takes parts alone as the total, for a job done at home', () => {
    expect(resolveCosts({ parts: '45', labor: null, total: null })).toMatchObject({
      ok: true,
      costs: { totalMillimes: 45_000 },
    });
  });

  it('accepts a free service', () => {
    expect(resolveCosts({ parts: null, labor: null, total: '0' })).toMatchObject({
      ok: true,
      costs: { totalMillimes: 0 },
    });
  });

  it('refuses a split that does not add up, by a single millime', () => {
    const result = resolveCosts({ parts: '120.250', labor: '60', total: '180.251' });
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('is 180.250, not the totalCost 180.251'),
    });
  });

  it('refuses one side of the split exceeding the total', () => {
    expect(resolveCosts({ parts: null, labor: '200', total: '180' })).toEqual({
      ok: false,
      message: 'laborCost 200.000 is more than the totalCost 180',
    });
  });

  it('refuses nothing at all', () => {
    expect(resolveCosts({ parts: null, labor: null, total: null }).ok).toBe(false);
  });
});

describe('ledger mapping', () => {
  it('files tyres and inspections under their own categories', () => {
    expect(ledgerCategory(MaintenanceType.TIRES)).toBe(ExpenseCategory.TIRES);
    expect(ledgerCategory(MaintenanceType.INSPECTION)).toBe(ExpenseCategory.INSPECTION);
    expect(ledgerCategory(MaintenanceType.OIL_CHANGE)).toBe(ExpenseCategory.MAINTENANCE);
  });

  it('describes a service by its own words first', () => {
    expect(ledgerDescription(MaintenanceType.OIL_CHANGE, null)).toBe('Oil change');
    expect(ledgerDescription(MaintenanceType.OIL_CHANGE, '5W-30, Total Quartz')).toBe('5W-30, Total Quartz');
  });
});
