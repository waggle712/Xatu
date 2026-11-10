import type { AuthSession, CreateSessionRequest, Me } from '@xatu/shared';
import { apiRequest } from '../../lib/api';
import { readSecure } from '../../lib/secure';
import { useSession } from '../../store/session';
import { signOutOfFirebase } from './phone-auth';

export function createSession(input: CreateSessionRequest): Promise<AuthSession> {
  return apiRequest<AuthSession>('/auth/session', { method: 'POST', body: input, auth: false });
}

export function fetchMe(): Promise<Me> {
  return apiRequest<Me>('/me');
}

/** Revokes the session on the API (best effort), then clears it on the phone. */
export async function logout(): Promise<void> {
  const refreshToken = await readSecure('refreshToken');
  if (refreshToken) {
    await apiRequest('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(
      () => undefined,
    );
  }
  await signOutOfFirebase();
  await useSession.getState().signOut();
}
