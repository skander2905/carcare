import { describe, expect, it } from 'vitest';
import { safeNext } from './login-form';

const ORIGIN = 'http://localhost:3000';
const next = (raw: string | null) => safeNext(raw, ORIGIN);

/**
 * `?next=` is an open redirect waiting to happen: a link to the real login
 * page that bounces the user to an attacker's copy once they have signed in is
 * far more convincing than a lookalike domain on its own.
 */
describe('safeNext', () => {
  it('defaults to the dashboard when there is no destination', () => {
    expect(next(null)).toBe('/dashboard');
    expect(next('')).toBe('/dashboard');
  });

  it('keeps an ordinary in-app path, with its query and fragment', () => {
    expect(next('/vehicles/123/fuel')).toBe('/vehicles/123/fuel');
    expect(next('/vehicles?page=2#top')).toBe('/vehicles?page=2#top');
  });

  it('refuses an absolute URL to another site', () => {
    expect(next('https://evil.example/login')).toBe('/dashboard');
    expect(next('http://evil.example')).toBe('/dashboard');
  });

  it('refuses a protocol-relative URL', () => {
    expect(next('//evil.example')).toBe('/dashboard');
    expect(next('///evil.example')).toBe('/dashboard');
  });

  /*
   * Each of these passes a "starts with a single slash" check and still
   * resolves to another origin — a backslash is a separator to the URL parser,
   * and tab, newline and carriage return are stripped before it parses.
   */
  it('refuses a backslash host', () => {
    expect(next('/\\evil.example')).toBe('/dashboard');
    expect(next('\\\\evil.example')).toBe('/dashboard');
  });

  it('refuses a host smuggled past the parser with a control character', () => {
    expect(next('/\t/evil.example')).toBe('/dashboard');
    expect(next('/\n/evil.example')).toBe('/dashboard');
    expect(next('/\r/evil.example')).toBe('/dashboard');
  });

  it('refuses a javascript: destination', () => {
    expect(next('javascript:alert(1)')).toBe('/dashboard');
  });

  it('refuses a bare path that could be read as a host', () => {
    expect(next('evil.example')).toBe('/evil.example');
  });

  it('normalises what it returns', () => {
    expect(next('/a/../vehicles')).toBe('/vehicles');
    expect(next('http://localhost:3000/vehicles')).toBe('/vehicles');
  });
});
