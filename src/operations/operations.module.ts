import { Global, Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { RequestMetricsService } from './request-metrics.service';

@Module({
  controllers: [OperationsController],
  providers: [RequestMetricsService],
  exports: [RequestMetricsService]
})
@Global()
export class OperationsModule {}
