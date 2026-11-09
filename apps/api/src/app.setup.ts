import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { APP_NAME } from '@xatu/config/brand';
import { ApiExceptionFilter } from './common/api-exception.filter.js';

/** Shared by main.ts and the e2e tests so both run the same app. */
export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new ApiExceptionFilter());
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
