import { describe, expect, it } from 'vitest';
import { delayUntilSendWindow } from './send-window.js';

const HOUR = 3_600_000;
const TUNIS = 'Africa/Tunis'; // UTC+1, no daylight saving

describe('delayUntilSendWindow', () => {
  it('sends straight away during the day', () => {
    expect(delayUntilSendWindow(new Date('2026-10-03T07:00:00Z'), TUNIS)).toBe(0); // 08:00 local
    expect(delayUntilSendWindow(new Date('2026-10-03T19:59:59Z'), TUNIS)).toBe(0); // 20:59:59
  });

  it('holds a night-time email until 08:00 the same morning', () => {
    // 02:30 in Tunis.
    expect(delayUntilSendWindow(new Date('2026-10-03T01:30:00Z'), TUNIS)).toBe(5.5 * HOUR);
  });

  it('holds a late-evening email until 08:00 the next morning', () => {
    // 21:00 in Tunis: the window has just closed.
    expect(delayUntilSendWindow(new Date('2026-10-03T20:00:00Z'), TUNIS)).toBe(11 * HOUR);
  });

  it("uses the recipient's clock, not the server's", () => {
    const now = new Date('2026-10-03T12:00:00Z'); // 13:00 in Tunis, 08:00 in New York
    expect(delayUntilSendWindow(now, TUNIS)).toBe(0);
    expect(delayUntilSendWindow(now, 'America/New_York')).toBe(0);
    expect(delayUntilSendWindow(now, 'Asia/Tokyo')).toBe(11 * HOUR); // 21:00
  });
});
