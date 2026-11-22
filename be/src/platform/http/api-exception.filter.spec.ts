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
    new ApiExceptionFilter().catch(new Error('database password=secret'), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
