/**
 * When an email may go out: during the recipient's day, never at 3 a.m.
 *
 * The sweep runs hourly, and a calendar reminder turns due at the owner's
 * midnight — so without this, "insurance renews today" would arrive in the
 * middle of the night. Anything found overnight waits for the morning.
 */

export interface SendWindow {
  /** Local hour the window opens, inclusive. */
  startHour: number;
  /** Local hour it closes, exclusive. */
  endHour: number;
}

export const DEFAULT_SEND_WINDOW: SendWindow = { startHour: 8, endHour: 21 };

/**
 * Milliseconds until the window next opens in `timeZone`; 0 inside it.
 *
 * Counted on the wall clock. Across a daylight-saving change the wait is out by
 * the hour the clocks moved, so the email lands at 7 or 9 instead of 8 — not
 * worth a time-zone database for.
 */
export function delayUntilSendWindow(now: Date, timeZone: string, window = DEFAULT_SEND_WINDOW): number {
  const { hour, minute, second } = wallClock(now, timeZone);
  if (hour >= window.startHour && hour < window.endHour) return 0;

  const secondsIntoDay = hour * 3600 + minute * 60 + second;
  const opensAt = window.startHour * 3600;
  const wait = secondsIntoDay < opensAt ? opensAt - secondsIntoDay : 86_400 - secondsIntoDay + opensAt;
  return wait * 1000 - now.getUTCMilliseconds();
}

function wallClock(instant: Date, timeZone: string): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: part('hour'), minute: part('minute'), second: part('second') };
}
