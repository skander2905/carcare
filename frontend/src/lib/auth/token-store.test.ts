import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, getAccessToken, hasFreshAccessToken, setAccessToken } from './token-store';

describe('token store', () => {
  beforeEach(() => {
    clearAccessToken();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(getAccessToken()).toBeNull();
    expect(hasFreshAccessToken()).toBe(false);
  });

  it('holds a token that was set', () => {
    setAccessToken({ accessToken: 'token-1', expiresIn: 900 });

    expect(getAccessToken()).toBe('token-1');
    expect(hasFreshAccessToken()).toBe(true);
  });

  it('never touches browser storage', () => {
    setAccessToken({ accessToken: 'token-1', expiresIn: 900 });

    // The entire reason the store exists: one XSS must not be able to read the
    // session out of localStorage or sessionStorage.
    expect(JSON.stringify(window.localStorage)).not.toContain('token-1');
    expect(JSON.stringify(window.sessionStorage)).not.toContain('token-1');
    expect(document.cookie).not.toContain('token-1');
  });

  it('reports an expired token as stale', () => {
    vi.useFakeTimers();
    setAccessToken({ accessToken: 'token-1', expiresIn: 900 });

    vi.advanceTimersByTime(901_000);

    expect(hasFreshAccessToken()).toBe(false);
    // Still readable: it is the caller's job to refresh, and a request that
    // races the expiry should send the token rather than no token at all.
    expect(getAccessToken()).toBe('token-1');
  });

  it('treats a token inside the skew window as already stale', () => {
    vi.useFakeTimers();
    setAccessToken({ accessToken: 'token-1', expiresIn: 900 });

    // 880s in: 20 seconds left, which is inside the 30-second skew.
    vi.advanceTimersByTime(880_000);

    expect(hasFreshAccessToken()).toBe(false);
  });

  it('clears on sign-out', () => {
    setAccessToken({ accessToken: 'token-1', expiresIn: 900 });

    clearAccessToken();

    expect(getAccessToken()).toBeNull();
    expect(hasFreshAccessToken()).toBe(false);
  });
});
