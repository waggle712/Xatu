import { parseShareLink, sharePath } from '@xatu/shared';

/**
 * Shared product/shop links coming into the app. Browsing needs an account (decided 11 Nov 2026),
 * so a link opened while signed out waits here and opens once the person signs in. Only
 * allowlisted paths (parseShareLink) are ever stored or opened, and a link older than 30 minutes
 * is dropped.
 */
const MAX_AGE_MS = 30 * 60_000;

interface Pending {
  path: string;
  at: number;
  /** True once the link was handed over after a sign-in. */
  afterSignIn: boolean;
}

let pending: Pending | null = null;

/**
 * Called for every link that opens the app (`+native-intent`). Returns the screen to open, or
 * null to stay where the app is. Anything but a product or shop page opens the app normally on
 * first launch and is ignored later, so a crafted link can never reach seller or account screens.
 * The link is always remembered: on a cold start the session hasn't loaded yet, so we can't tell
 * here whether the person is signed in.
 */
export function handleIncomingLink(path: string, initial: boolean): string | null {
  const target = parseShareLink(path);
  if (!target) return initial ? '/' : null;
  const screen = sharePath(target);
  pending = { path: screen, at: Date.now(), afterSignIn: false };
  return screen;
}

/** Right after sign-in: the waiting link, if it is still fresh. It stays until its page opens. */
export function takePendingLink(now = Date.now()): string | null {
  if (!pending || now - pending.at > MAX_AGE_MS) {
    pending = null;
    return null;
  }
  pending.afterSignIn = true;
  return pending.path;
}

/**
 * Called when a product or shop page opens. If that page came from a link, forgets the link (so
 * it never opens twice) and says whether a sign-in came in between, for analytics.
 */
export function consumeLink(path: string): { afterSignIn: boolean } | null {
  if (pending?.path !== path) return null;
  const { afterSignIn } = pending;
  pending = null;
  return { afterSignIn };
}

/** On sign-out: drop any waiting link. */
export function clearPendingLink(): void {
  pending = null;
}
