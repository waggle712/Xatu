/**
 * The one place the product name lives. Never hard-code it anywhere else:
 * import { APP_NAME } from '@xatu/config/brand'.
 */
export const APP_NAME = 'Xatu';

export const APP_TAGLINE = 'Made nearby. Bought with trust.';

/** Pilot city for the first launch. */
export const PILOT_CITY = 'Trichy';

/** iOS bundle id and Android package name. Also used by the link files the API serves. */
export const APP_ID = 'in.xatu.app';

/** Custom URL scheme for app links (xatu://p/<id>). */
export const APP_SCHEME = 'xatu';
