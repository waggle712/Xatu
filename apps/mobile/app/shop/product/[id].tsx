import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '../../../src/components/Screen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { ErrorState, LoadingState, OfflineBanner } from '../../../src/components/States';
import { useSellerProduct } from '../../../src/features/catalog/api';
import { ProductEditor } from '../../../src/features/catalog/ProductEditor';
import { useMyShop } from '../../../src/features/shop/api';
import { errorMessage } from '../../../src/lib/errors';

/** New listing (`?new=1`, id made on the phone) or editing an existing product. */
export default function ProductEditScreen() {
  const { id, new: isNewParam } = useLocalSearchParams<{ id: string; new?: string }>();
  const isNew = isNewParam === '1';
  const { t } = useTranslation();
  const product = useSellerProduct(id, isNew);
  const shop = useMyShop();
  const query = product.isError ? product : shop;

  return (
    <Screen edges={['top', 'bottom']}>
      <OfflineBanner />
      {product.isPending || shop.isPending ? (
        <LoadingState />
      ) : query.isError || !product.data || !shop.data ? (
        <>
          <ScreenHeader title={t(isNew ? 'catalog.newTitle' : 'catalog.editTitle')} />
          <ErrorState
            message={errorMessage(query.error, t)}
            onRetry={() => {
              void product.refetch();
              void shop.refetch();
            }}
          />
        </>
      ) : (
        <ProductEditor product={product.data} shop={shop.data} isNew={isNew} />
      )}
    </Screen>
  );
}
