import { Global, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { RequestMetricsService } from './request-metrics.service';
import { shutdownTelemetry } from '../instrumentation';
import { ClientIpDiagController } from './client-ip-diag.controller';
import { JobHealthController } from './job-health.controller';

@Injectable()
class TelemetryLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}

@Module({
  controllers: [OperationsController, ClientIpDiagController, JobHealthController],
  providers: [RequestMetricsService, TelemetryLifecycle],
  exports: [RequestMetricsService]
})
@Global()
export class OperationsModule {}
