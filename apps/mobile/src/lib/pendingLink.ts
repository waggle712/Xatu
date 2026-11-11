import { parseShareLink, sharePath } from '@xatu/shared';

/**
 * A shared product/shop link opened while signed out. Browsing needs an account (decided
 * 11 Nov 2026), so the link waits here and opens once the person signs in. Only allowlisted
 * paths (parseShareLink) are ever stored, and a link older than 30 minutes is dropped.
 */
const MAX_AGE_MS = 30 * 60_000;
let pending: { path: string; at: number } | null = null;

export function rememberLink(link: string): string | null {
  const target = parseShareLink(link);
  if (!target) return null;
  const path = sharePath(target);
  pending = { path, at: Date.now() };
  return path;
}

/** The waiting link, once. */
export function takePendingLink(now = Date.now()): string | null {
  const p = pending;
  pending = null;
  return p && now - p.at <= MAX_AGE_MS ? p.path : null;
}

/** Called when the page opened (or on sign-out) so the link isn't opened a second time. */
export function clearPendingLink(path?: string): void {
  if (!path || pending?.path === path) pending = null;
}
