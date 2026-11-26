import { BadRequestException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  const status = jest.fn();
  const json = jest.fn();
  const request = { originalUrl: '/v1/test?token=secret', correlationId: 'correlation-1' };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ status, json }) })
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    status.mockReset().mockReturnValue({ json });
    json.mockReset();
  });

  it('returns validation details in the standard envelope without query parameters', () => {
    new ApiExceptionFilter().catch(new BadRequestException({ message: ['name is required', 'code is invalid'] }), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      path: '/v1/test', correlationId: 'correlation-1',
      error: { code: 'BAD_REQUEST', message: 'name is required', details: ['name is required', 'code is invalid'] }
    }));
  });

  it('does not expose internal exception messages', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new ApiExceptionFilter().catch(new Error('database password=secret'), host);
    write.mockRestore();
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('maps PostgreSQL deadlock and serialization aborts to a retryable 409', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    for (const code of ['40P01', '40001']) {
      status.mockClear(); json.mockClear();
      new ApiExceptionFilter().catch(Object.assign(new Error('deadlock detected'), { code }), host);
      expect(status).toHaveBeenCalledWith(409);
      expect(json.mock.calls[0][0].error).toEqual({ code: 'CONFLICT', message: 'The resource was changed concurrently; retry the request' });
    }
    write.mockRestore();
  });

  it('logs failed requests with error class and database code but no message or query string', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    new ApiExceptionFilter().catch(Object.assign(new Error('value 0912345678 violates constraint'), { code: '23514' }), host);
    const line = JSON.parse(String(write.mock.calls[0][0]));
    expect(line).toMatchObject({ level: 'error', event: 'request_failed', correlationId: 'correlation-1', path: '/v1/test', status: 500, errorName: 'Error', pgCode: '23514' });
    expect(String(write.mock.calls[0][0])).not.toContain('0912345678');
    expect(String(write.mock.calls[0][0])).not.toContain('secret');
    write.mockRestore();
  });
});
