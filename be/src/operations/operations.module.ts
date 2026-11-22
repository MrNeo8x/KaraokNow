import { Global, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { RequestMetricsService } from './request-metrics.service';
import { shutdownTelemetry } from '../instrumentation';

@Injectable()
class TelemetryLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}

@Module({
  controllers: [OperationsController],
  providers: [RequestMetricsService, TelemetryLifecycle],
  exports: [RequestMetricsService]
})
@Global()
export class OperationsModule {}
