import { parseShareLink } from '@xatu/shared';
import { track } from '../src/lib/analytics';
import { rememberLink } from '../src/lib/pendingLink';
import { useSession } from '../src/store/session';

/**
 * Every link that opens the app (https universal links / App Links and xatu://) comes through
 * here. Only a product page or a shop page is allowed; anything else opens the app normally
 * (on first launch) or is ignored, so a crafted link can never jump into seller, account or
 * settings screens.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    const target = parseShareLink(path);
    if (!target) return initial ? '/' : null;
    const signedIn = useSession.getState().status === 'signedIn';
    track('share_link_opened', { target_type: target.type, signed_in: signedIn });
    // Signed out: the screen is protected, so remember it and open it after sign-in.
    return rememberLink(path);
  } catch {
    return initial ? '/' : null;
  }
}
