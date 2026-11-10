import { apiErrorSchema, type AuthSession } from '@xatu/shared';
import { useSession } from '../store/session';
import { API_URL } from './config';
import { readSecure } from './secure';

/** An error returned by the API in the standard { error: { code, message } } shape. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The request never reached the API (offline, DNS, server down). */
export class NetworkError extends Error {}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach the access token and refresh it when needed. Default true. */
  auth?: boolean;
  headers?: Record<string, string>;
}

async function rawRequest<T>(
  path: string,
  options: RequestOptions,
  accessToken?: string | null,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : 'Network request failed');
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiRequestError(res.status, code, message, details);
    }
    throw new ApiRequestError(res.status, 'unknown', `Request failed with ${res.status}`);
  }
  return json as T;
}

let refreshing: Promise<string | null> | null = null;

/** Single-flight refresh: concurrent 401s share one /auth/refresh call. */
async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const refreshToken = await readSecure('refreshToken');
      if (!refreshToken) return null;
      const session = await rawRequest<AuthSession>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      });
      await useSession.getState().updateTokens(session);
      return session.accessToken;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        await useSession.getState().signOut();
        return null;
      }
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (options.auth === false) return rawRequest<T>(path, options);

  const { accessToken, accessTokenExpiresAt } = useSession.getState();
  // Refresh a little before expiry so requests don't fail mid-flight.
  let token =
    accessToken && accessTokenExpiresAt - Date.now() > 30_000
      ? accessToken
      : await refreshAccessToken();
  if (!token) throw new ApiRequestError(401, 'unauthorized', 'Please sign in again.');
  try {
    return await rawRequest<T>(path, options, token);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      token = await refreshAccessToken();
      if (!token) throw err;
      return rawRequest<T>(path, options, token);
    }
    throw err;
  }
}
