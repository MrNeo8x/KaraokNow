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

  it('adds trace identifiers without recording incoming headers', () => {
    const request = {
      method: 'GET', originalUrl: '/v1/health/live', correlationId: 'request-2', headers: {}
    } as unknown as CorrelatedRequest;
    const serialized = JSON.stringify(buildRequestLog(request, 200, 1, {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', traceFlags: 1,
      isRemote: true
    }));
    expect(serialized).toContain('"traceId":"4bf92f3577b34da6a3ce929d0e0e4736"');
    expect(serialized).toContain('"spanId":"00f067aa0ba902b7"');
    expect(serialized).not.toContain('traceparent');
  });
});
