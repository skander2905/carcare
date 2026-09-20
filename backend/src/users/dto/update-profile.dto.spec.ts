import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateProfileDto } from './update-profile.dto.js';

const check = async (payload: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateProfileDto, payload);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

  return errors.map((error) => error.property);
};

describe('UpdateProfileDto', () => {
  it('accepts an empty patch', async () => {
    // Re-saving an unchanged form must not fail.
    expect(await check({})).toEqual([]);
  });

  it('accepts the fields it owns', async () => {
    expect(await check({ displayName: 'Sam', currency: 'EUR', locale: 'fr' })).toEqual([]);
  });

  /**
   * `@IsOptional()` skips validation for null as well as undefined, so an
   * explicit null would pass every check and reach a non-nullable column —
   * turning a malformed request into a 500 rather than a 400.
   */
  it('rejects an explicit null on every field', async () => {
    expect(await check({ displayName: null })).toEqual(['displayName']);
    expect(await check({ currency: null })).toEqual(['currency']);
    expect(await check({ locale: null })).toEqual(['locale']);
    expect(await check({ timezone: null })).toEqual(['timezone']);
  });

  it('still rejects the wrong shape', async () => {
    expect(await check({ displayName: '' })).toEqual(['displayName']);
    expect(await check({ currency: 'XYZ' })).toEqual(['currency']);
    expect(await check({ timezone: 'not a zone!' })).toEqual(['timezone']);
  });

  it('trims before validating, so whitespace is not a name', async () => {
    expect(await check({ displayName: '   ' })).toEqual(['displayName']);
  });
});
