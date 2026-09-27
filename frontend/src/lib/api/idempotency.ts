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
 * which the API rightly refuses with a 422. So the key follows the payload.
 */
export class IdempotencyKeys {
  private current: { payload: string; key: string } | null = null;

  constructor(private readonly generate: () => string = () => crypto.randomUUID()) {}

  keyFor(payload: unknown): string {
    const serialised = JSON.stringify(payload);

    if (this.current?.payload !== serialised) {
      this.current = { payload: serialised, key: this.generate() };
    }

    return this.current.key;
  }

  /** Called once a submission succeeds, so an identical next one is a new expense. */
  reset(): void {
    this.current = null;
  }
}
