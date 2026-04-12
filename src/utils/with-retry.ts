/**
 * Generic exponential-backoff retry with jitter.
 *
 * Previously copy-pasted across yahoo-quote-client and screener-fundamentals-fetcher
 * with identical bodies differing only in log label. Extracted here so retry
 * behaviour is consistent across upstream data sources — if we need to tune
 * the backoff curve or add circuit breakers, it happens in one place.
 */

export interface WithRetryOptions {
  /** Label used in warn logs so operators can tell callers apart. */
  label: string;
  /** Number of retries after the first attempt. Default 3 → up to 4 total calls. */
  maxRetries?: number;
  /** Base delay in ms; attempt N waits base * 2^N + jitter. Default 1000. */
  baseDelayMs?: number;
  /** Max random jitter added on top of the computed delay. Default 500. */
  jitterMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const jitterMs = opts.jitterMs ?? 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * baseDelayMs + Math.random() * jitterMs;
      console.warn(
        `[rate-limit] ${opts.label} retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`
      );
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }
  // Unreachable — the loop always returns or throws above.
  throw new Error("withRetry: unreachable");
}
