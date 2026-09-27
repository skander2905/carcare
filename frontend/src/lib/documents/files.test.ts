import { describe, expect, it } from 'vitest';
import { attachmentProblem, formatFileSize, resolveMimeType } from './files';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('resolveMimeType', () => {
  it('trusts the browser when it knows', () => {
    expect(resolveMimeType(file('scan.pdf', 'application/pdf'))).toBe('application/pdf');
  });

  /** Chrome and Firefox report an iPhone photo with an empty type. */
  it('falls back to the extension for a HEIC the browser does not recognise', () => {
    expect(resolveMimeType(file('IMG_2041.HEIC', ''))).toBe('image/heic');
  });

  it('gives up on an unknown extension', () => {
    expect(resolveMimeType(file('notes.txt', ''))).toBe('');
  });
});

describe('attachmentProblem', () => {
  it('accepts a receipt photo', () => {
    expect(attachmentProblem(file('receipt.jpg', 'image/jpeg'))).toBeNull();
  });

  it.each([
    [file('archive.zip', 'application/zip'), 'is not a photo or a PDF'],
    [file('empty.jpg', 'image/jpeg', 0), 'is empty'],
    [file('huge.pdf', 'application/pdf', 10 * 1024 * 1024 + 1), 'is over 10 MB'],
  ])('refuses %o', (candidate, reason) => {
    expect(attachmentProblem(candidate)).toContain(reason);
  });
});

describe('formatFileSize', () => {
  it.each([
    [512, '512 B'],
    [250_000, '244 KB'],
    [2_400_000, '2.3 MB'],
  ])('%i bytes reads as %s', (bytes, label) => {
    expect(formatFileSize(bytes)).toBe(label);
  });
});
