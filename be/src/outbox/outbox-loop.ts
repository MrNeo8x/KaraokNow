export type OutboxLoopEvent = { event: 'outbox_worker_error' | 'outbox_worker_recovered'; consecutiveFailures: number; retryMs?: number };

function waitForNext(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function runOutboxLoop(runOnce: () => Promise<number>, signal: AbortSignal,
  emit: (event: OutboxLoopEvent) => void, intervalMs = 1000,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = waitForNext): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      await runOnce();
      if (failures) { emit({ event: 'outbox_worker_recovered', consecutiveFailures: failures }); failures = 0; }
      if (!signal.aborted) await wait(intervalMs, signal);
    } catch {
      if (signal.aborted) break;
      failures++;
      const retryMs = Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5));
      emit({ event: 'outbox_worker_error', consecutiveFailures: failures, retryMs });
      await wait(retryMs, signal);
    }
  }
}
