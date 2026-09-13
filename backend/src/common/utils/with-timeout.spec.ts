import { describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resolves with the operation result when it finishes in time', async () => {
    await expect(withTimeout(Promise.resolve('pong'), 50, 'probe')).resolves.toBe('pong');
  });

  it('rejects with a TimeoutError once the deadline passes', async () => {
    const never = new Promise<string>(() => {
      /* deliberately never settles */
    });

    await expect(withTimeout(never, 10, 'database probe')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('names the operation in the timeout message so logs are actionable', async () => {
    const never = new Promise<string>(() => {});

    await expect(withTimeout(never, 5, 'redis probe')).rejects.toThrow('redis probe timed out after 5ms');
  });

  it('propagates the original rejection rather than masking it as a timeout', async () => {
    const failure = Promise.reject(new Error('connection refused'));

    await expect(withTimeout(failure, 1_000, 'probe')).rejects.toThrow('connection refused');
  });

  it('clears its timer so a resolved call cannot hold the event loop open', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await withTimeout(Promise.resolve(1), 1_000, 'probe');

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
