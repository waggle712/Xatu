import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Address, AddressInput, Cart, CreateOrderRequest, OrderView } from '@xatu/shared';
import { useRef } from 'react';
import { ApiRequestError, apiRequest } from '../../lib/api';
import { useFeatureFlag } from '../../lib/analytics';
import { uuidv4 } from '../../lib/uuid';
import { useSession } from '../../store/session';

/** Signed-in only and never persisted (not 'feed'/'categories'); cleared on sign-out. */
export const orderKeys = {
  cart: ['orders', 'cart'] as const,
  list: ['orders', 'list'] as const,
  one: (id: string) => ['orders', 'one', id] as const,
  addresses: ['orders', 'addresses'] as const,
};

/** Bag, checkout and orders need both flags: bag lines open product pages (`catalog`). */
export function useCheckoutEnabled(): boolean {
  const checkout = useFeatureFlag('checkout');
  const catalog = useFeatureFlag('catalog');
  return checkout && catalog;
}

export function useCart() {
  const enabled = useCheckoutEnabled();
  const signedIn = useSession((s) => s.status === 'signedIn');
  return useQuery({
    queryKey: orderKeys.cart,
    enabled: enabled && signedIn,
    queryFn: () => apiRequest<Cart>('/cart'),
  });
}

export function useBagCount(): number {
  const { data } = useCart();
  return data?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
}

export function useSetCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { variantId: string; quantity: number; replaceCart?: boolean }) =>
      apiRequest<Cart>(`/cart/items/${v.variantId}`, {
        method: 'PUT',
        body: { quantity: v.quantity, replaceCart: v.replaceCart ?? false },
      }),
    onSuccess: (cart) => qc.setQueryData(orderKeys.cart, cart),
  });
}

/** The maker already in the bag, when adding from another maker is refused. */
export function otherSellerOf(err: unknown): { businessName: string } | null {
  if (!(err instanceof ApiRequestError) || err.code !== 'cart_other_seller') return null;
  const seller = (err.details as { seller?: { businessName: string } } | undefined)?.seller;
  return seller ?? { businessName: '' };
}

export function useAddresses() {
  return useQuery({
    queryKey: orderKeys.addresses,
    queryFn: async () => (await apiRequest<{ items: Address[] }>('/me/addresses')).items,
  });
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddressInput) =>
      apiRequest<Address>('/me/addresses', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: orderKeys.addresses }),
  });
}

/**
 * Places the order. One Idempotency-Key per attempt: a network retry reuses it (so a slow
 * network can never make two orders), and any final answer from the server (created, or refused
 * like price_changed) starts a new key for the next try.
 */
export function usePlaceOrder() {
  const qc = useQueryClient();
  const key = useRef(uuidv4());
  return useMutation({
    mutationFn: (body: CreateOrderRequest) =>
      apiRequest<OrderView>('/orders', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: (order) => {
      key.current = uuidv4();
      qc.setQueryData(orderKeys.one(order.id), order);
      qc.setQueryData(orderKeys.cart, { seller: null, lines: [], subtotalPaise: 0, options: [] });
      void qc.invalidateQueries({ queryKey: orderKeys.list });
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.code !== 'idempotency_in_progress') {
        key.current = uuidv4();
        void qc.invalidateQueries({ queryKey: orderKeys.cart });
      }
    },
  });
}

export function useOrders() {
  const enabled = useCheckoutEnabled();
  return useQuery({
    queryKey: orderKeys.list,
    enabled,
    queryFn: async () => (await apiRequest<{ items: OrderView[] }>('/orders')).items,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: orderKeys.one(id),
    queryFn: () => apiRequest<OrderView>(`/orders/${id}`),
    // Unpaid orders change on their own (expiry); keep them fresh.
    refetchInterval: (q) => (q.state.data?.status === 'awaiting_payment' ? 30_000 : false),
  });
}

export function useCancelOrder(id: string) {
  const qc = useQueryClient();
  const key = useRef(uuidv4());
  return useMutation({
    mutationFn: () =>
      apiRequest<OrderView>(`/orders/${id}/cancel`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
      }),
    onSuccess: (order) => {
      key.current = uuidv4();
      qc.setQueryData(orderKeys.one(id), order);
      void qc.invalidateQueries({ queryKey: orderKeys.list });
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.code !== 'idempotency_in_progress')
        key.current = uuidv4();
    },
  });
}
