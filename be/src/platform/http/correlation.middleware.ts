import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { CorrelatedRequest } from '../auth/auth.types';

const CORRELATION_HEADER = 'x-correlation-id';
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const supplied = request.headers[CORRELATION_HEADER];
    request.correlationId = typeof supplied === 'string' && SAFE_CORRELATION_ID.test(supplied) ? supplied : randomUUID();
    response.setHeader('X-Correlation-ID', request.correlationId);
    next();
  }
}
