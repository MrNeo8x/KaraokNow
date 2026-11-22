export interface ExpiryBatchRunner { expireBatch(limit?: number): Promise<number> }
export type ExpiryLoopEvent = { event: 'hold_expiry_error' | 'hold_expiry_recovered'; consecutiveFailures: number; retryMs?: number };

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function runHoldExpiryLoop(
  runner: ExpiryBatchRunner, signal: AbortSignal,
  emit: (event: ExpiryLoopEvent) => void,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = waitForRetry
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const count = await runner.expireBatch();
      if (failures) { emit({ event: 'hold_expiry_recovered', consecutiveFailures: failures }); failures = 0; }
      if (count < 100 && !signal.aborted) await wait(1000, signal);
    } catch {
      if (signal.aborted) break;
      failures++;
      const retryMs = Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5));
      emit({ event: 'hold_expiry_error', consecutiveFailures: failures, retryMs });
      await wait(retryMs, signal);
    }
  }
}
