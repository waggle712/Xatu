import type { MyShop, UpdateShopRequest } from '@xatu/shared';
import { router } from 'expo-router';
import { useMyShop, useUpdateShop } from './api';

/** Loads my shop for an editor screen and saves a patch, then goes back. */
export function useShopEditor() {
  const query = useMyShop();
  const shop: MyShop | null | undefined = query.data;
  const update = useUpdateShop(shop?.id ?? '');
  const save = (patch: UpdateShopRequest) =>
    update.mutate(patch, { onSuccess: () => router.back() });
  return { query, shop, update, save };
}
