import { runHoldExpiryLoop, type ExpiryLoopEvent } from './hold-expiry-loop';

describe('hold expiry worker loop', () => {
  it('backs off after errors without logging error details and resumes polling after recovery', async () => {
    const abort = new AbortController();
    const events: ExpiryLoopEvent[] = [];
    const waits: number[] = [];
    const runner = { expireBatch: jest.fn().mockRejectedValueOnce(new Error('secret')).mockRejectedValueOnce(new Error('other')).mockResolvedValueOnce(100).mockResolvedValueOnce(0) };
    await runHoldExpiryLoop(runner, abort.signal, event => events.push(event), async ms => {
      waits.push(ms);
      if (waits.length === 3) abort.abort();
    });
    expect(waits).toEqual([1000, 2000, 1000]);
    expect(events).toEqual([
      { event: 'hold_expiry_error', consecutiveFailures: 1, retryMs: 1000 },
      { event: 'hold_expiry_error', consecutiveFailures: 2, retryMs: 2000 },
      { event: 'hold_expiry_recovered', consecutiveFailures: 2 }
    ]);
    expect(runner.expireBatch).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(events)).not.toContain('secret');
  });
  it('exits without running a batch when already stopped', async () => {
    const abort = new AbortController(); abort.abort();
    const runner = { expireBatch: jest.fn() };
    await runHoldExpiryLoop(runner, abort.signal, jest.fn());
    expect(runner.expireBatch).not.toHaveBeenCalled();
  });
});
