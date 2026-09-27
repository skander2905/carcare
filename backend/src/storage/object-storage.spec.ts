import { describe, expect, it } from 'vitest';
import { contentDisposition } from './object-storage.js';

describe('contentDisposition', () => {
  it('keeps an ordinary name readable', () => {
    expect(contentDisposition('receipt.jpg')).toBe(
      `inline; filename="receipt.jpg"; filename*=UTF-8''receipt.jpg`,
    );
  });

  it('gives non-ASCII names an exact UTF-8 form and a safe fallback', () => {
    expect(contentDisposition('reçu garage.pdf')).toBe(
      `inline; filename="re_u garage.pdf"; filename*=UTF-8''re%C3%A7u%20garage.pdf`,
    );
  });

  /** An uploader's name must not be able to end the header value or add another header. */
  it('neutralises quotes, backslashes and line breaks', () => {
    const header = contentDisposition('a"; filename="evil.html\r\nX-Injected: 1');

    expect(header).not.toMatch(/[\r\n]/);
    expect(header.split('"').length).toBe(3); // exactly one quoted value
  });
});
