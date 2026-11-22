import { NestFactory } from '@nestjs/core';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/platform/http/openapi';

// The API contract is shared product documentation at repository root.
const outputPath = resolve('../docs/02-architecture/openapi.json');

async function run(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  const serialized = `${JSON.stringify(createOpenApiDocument(app), null, 2)}\n`;
  await app.close();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(outputPath, 'utf8'); } catch { /* reported as drift */ }
    if (current !== serialized) {
      process.stderr.write('OpenAPI contract is stale. Run npm run openapi:generate.\n');
      process.exitCode = 1;
    } else process.stdout.write('OpenAPI contract is up to date.\n');
    return;
  }
  writeFileSync(outputPath, serialized, 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
}

void run();
