// Minimal types for react-native-razorpay 3.x (the package ships none).
declare module 'react-native-razorpay' {
  export interface CheckoutOptions {
    key: string;
    order_id: string;
    amount: number;
    currency: string;
    name: string;
    description?: string;
    prefill?: { contact?: string; email?: string; name?: string };
    theme?: { color?: string };
    config?: Record<string, unknown>;
  }
  const RazorpayCheckout: {
    open(options: CheckoutOptions): Promise<{
      razorpay_payment_id: string;
      razorpay_order_id?: string;
      razorpay_signature?: string;
    }>;
  };
  export default RazorpayCheckout;
}
