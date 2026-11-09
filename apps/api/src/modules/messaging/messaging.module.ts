import { Module } from '@nestjs/common';

/**
 * messaging module. Owns its own tables; other modules call its exported service, never its tables.
 * Empty for now.
 */
@Module({})
export class MessagingModule {}
