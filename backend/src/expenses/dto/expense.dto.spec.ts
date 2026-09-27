import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { escapeLike } from '../expenses.repository.js';
import { CreateExpenseDto, ListExpensesQueryDto, UpdateExpenseDto } from './expense.dto.js';

function errorsFor<T extends object>(type: new () => T, plain: Record<string, unknown>): string[] {
  const instance = plainToInstance(type, plain);
  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }).map(
    (error) => error.property,
  );
}

const valid = { category: 'TOLL', amount: '4.500' };

describe('CreateExpenseDto', () => {
  it('accepts the minimum: a category and an amount', () => {
    expect(errorsFor(CreateExpenseDto, valid)).toEqual([]);
  });

  it.each([['1'], ['0.001'], ['321.75'], ['999999999.999']])('accepts the amount %j', (amount) => {
    expect(errorsFor(CreateExpenseDto, { ...valid, amount })).toEqual([]);
  });

  /**
   * Zero and negatives are refused here so the caller gets a 400 naming the
   * field; the CHECK constraint behind it would surface as a 500. A number is
   * refused because JSON numbers are floats, and floats lose millimes.
   */
  it.each([['0'], ['0.000'], ['-5.000'], ['1.2345'], ['1e3'], ['1234567890'], [''], [12.5]])(
    'rejects the amount %j',
    (amount) => {
      expect(errorsFor(CreateExpenseDto, { ...valid, amount })).toEqual(['amount']);
    },
  );

  it('rejects an unknown category', () => {
    expect(errorsFor(CreateExpenseDto, { ...valid, category: 'SNACKS' })).toEqual(['category']);
  });

  it('treats a blank description as absent rather than invalid', () => {
    const dto = plainToInstance(CreateExpenseDto, { ...valid, description: '   ' });

    expect(validateSync(dto)).toEqual([]);
    expect(dto.description).toBeUndefined();
  });

  it('rejects properties it does not know, rather than dropping them', () => {
    expect(errorsFor(CreateExpenseDto, { ...valid, sourceType: 'FUEL' })).toEqual(['sourceType']);
  });
});

describe('UpdateExpenseDto', () => {
  it('accepts an empty patch', () => {
    expect(errorsFor(UpdateExpenseDto, {})).toEqual([]);
  });

  it('lets null clear the optional fields', () => {
    expect(
      errorsFor(UpdateExpenseDto, { odometerKm: null, description: null, vendor: null, notes: null }),
    ).toEqual([]);
  });

  /** Every expense has these; null would otherwise reach a NOT NULL column. */
  it.each([['category'], ['amount'], ['incurredAt']])('refuses null for %s', (field) => {
    expect(errorsFor(UpdateExpenseDto, { [field]: null })).toEqual([field]);
  });

  it('turns a blank vendor into null, so clearing a text box clears the field', () => {
    const dto = plainToInstance(UpdateExpenseDto, { vendor: '  ' });

    expect(validateSync(dto)).toEqual([]);
    expect(dto.vendor).toBeNull();
  });
});

describe('ListExpensesQueryDto', () => {
  it('defaults to newest first, 25 per page', () => {
    const dto = plainToInstance(ListExpensesQueryDto, {});

    expect(dto).toMatchObject({ page: 1, limit: 25, sort: 'incurredAt:desc' });
  });

  it.each([['vendor:asc'], ['incurredAt'], ['createdById:desc']])('rejects the sort %j', (sort) => {
    expect(errorsFor(ListExpensesQueryDto, { sort })).toEqual(['sort']);
  });

  it('caps the page size', () => {
    expect(errorsFor(ListExpensesQueryDto, { limit: '101' })).toEqual(['limit']);
  });
});

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('50% off_now\\')).toBe('50\\% off\\_now\\\\');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('Total Énergies')).toBe('Total Énergies');
  });
});
