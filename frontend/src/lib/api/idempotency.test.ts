import { describe, expect, it } from 'vitest';
import { IdempotencyKeys, randomUuid } from './idempotency';

function counter() {
  let n = 0;
  return () => `key-${++n}`;
}

describe('IdempotencyKeys', () => {
  it('reuses the key when the same entry is submitted again after a failure', () => {
    const keys = new IdempotencyKeys(counter());

    expect(keys.submissionFor({ amount: '10' }, () => ({})).key).toBe('key-1');
    expect(keys.submissionFor({ amount: '10' }, () => ({})).key).toBe('key-1');
  });

  /**
   * The retry after a lost response. An expense dated today is stamped with
   * the moment of submission, so rebuilding the payload would produce a later
   * timestamp — a different request, a new key, and a duplicate expense.
   */
  it('replays the frozen payload rather than rebuilding it', () => {
    const keys = new IdempotencyKeys(counter());
    let clock = 0;
    const build = () => ({ amount: '10', incurredAt: `t${++clock}` });

    const first = keys.submissionFor({ amount: '10', date: 'today' }, build);
    const retry = keys.submissionFor({ amount: '10', date: 'today' }, build);

    expect(retry).toEqual(first);
    expect(retry.payload).toEqual({ amount: '10', incurredAt: 't1' });
  });

  /** The old key now describes a different request, which the API refuses. */
  it('issues a new key and payload once the entry changes', () => {
    const keys = new IdempotencyKeys(counter());

    keys.submissionFor({ amount: '10' }, () => ({ amount: '10' }));
    const edited = keys.submissionFor({ amount: '12' }, () => ({ amount: '12' }));

    expect(edited).toEqual({ key: 'key-2', payload: { amount: '12' } });
  });

  it('issues a new key for an identical entry after a success', () => {
    const keys = new IdempotencyKeys(counter());

    keys.submissionFor({ amount: '10' }, () => ({}));
    keys.reset();

    // Two identical tolls on one day are two real expenses.
    expect(keys.submissionFor({ amount: '10' }, () => ({})).key).toBe('key-2');
  });
});

describe('randomUuid', () => {
  it('makes a v4 UUID even where crypto.randomUUID is missing, as on plain http', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));
      expect(ids.size).toBe(50);
      for (const id of ids)
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
