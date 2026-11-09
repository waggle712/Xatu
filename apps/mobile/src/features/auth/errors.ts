import type { TFunction } from 'i18next';
import { APP_NAME } from '@xatu/config/brand';
import { ApiRequestError, NetworkError } from '../../lib/api';
import { WrongCodeError } from './phone-auth';

/** Maps any login error to a short, translated message. */
export function loginErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof NetworkError) return t('errors.network', { app: APP_NAME });
  if (err instanceof WrongCodeError) return t('errors.wrongCode');
  if (err instanceof ApiRequestError) {
    if (err.code === 'invalid_firebase_token') return t('errors.wrongCode');
    if (err.code === 'rate_limited') return t('errors.tooMany');
    return err.message;
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === 'auth/too-many-requests') return t('errors.tooMany');
  if (code === 'auth/network-request-failed') return t('errors.network', { app: APP_NAME });
  return t('errors.generic');
}
