const MIN_POLL_INTERVAL_MS = 250;
const DEFAULT_POLL_INTERVAL_MS = 1000;
// Larger delays overflow the platform timer and fire after 1ms.
const MAX_POLL_INTERVAL_MS = 2 ** 31 - 1;
const noop = (): void => {};

/** Start a guarded interval in [250ms, 2^31-1ms]; non-finite values use `fallbackMs`, then 1000ms. */
export function createPoller(
  fn: () => void,
  options: { intervalMs: number; fallbackMs?: number; signal?: AbortSignal },
): () => void {
  if (typeof fn !== "function" || options.signal?.aborted) return noop;

  const requestedMs = Number.isFinite(options.intervalMs) ? options.intervalMs : options.fallbackMs;
  const intervalMs = Math.min(
    MAX_POLL_INTERVAL_MS,
    Math.max(
      MIN_POLL_INTERVAL_MS,
      typeof requestedMs === "number" && Number.isFinite(requestedMs)
        ? requestedMs
        : DEFAULT_POLL_INTERVAL_MS,
    ),
  );
  const timer = setInterval(fn, intervalMs);
  let active = true;

  const stop = (): void => {
    if (!active) return;
    active = false;
    clearInterval(timer);
    options.signal?.removeEventListener("abort", stop);
  };

  options.signal?.addEventListener("abort", stop, { once: true });
  return stop;
}
