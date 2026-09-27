import { describe, expect, it } from 'vitest';
import { IdempotencyKeys } from './idempotency';

function counter() {
  let n = 0;
  return () => `key-${++n}`;
}

describe('IdempotencyKeys', () => {
  it('reuses the key when the same payload is submitted again after a failure', () => {
    const keys = new IdempotencyKeys(counter());

    expect(keys.keyFor({ amount: '10' })).toBe('key-1');
    expect(keys.keyFor({ amount: '10' })).toBe('key-1');
  });

  /** The old key now describes a different request, which the API refuses. */
  it('issues a new key once the payload changes', () => {
    const keys = new IdempotencyKeys(counter());

    keys.keyFor({ amount: '10' });
    expect(keys.keyFor({ amount: '12' })).toBe('key-2');
  });

  it('issues a new key for an identical payload after a success', () => {
    const keys = new IdempotencyKeys(counter());

    keys.keyFor({ amount: '10' });
    keys.reset();

    // Two identical tolls on one day are two real expenses.
    expect(keys.keyFor({ amount: '10' })).toBe('key-2');
  });
});
