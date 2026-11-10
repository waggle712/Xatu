import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ProductCard,
  ProductDraft,
  ProductPage,
  PublicProduct,
  SellerProduct,
  SellerProductCard,
} from '@xatu/shared';
import { apiRequest } from '../../lib/api';

export const catalogKeys = {
  mine: (archived = false) => ['catalog', 'mine', archived] as const,
  own: (id: string) => ['catalog', 'own', id] as const,
  public: (id: string) => ['catalog', 'public', id] as const,
  shop: (handle: string) => ['catalog', 'shop', handle] as const,
};

export function useMyProducts(archived = false) {
  return useQuery({
    queryKey: catalogKeys.mine(archived),
    queryFn: async () =>
      (
        await apiRequest<{ items: SellerProductCard[] }>(
          `/seller/products${archived ? '?archived=true' : ''}`,
        )
      ).items,
  });
}

/**
 * Opens a product for editing. For a new listing the app made the id; the create call is
 * idempotent, so opening the same id twice (or retrying on a bad network) is safe.
 */
export function useSellerProduct(id: string, isNew: boolean) {
  return useQuery({
    queryKey: catalogKeys.own(id),
    queryFn: () =>
      isNew
        ? apiRequest<SellerProduct>('/seller/products', { method: 'POST', body: { id } })
        : apiRequest<SellerProduct>(`/seller/products/${id}`),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function usePublicProduct(id: string) {
  return useQuery({
    queryKey: catalogKeys.public(id),
    queryFn: () => apiRequest<PublicProduct>(`/products/${id}`, { auth: false }),
  });
}

export function useShopProducts(handle: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: catalogKeys.shop(handle),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiRequest<ProductPage<ProductCard>>(
        `/shops/${encodeURIComponent(handle)}/products${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { auth: false },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function saveDraft(id: string, patch: ProductDraft): Promise<SellerProduct> {
  return apiRequest<SellerProduct>(`/seller/products/${id}`, { method: 'PATCH', body: patch });
}

/** Writes a fresh seller product into the cache and refreshes the lists that show it. */
export function useApplyProduct() {
  const qc = useQueryClient();
  return (product: SellerProduct) => {
    qc.setQueryData(catalogKeys.own(product.id), product);
    void qc.invalidateQueries({ queryKey: ['catalog', 'mine'] });
    void qc.invalidateQueries({ queryKey: ['catalog', 'public', product.id] });
    void qc.invalidateQueries({ queryKey: ['catalog', 'shop'] });
    void qc.invalidateQueries({ queryKey: ['shop', 'public'] });
  };
}

function useProductMutation<TVars>(fn: (vars: TVars) => Promise<SellerProduct>) {
  const apply = useApplyProduct();
  return useMutation({ mutationFn: fn, onSuccess: apply });
}

export function useSetPhotos(id: string) {
  return useProductMutation((mediaIds: string[]) =>
    apiRequest<SellerProduct>(`/seller/products/${id}/photos`, {
      method: 'PUT',
      body: { mediaIds },
    }),
  );
}

export function useSetStock(productId: string) {
  return useProductMutation(({ variantId, stock }: { variantId: string; stock: number }) =>
    apiRequest<SellerProduct>(`/seller/products/${productId}/variants/${variantId}/stock`, {
      method: 'POST',
      body: { stock },
    }),
  );
}

export type ProductAction = 'publish' | 'pause' | 'resume' | 'archive' | 'restore';

export function useProductAction(id: string) {
  return useProductMutation((action: ProductAction) =>
    apiRequest<SellerProduct>(`/seller/products/${id}/${action}`, { method: 'POST' }),
  );
}
