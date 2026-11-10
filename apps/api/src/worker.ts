// Background worker process: runs BullMQ workers (media processing) without the HTTP server.
// Deploy as a second container from the same image: `node dist/src/worker.js` with RUN_WORKERS=true.
import './instrument.js';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { env } from './config/env.js';

async function bootstrap(): Promise<void> {
  if (!env.RUN_WORKERS) throw new Error('worker.js needs RUN_WORKERS=true');
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  new Logger('Worker').log('Workers running');
}
await bootstrap();
