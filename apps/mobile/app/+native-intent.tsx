import { handleIncomingLink } from '../src/lib/pendingLink';

/**
 * Every link that opens the app (https universal links / App Links and xatu://) comes through
 * here. The allowlist and the "open after sign-in" logic live in src/lib/pendingLink.ts.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    return handleIncomingLink(path, initial);
  } catch {
    return initial ? '/' : null;
  }
}
