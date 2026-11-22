import type { CorrelatedRequest } from '../auth/auth.types';
import { buildRequestLog } from './request-logger.middleware';

describe('structured request logging', () => {
  it('logs only allowlisted metadata and strips query strings and secrets', () => {
    const request = {
      method: 'POST', originalUrl: '/v1/auth/login?password=secret', correlationId: 'request-1',
      headers: { authorization: 'Bearer secret-token' }, body: { password: 'secret-password' }
    } as unknown as CorrelatedRequest;
    const serialized = JSON.stringify(buildRequestLog(request, 401, 12.5));
    expect(serialized).toContain('/v1/auth/login');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('password');
  });
});
