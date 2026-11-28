import { drainBatches } from './cron-batches';
import { isAuthorizedCronRequest } from './cron-secret.guard';

describe('isAuthorizedCronRequest', () => {
  const secret = 'a'.repeat(32);
  it('accepts the exact bearer secret', () => expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true));
  it('rejects a wrong or missing header', () => {
    expect(isAuthorizedCronRequest(`Bearer ${'b'.repeat(32)}`, secret)).toBe(false);
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false);
    expect(isAuthorizedCronRequest(undefined, secret)).toBe(false);
  });
  it('rejects everything when the secret is unset or too short', () => {
    expect(isAuthorizedCronRequest('Bearer ', undefined)).toBe(false);
    expect(isAuthorizedCronRequest('Bearer ', '')).toBe(false);
    expect(isAuthorizedCronRequest('Bearer short', 'short')).toBe(false);
  });
});

describe('drainBatches', () => {
  it('stops after a partial batch', async () => {
    const counts = [100, 100, 7];
    const batch = jest.fn(async () => counts.shift()!);
    await expect(drainBatches(batch, 100, 60_000)).resolves.toEqual({ processed: 207, batches: 3, exhausted: true });
  });
  it('stops at the time budget while batches stay full', async () => {
    let t = 0;
    const batch = jest.fn(async () => { t += 10; return 100; });
    await expect(drainBatches(batch, 100, 25, () => t)).resolves.toEqual({ processed: 300, batches: 3, exhausted: false });
  });
});
