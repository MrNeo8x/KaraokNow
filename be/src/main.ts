import './instrumentation';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { createOpenApiDocument } from './platform/http/openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (trustProxyHops > 0) app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  app.enableShutdownHooks();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // OPS-005: set SWAGGER_ENABLED=false in production; defaults to enabled for local development.
  if (process.env.SWAGGER_ENABLED !== 'false') SwaggerModule.setup('docs', app, createOpenApiDocument(app));
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
