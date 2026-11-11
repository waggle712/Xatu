import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentView, StartPayment } from '@xatu/shared';
import { useRef } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api';
import { uuidv4 } from '../../lib/uuid';
import { orderKeys } from '../orders/api';

export const paymentKeys = { one: (id: string) => ['payments', 'one', id] as const };

/** Starts (or reuses) the order's payment. One Idempotency-Key per attempt; new after any answer. */
export function useStartPayment(orderId: string) {
  const key = useRef(uuidv4());
  return useMutation({
    mutationFn: () =>
      apiRequest<StartPayment>(`/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
      }),
    onSettled: (_data, err) => {
      if (!err || (err instanceof ApiRequestError && err.code !== 'idempotency_in_progress')) {
        key.current = uuidv4();
      }
    },
  });
}

/**
 * Polls a payment while it's being confirmed (every 3 s for the first minutes). Each poll may
 * make the server check with Razorpay itself, so a missing webhook still resolves quickly.
 */
export function usePaymentStatus(paymentId: string | null, orderId: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: paymentKeys.one(paymentId ?? 'none'),
    enabled: !!paymentId,
    queryFn: async () => {
      const p = await apiRequest<PaymentView>(`/payments/${paymentId}`);
      if (p.status !== 'pending' && p.status !== 'initiated') {
        void qc.invalidateQueries({ queryKey: orderKeys.one(orderId) });
        void qc.invalidateQueries({ queryKey: orderKeys.list });
      }
      return p;
    },
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s && s !== 'pending' && s !== 'initiated') return false;
      return q.state.dataUpdateCount < 40 ? 3_000 : 30_000;
    },
  });
}
