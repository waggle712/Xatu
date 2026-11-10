import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Category,
  CreateShopRequest,
  MyShop,
  PublicShop,
  UpdateShopRequest,
} from '@xatu/shared';
import { apiRequest } from '../../lib/api';

export const shopKeys = {
  mine: ['shop', 'mine'] as const,
  public: (handle: string) => ['shop', 'public', handle] as const,
  categories: ['categories'] as const,
};

export function useCategories() {
  return useQuery({
    queryKey: shopKeys.categories,
    queryFn: () => apiRequest<Category[]>('/categories', { auth: false }),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useMyShop() {
  return useQuery({
    queryKey: shopKeys.mine,
    queryFn: async () => (await apiRequest<{ shop: MyShop | null }>('/sellers/me')).shop,
  });
}

export function usePublicShop(handle: string) {
  return useQuery({
    queryKey: shopKeys.public(handle),
    queryFn: () => apiRequest<PublicShop>(`/shops/${encodeURIComponent(handle)}`, { auth: false }),
  });
}

export async function checkHandle(handle: string): Promise<boolean> {
  const res = await apiRequest<{ available: boolean }>(
    `/sellers/handle-available?handle=${encodeURIComponent(handle)}`,
  );
  return res.available;
}

function useShopMutation<TVars>(fn: (vars: TVars) => Promise<MyShop>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (shop) => {
      qc.setQueryData(shopKeys.mine, shop);
      void qc.invalidateQueries({ queryKey: ['shop', 'public', shop.handle] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useCreateShop() {
  return useShopMutation((input: CreateShopRequest) =>
    apiRequest<MyShop>('/sellers', { method: 'POST', body: input }),
  );
}

export function useUpdateShop(id: string) {
  return useShopMutation((patch: UpdateShopRequest) =>
    apiRequest<MyShop>(`/sellers/${id}`, { method: 'PATCH', body: patch }),
  );
}

export function useShopAction(id: string, action: 'submit' | 'pause' | 'resume') {
  return useShopMutation(() => apiRequest<MyShop>(`/sellers/${id}/${action}`, { method: 'POST' }));
}

/** Suggests a shop link from the name: "Meena Clay Studio" → "meenaclaystudio". */
export function suggestHandle(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 30);
}
