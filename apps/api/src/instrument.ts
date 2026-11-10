// Sentry must initialise before anything else; imported first in main.ts.
import * as Sentry from '@sentry/nestjs';
import { env } from './config/env.js';

Sentry.init({
  dsn: env.SENTRY_DSN || undefined,
  enabled: env.SENTRY_DSN !== '',
  environment: env.SENTRY_ENVIRONMENT,
  // Errors only for now; tracing can be enabled later with a sample rate.
  tracesSampleRate: 0,
  // DPDP: no user details, cookies, query strings or request/response bodies;
  // only harmless headers. beforeSend scrubs again as a second line of defence.
  dataCollection: {
    userInfo: false,
    cookies: false,
    urlQueryParams: false,
    httpBodies: [],
    httpHeaders: {
      request: { allow: ['user-agent', 'content-type', 'accept-language'] },
      response: false,
    },
  },
  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});

/** Removes anything that can carry personal data or credentials before an event leaves the server. */
export function scrubSentryEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (/authorization|cookie|idempotency-key/i.test(key))
          event.request.headers[key] = '[redacted]';
      }
    }
  }
  if (event.user) event.user = { id: event.user.id };
  return event;
}
