import { runOutboxLoop, type OutboxLoopEvent } from './outbox-loop';

describe('outbox worker loop', () => {
  it('retries failures with bounded backoff and does not expose error messages', async () => {
    const abort = new AbortController();
    const events: OutboxLoopEvent[] = [], waits: number[] = [];
    const runOnce = jest.fn().mockRejectedValueOnce(new Error('secret')).mockRejectedValueOnce(new Error('other')).mockResolvedValueOnce(0);
    await runOutboxLoop(runOnce, abort.signal, event => events.push(event), 1000, async ms => {
      waits.push(ms); if (waits.length === 3) abort.abort();
    });
    expect(waits).toEqual([1000, 2000, 1000]);
    expect(events).toEqual([{ event: 'outbox_worker_error', consecutiveFailures: 1, retryMs: 1000 },
      { event: 'outbox_worker_error', consecutiveFailures: 2, retryMs: 2000 },
      { event: 'outbox_worker_recovered', consecutiveFailures: 2 }]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });
  it('does not start a batch after shutdown', async () => {
    const abort = new AbortController(); abort.abort();
    const runOnce = jest.fn(); await runOutboxLoop(runOnce, abort.signal, jest.fn());
    expect(runOnce).not.toHaveBeenCalled();
  });
});
