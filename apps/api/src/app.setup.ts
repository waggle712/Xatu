import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { raw } from 'express';
import { APP_NAME } from '@xatu/config/brand';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { env } from './config/env.js';

/** Shared by main.ts and the e2e tests so both run the same app. */
export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new ApiExceptionFilter());
  if (env.MEDIA_STORAGE === 'local') {
    // Local stand-in for R2 uploads: the raw image body, at most 10 MB.
    app.use('/media/local/upload', raw({ type: () => true, limit: '10mb' }));
  }
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle(`${APP_NAME} API`)
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}
