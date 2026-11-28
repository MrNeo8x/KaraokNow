/** Runs `batch` until it processes fewer than `fullBatch` items or the time budget is spent. */
export async function drainBatches(batch: () => Promise<number>, fullBatch: number, budgetMs: number,
                                   now: () => number = Date.now): Promise<{ processed: number; batches: number; exhausted: boolean }> {
  const deadline = now() + budgetMs;
  let processed = 0; let batches = 0;
  for (;;) {
    const count = await batch();
    processed += count; batches++;
    if (count < fullBatch) return { processed, batches, exhausted: true };
    if (now() >= deadline) return { processed, batches, exhausted: false };
  }
}
