import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CreateReportRequest,
  FollowedShop,
  ProductPage,
  ReportReceipt,
  SavedProductCard,
  SavedState,
} from '@xatu/shared';
import { apiRequest } from '../../lib/api';
import { useFeatureFlag } from '../../lib/analytics';
import { useSession } from '../../store/session';
import { shopKeys } from '../shop/api';

/** Refetch the true state only once the last queued toggle has finished, so hearts never flicker. */
function settle(qc: QueryClient, scope: string) {
  const pending = qc.isMutating({ predicate: (m) => m.options.scope?.id === scope });
  if (pending <= 1) void qc.invalidateQueries({ queryKey: socialKeys.state });
}

/** Signed-in only, never persisted (not 'feed'/'categories'), cleared on sign-out. */
export const socialKeys = {
  state: ['social', 'state'] as const,
  saved: ['social', 'saved'] as const,
  following: ['social', 'following'] as const,
};

/** Save, follow, share and report need both flags: product pages come from `catalog`. */
export function useSocialEnabled(): boolean {
  const social = useFeatureFlag('social');
  const catalog = useFeatureFlag('catalog');
  return social && catalog;
}

/** Which products are saved and which shops are followed, for hearts and Follow buttons. */
export function useSavedState() {
  const enabled = useSocialEnabled();
  const signedIn = useSession((s) => s.status === 'signedIn');
  return useQuery({
    queryKey: socialKeys.state,
    enabled: enabled && signedIn,
    queryFn: () => apiRequest<SavedState>('/me/saved'),
    staleTime: 5 * 60_000,
  });
}

export function useIsSaved(productId: string): boolean {
  const { data } = useSavedState();
  return data?.productIds.includes(productId) ?? false;
}

export function useIsFollowing(handle: string): boolean {
  const { data } = useSavedState();
  return data?.shopHandles.includes(handle) ?? false;
}

type Toggle = { on: boolean };

/**
 * Heart toggle. Optimistic: the heart flips at once and flips back if the call fails. Calls for
 * the same product run one after another (scope), and PUT/DELETE are idempotent, so fast
 * double taps end in the state the person last chose.
 */
export function useToggleSave(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: `save:${productId}` },
    mutationFn: ({ on }: Toggle) =>
      apiRequest<void>(`/me/saved-products/${productId}`, { method: on ? 'PUT' : 'DELETE' }),
    onMutate: async ({ on }) => {
      await qc.cancelQueries({ queryKey: socialKeys.state });
      const before = qc.getQueryData<SavedState>(socialKeys.state);
      qc.setQueryData<SavedState>(socialKeys.state, (s) => ({
        shopHandles: s?.shopHandles ?? [],
        productIds: on
          ? [productId, ...(s?.productIds ?? []).filter((id) => id !== productId)]
          : (s?.productIds ?? []).filter((id) => id !== productId),
      }));
      return { before };
    },
    onError: (_err, _vars, context) => {
      if (context?.before) qc.setQueryData(socialKeys.state, context.before);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: socialKeys.saved });
      settle(qc, `save:${productId}`);
    },
  });
}

export function useToggleFollow(handle: string) {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: `follow:${handle}` },
    mutationFn: ({ on }: Toggle) =>
      apiRequest<void>(`/me/following/${handle}`, { method: on ? 'PUT' : 'DELETE' }),
    onMutate: async ({ on }) => {
      await qc.cancelQueries({ queryKey: socialKeys.state });
      const before = qc.getQueryData<SavedState>(socialKeys.state);
      qc.setQueryData<SavedState>(socialKeys.state, (s) => ({
        productIds: s?.productIds ?? [],
        shopHandles: on
          ? [handle, ...(s?.shopHandles ?? []).filter((h) => h !== handle)]
          : (s?.shopHandles ?? []).filter((h) => h !== handle),
      }));
      return { before };
    },
    onError: (_err, _vars, context) => {
      if (context?.before) qc.setQueryData(socialKeys.state, context.before);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: socialKeys.following });
      // The shop page shows the follower count.
      void qc.invalidateQueries({ queryKey: shopKeys.public(handle) });
      settle(qc, `follow:${handle}`);
    },
  });
}

export function useSavedProducts() {
  return useInfiniteQuery({
    queryKey: socialKeys.saved,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiRequest<ProductPage<SavedProductCard>>(
        `/me/saved-products${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useFollowing() {
  return useInfiniteQuery({
    queryKey: socialKeys.following,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiRequest<{ items: FollowedShop[]; nextCursor: string | null }>(
        `/me/following${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useReport() {
  return useMutation({
    mutationFn: (body: CreateReportRequest) =>
      apiRequest<ReportReceipt>('/reports', { method: 'POST', body }),
  });
}
