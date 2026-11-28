import { Global, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { RequestMetricsService } from './request-metrics.service';
import { shutdownTelemetry } from '../instrumentation';
import { ClientIpDiagController } from './client-ip-diag.controller';

@Injectable()
class TelemetryLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}

@Module({
  controllers: [OperationsController, ClientIpDiagController],
  providers: [RequestMetricsService, TelemetryLifecycle],
  exports: [RequestMetricsService]
})
@Global()
export class OperationsModule {}
