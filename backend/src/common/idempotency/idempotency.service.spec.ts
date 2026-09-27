import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { type PrismaService } from '../../prisma/prisma.service.js';
import { type IdempotencyKey } from '../../prisma/model.types.js';
import { IdempotencyService } from './idempotency.service.js';

const service = new IdempotencyService({} as PrismaService);

function spentKey(overrides: Partial<IdempotencyKey> = {}): IdempotencyKey {
  return {
    id: 'key-row',
    userId: 'user-1',
    key: 'k-1',
    scope: 'expense.create',
    requestHash: service.fingerprint('expense.create', 'vehicle-1', { amount: '10.000' }),
    resourceId: 'expense-1',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('IdempotencyService', () => {
  describe('parseKey', () => {
    it('passes an absent header through as undefined', () => {
      expect(service.parseKey(undefined)).toBeUndefined();
    });

    it('accepts a UUID', () => {
      expect(service.parseKey('0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b')).toBe(
        '0192f8c1-2b3d-7e4f-8a9b-1c2d3e4f5a6b',
      );
    });

    it.each([[''], ['has space'], ['x'.repeat(256)], ['naïve']])('rejects %j', (raw) => {
      expect(() => service.parseKey(raw)).toThrow(BadRequestException);
    });
  });

  describe('fingerprint', () => {
    it('ignores the order fields arrive in', () => {
      const a = service.fingerprint('s', 't', { amount: '10.000', category: 'TOLL' });
      const b = service.fingerprint('s', 't', { category: 'TOLL', amount: '10.000' });

      expect(a).toBe(b);
    });

    it('ignores fields that are present but undefined', () => {
      expect(service.fingerprint('s', 't', { amount: '1', vendor: undefined })).toBe(
        service.fingerprint('s', 't', { amount: '1' }),
      );
    });

    it('differs when the body, the target or the scope differs', () => {
      const base = service.fingerprint('s', 't', { amount: '10.000' });

      expect(service.fingerprint('s', 't', { amount: '10.001' })).not.toBe(base);
      expect(service.fingerprint('s', 'other', { amount: '10.000' })).not.toBe(base);
      expect(service.fingerprint('other', 't', { amount: '10.000' })).not.toBe(base);
    });
  });

  describe('replayedResourceId', () => {
    const request = {
      userId: 'user-1',
      key: 'k-1',
      scope: 'expense.create',
      requestHash: service.fingerprint('expense.create', 'vehicle-1', { amount: '10.000' }),
    };

    it('returns the original resource for a genuine retry', () => {
      expect(service.replayedResourceId(spentKey(), request)).toBe('expense-1');
    });

    /**
     * Replaying here would report success for a request that never ran — the
     * client thinks it recorded 12 TND, and the ledger still says 10.
     */
    it('refuses a key reused for a different body', () => {
      expect(() =>
        service.replayedResourceId(spentKey(), {
          ...request,
          requestHash: service.fingerprint('s', 't', {}),
        }),
      ).toThrow(UnprocessableEntityException);
    });

    it('refuses a key reused for a different operation', () => {
      expect(() => service.replayedResourceId(spentKey({ scope: 'fuel.create' }), request)).toThrow(
        UnprocessableEntityException,
      );
    });
  });
});
