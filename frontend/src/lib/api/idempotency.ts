export interface Submission<T> {
  key: string;
  payload: T;
}

/**
 * Hands out `Idempotency-Key`s so that re-submitting the *same* request reuses
 * its key, and anything else gets a fresh one.
 *
 * The case this exists for: the first submit reached the server and was saved,
 * but the response was lost to a dropped connection. The person sees an error
 * and presses the button again. With the same key the API replays the expense
 * it already filed; with a new one, the cost is counted twice.
 *
 * A key per click would not help, and a key per form would be wrong: change
 * the amount after a failure and the old key now names a different request,
 * which the API rightly refuses with a 422.
 *
 * So a submission is identified by what the person entered, and the payload
 * built from it is frozen alongside the key. Rebuilding it on the retry is not
 * safe: a payload can carry values derived at submit time — an expense dated
 * today is stamped with the current moment — and a retry would then differ
 * from the original, take a new key, and file the duplicate this prevents.
 */
export class IdempotencyKeys {
  private current: { identity: string; submission: Submission<unknown> } | null = null;

  constructor(private readonly generate: () => string = randomUuid) {}

  /**
   * The key and payload for what was entered: the stored ones when `entered`
   * matches the last submission, otherwise a fresh key and a newly built payload.
   */
  submissionFor<T>(entered: unknown, build: () => T): Submission<T> {
    const identity = JSON.stringify(entered);

    if (this.current?.identity !== identity) {
      this.current = { identity, submission: { key: this.generate(), payload: build() } };
    }

    return this.current.submission as Submission<T>;
  }

  /** Called once a submission succeeds, so an identical next one is a new expense. */
  reset(): void {
    this.current = null;
  }
}

/**
 * A random UUID (v4), in any browser context.
 *
 * `crypto.randomUUID` exists only on HTTPS and localhost, so a phone opening
 * the dev server at `http://192.168.x.x` would fail every save without this.
 * `getRandomValues` is available everywhere and is just as random.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
