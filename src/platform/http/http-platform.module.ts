import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './api-exception.filter';
import { CorrelationMiddleware } from './correlation.middleware';
import { RequestLoggerMiddleware } from './request-logger.middleware';
import { OperationsModule } from '../../operations/operations.module';

@Module({
  imports: [OperationsModule],
  providers: [CorrelationMiddleware, RequestLoggerMiddleware, { provide: APP_FILTER, useClass: ApiExceptionFilter }],
  exports: [CorrelationMiddleware, RequestLoggerMiddleware]
})
export class HttpPlatformModule {}
