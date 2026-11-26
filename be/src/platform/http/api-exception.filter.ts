import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { CorrelatedRequest } from '../auth/auth.types';

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 422: 'UNPROCESSABLE_ENTITY', 429: 'TOO_MANY_REQUESTS', 500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE'
};

/** PostgreSQL concurrency aborts that a client can safely retry. */
const RETRYABLE_PG_CODES = new Set(['40P01', '40001']);

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();
    const pgCode = typeof (exception as { code?: unknown })?.code === 'string' ? (exception as { code: string }).code : undefined;
    const retryable = !(exception instanceof HttpException) && pgCode !== undefined && RETRYABLE_PG_CODES.has(pgCode);
    const status = exception instanceof HttpException ? exception.getStatus() : retryable ? HttpStatus.CONFLICT : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse()
      : retryable ? { message: 'The resource was changed concurrently; retry the request' } : null;
    if (status >= 500 || retryable) {
      // Error class and database code only: messages and parameters may contain customer data.
      process.stdout.write(`${JSON.stringify({
        level: status >= 500 ? 'error' : 'warn', event: 'request_failed', correlationId: request.correlationId,
        method: request.method, path: request.originalUrl.split('?')[0], status,
        errorName: exception instanceof Error ? exception.name : typeof exception, pgCode
      })}\n`);
    }
    const rawMessage = typeof payload === 'string' ? payload
      : payload && typeof payload === 'object' && 'message' in payload ? (payload as { message: string | string[] }).message
      : null;
    const messages = Array.isArray(rawMessage) ? rawMessage : rawMessage ? [rawMessage] : [];
    const message = status >= 500 ? 'An unexpected error occurred' : messages[0] ?? 'Request failed';
    response.status(status).json({
      timestamp: new Date().toISOString(), path: request.originalUrl.split('?')[0], correlationId: request.correlationId,
      error: { code: CODES[status] ?? `HTTP_${status}`, message, ...(messages.length > 1 ? { details: messages } : {}) }
    });
  }
}
