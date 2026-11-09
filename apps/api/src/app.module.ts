import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.js';
import { domainModules } from './modules/index.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, HealthModule, ...domainModules],
})
export class AppModule {}
