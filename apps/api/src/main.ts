import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  configureApp(app);
  await app.listen(env.PORT);
}
await bootstrap();
