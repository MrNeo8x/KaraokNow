import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('KaraokeNow API')
    .setDescription('Versioned contract for the KaraokeNow modular monolith')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Tenant-ID' }, 'tenant')
    .build();
  return SwaggerModule.createDocument(app, config);
}
