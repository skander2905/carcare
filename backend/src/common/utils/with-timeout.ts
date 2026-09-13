/** Raised when an operation exceeds its deadline. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Bounds an operation that talks to something outside the process.
 *
 * Health probes are the motivating case: a database that accepts the TCP
 * connection but never answers would otherwise hang the probe until the
 * orchestrator's own timeout fires, turning "degraded" into "unresponsive".
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
