import { AUTH_MODE } from '../../lib/config';

/** A code was sent; confirm() returns a Firebase ID token for POST /auth/session. */
export interface PendingVerification {
  confirm(code: string): Promise<string>;
}

export class WrongCodeError extends Error {}

/**
 * Starts phone verification. With Firebase configured this sends a real SMS (or uses a
 * Firebase test number). In development mode no SMS is sent and the API's AUTH_DEV_BYPASS
 * accepts code 123456.
 */
export async function sendVerificationCode(phoneE164: string): Promise<PendingVerification> {
  if (AUTH_MODE === 'dev') {
    return { confirm: async (code) => `dev|${phoneE164}|${code}` };
  }

  // Loaded lazily so development builds without Firebase files never touch the native module.
  const { getAuth, signInWithPhoneNumber } = await import('@react-native-firebase/auth');
  const confirmation = await signInWithPhoneNumber(getAuth(), phoneE164);
  return {
    confirm: async (code) => {
      try {
        const credential = await confirmation.confirm(code);
        const user = credential?.user ?? getAuth().currentUser;
        if (!user) throw new WrongCodeError('No Firebase user after confirming code');
        return await user.getIdToken();
      } catch (err) {
        const code_ = (err as { code?: string }).code;
        if (code_ === 'auth/invalid-verification-code' || code_ === 'auth/session-expired') {
          throw new WrongCodeError(code_);
        }
        throw err;
      }
    },
  };
}

/** Signs out of Firebase too, so the next login asks for a fresh code. */
export async function signOutOfFirebase(): Promise<void> {
  if (AUTH_MODE === 'dev') return;
  const { getAuth, signOut } = await import('@react-native-firebase/auth');
  await signOut(getAuth()).catch(() => undefined);
}
