import { describe, expect, it } from 'vitest';
import { resolveApiOrigin } from './env';

describe('resolveApiOrigin', () => {
  it('keeps the configured API when the page is on this computer', () => {
    expect(resolveApiOrigin('http://localhost:3001', 'localhost')).toBe('http://localhost:3001');
    expect(resolveApiOrigin('http://localhost:3001', undefined)).toBe('http://localhost:3001');
  });

  it("follows a phone to the computer's address, keeping the API's port", () => {
    expect(resolveApiOrigin('http://localhost:3001', '192.168.1.28')).toBe('http://192.168.1.28:3001');
  });

  it('never rewrites a real API domain', () => {
    expect(resolveApiOrigin('https://api.carcare.tn', 'carcare.vercel.app')).toBe('https://api.carcare.tn');
  });

  it("uses the page's own address when the site forwards /api (online)", () => {
    expect(resolveApiOrigin('same-origin', 'carcare.vercel.app', 'https://carcare.vercel.app')).toBe(
      'https://carcare.vercel.app',
    );
    // On the server there is no page; links are relative, and only the browser calls the API.
    expect(resolveApiOrigin('same-origin', undefined, undefined)).toBe('');
  });
});
