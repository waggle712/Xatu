import { APP_NAME } from '@xatu/config/brand';
import type { StartPayment } from '@xatu/shared';

export type CheckoutResult = 'closed_after_success' | 'cancelled' | 'failed';

/**
 * Opens Razorpay Checkout (UPI first). The result is only a hint for what to show next: the
 * success callback NEVER marks anything paid. The server verifies payments from Razorpay's
 * webhook or its own fetch, and the app polls for that.
 */
export async function openRazorpayCheckout(
  start: StartPayment,
  opts: { phone?: string; colour: string; description: string },
): Promise<CheckoutResult> {
  // Loaded lazily so screens and tests don't need the native module until Pay is tapped.
  const { default: RazorpayCheckout } = await import('react-native-razorpay');
  try {
    await RazorpayCheckout.open({
      key: start.keyId,
      order_id: start.providerOrderId,
      amount: start.amountPaise,
      currency: start.currency,
      name: APP_NAME,
      description: opts.description,
      prefill: opts.phone ? { contact: opts.phone } : {},
      theme: { color: opts.colour },
      config: {
        display: {
          blocks: { upi: { name: 'UPI', instruments: [{ method: 'upi' }] } },
          sequence: ['block.upi'],
          preferences: { show_default_blocks: true },
        },
      },
    });
    return 'closed_after_success';
  } catch (err) {
    // Razorpay's code 0/2 = closed by the person; anything else = the attempt failed.
    const code = (err as { code?: number })?.code;
    return code === 0 || code === 2 ? 'cancelled' : 'failed';
  }
}
