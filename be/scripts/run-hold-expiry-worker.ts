import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { HoldService } from '../src/booking/hold.service';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const holds = app.get(HoldService);
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });
  try {
    while (!stopping) {
      const count = await holds.expireBatch();
      if (count < 100) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally { await app.close(); }
}
void run();
