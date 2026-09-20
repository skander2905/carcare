import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { optionalNumber } from './optional-number';

const mileage = optionalNumber((n) => n.int().min(0).max(5_000_000));
const engine = optionalNumber((n) => n.min(0.1).max(20));

describe('optionalNumber', () => {
  /**
   * The bug this exists to prevent: `Number('')` is 0, so a union whose numeric
   * branch accepts 0 swallows an untouched field and submits an explicit zero.
   */
  it('treats an untouched field as absent, not as zero', () => {
    expect(mileage.parse('')).toBeUndefined();
    expect(engine.parse('')).toBeUndefined();
  });

  it('treats null and undefined as absent too', () => {
    expect(mileage.parse(null)).toBeUndefined();
    expect(mileage.parse(undefined)).toBeUndefined();
  });

  it('keeps a real zero the user actually typed', () => {
    // A car delivered new genuinely reads 0 km, and that is a real reading.
    expect(mileage.parse('0')).toBe(0);
    expect(mileage.parse(0)).toBe(0);
  });

  it('coerces the digits a number input hands back as a string', () => {
    expect(mileage.parse('120000')).toBe(120_000);
    expect(engine.parse('1.6')).toBe(1.6);
  });

  it('still enforces the range', () => {
    expect(() => mileage.parse('-1')).toThrow(z.ZodError);
    expect(() => mileage.parse('9000000')).toThrow(z.ZodError);
    expect(() => engine.parse('0.05')).toThrow(z.ZodError);
  });

  it('still rejects something that is not a number', () => {
    expect(() => mileage.parse('lots')).toThrow(z.ZodError);
  });
});
