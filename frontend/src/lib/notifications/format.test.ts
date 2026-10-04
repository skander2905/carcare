import { describe, expect, it } from 'vitest';
import { badgeCount, timeAgo } from './format';

const NOW = new Date('2026-10-03T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('timeAgo', () => {
  it('counts up from just now', () => {
    expect(timeAgo(ago(20_000), NOW)).toBe('just now');
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe('5 min ago');
    expect(timeAgo(ago(3 * 3_600_000), NOW)).toBe('3 h ago');
    expect(timeAgo(ago(26 * 3_600_000), NOW)).toBe('yesterday');
    expect(timeAgo(ago(4 * 86_400_000), NOW)).toBe('4 days ago');
  });

  it('gives the date once it is more than a week old', () => {
    expect(timeAgo('2026-08-01T08:00:00Z', NOW)).toBe('1 Aug 2026');
  });
});

describe('badgeCount', () => {
  it('stays narrow', () => {
    expect(badgeCount(3)).toBe('3');
    expect(badgeCount(12)).toBe('9+');
  });
});
