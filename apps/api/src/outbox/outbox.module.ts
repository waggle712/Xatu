import { Global, Module } from '@nestjs/common';
import { OutboxRelay } from './outbox.relay.js';

/** The outbox relay, shared by every module (each subscribes to the topics it handles). */
@Global()
@Module({ providers: [OutboxRelay], exports: [OutboxRelay] })
export class OutboxModule {}
