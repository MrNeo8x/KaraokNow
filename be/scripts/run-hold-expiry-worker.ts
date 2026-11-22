import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { HoldService } from '../src/booking/hold.service';
import { runHoldExpiryLoop } from '../src/booking/hold-expiry-loop';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const holds = app.get(HoldService);
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  try {
    await runHoldExpiryLoop(holds, controller.signal, event => process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`));
  } finally { await app.close(); }
}
void run().catch(() => { process.stderr.write('Hold expiry worker failed to start or shut down\n'); process.exitCode = 1; });
