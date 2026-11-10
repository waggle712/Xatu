import { APP_NAME } from '@xatu/config/brand';
import type { TFunction } from 'i18next';
import { ApiRequestError, NetworkError } from './api';

/** API error codes that have their own translated message. */
const KNOWN_CODES = [
  'handle_taken',
  'shop_exists',
  'shop_incomplete',
  'shop_suspended',
  'shop_changed',
  'invalid_shop_status',
  'forbidden',
  'validation_failed',
  'rate_limited',
  'shop_not_found',
  'category_not_found',
] as const;

/** Any error → a short message in the person's language. Never shows raw server text. */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof NetworkError) return t('errors.network', { app: APP_NAME });
  if (err instanceof ApiRequestError && (KNOWN_CODES as readonly string[]).includes(err.code)) {
    return t(`errors.codes.${err.code}`, { app: APP_NAME });
  }
  return t('errors.generic');
}
