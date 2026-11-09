import type { PendingVerification } from './phone-auth';

// The Firebase confirmation object can't go through route params, so the phone screen
// leaves it here for the code screen.
let pending: { phone: string; verification: PendingVerification } | null = null;

export function setPendingVerification(value: typeof pending): void {
  pending = value;
}

export function getPendingVerification(): typeof pending {
  return pending;
}
