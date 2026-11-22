import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OutboxWorker } from '../src/outbox/outbox.worker';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const worker = app.get(OutboxWorker);
  process.once('SIGINT', () => worker.stop());
  process.once('SIGTERM', () => worker.stop());
  try { await worker.runLoop(); }
  finally { await app.close(); }
}

void run().catch(() => { process.stderr.write('Outbox worker failed to start or shut down\n'); process.exitCode = 1; });
