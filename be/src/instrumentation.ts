import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NoopSpanProcessor } from '@opentelemetry/sdk-trace';

function getTraceEndpoint(): string | undefined {
  const explicit = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (explicit) return explicit;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim().replace(/\/$/, '');
  return base ? `${base}/v1/traces` : undefined;
}

const traceEndpoint = getTraceEndpoint();
const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME || 'karaokenow-backend',
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) => request.url?.split('?')[0] === '/v1/metrics'
    }),
    new ExpressInstrumentation(),
    new PgInstrumentation({ enhancedDatabaseReporting: false })
  ],
  ...(traceEndpoint
    ? { traceExporter: new OTLPTraceExporter({ url: traceEndpoint }) }
    : { spanProcessors: [new NoopSpanProcessor()] })
});

sdk.start();

export function shutdownTelemetry(): Promise<void> {
  return sdk.shutdown();
}
