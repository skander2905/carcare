import { describe, expect, it } from 'vitest';
import { safeNext } from './login-form';

/**
 * `?next=` is an open-redirect waiting to happen: a link to our own real login
 * page that bounces the user to an attacker's copy after they sign in is far
 * more convincing than a lookalike domain on its own.
 */
describe('safeNext', () => {
  it('defaults to the dashboard when there is no destination', () => {
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext('')).toBe('/dashboard');
  });

  it('keeps an ordinary in-app path', () => {
    expect(safeNext('/vehicles/123/fuel')).toBe('/vehicles/123/fuel');
  });

  it('refuses an absolute URL to another site', () => {
    expect(safeNext('https://evil.example/login')).toBe('/dashboard');
    expect(safeNext('http://evil.example')).toBe('/dashboard');
  });

  it('refuses a protocol-relative URL', () => {
    // `//evil.example` is a full URL to another host, and looks like a path.
    expect(safeNext('//evil.example')).toBe('/dashboard');
    expect(safeNext('///evil.example')).toBe('/dashboard');
  });

  it('refuses a javascript: destination', () => {
    expect(safeNext('javascript:alert(1)')).toBe('/dashboard');
  });

  it('refuses a bare path that could be read as a host', () => {
    expect(safeNext('evil.example')).toBe('/dashboard');
  });
});
