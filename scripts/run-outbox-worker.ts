import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { OutboxWorker } from '../src/outbox/outbox.worker';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const worker = app.get(OutboxWorker);
  const shutdown = async () => { worker.stop(); await app.close(); };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await worker.runLoop();
}

void run();
