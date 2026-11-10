import { Button } from '@xatu/ui';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../src/components/Placeholder';
import { LoadingState } from '../../src/components/States';
import { useMyShop } from '../../src/features/shop/api';
import { useFeatureFlag } from '../../src/lib/analytics';

/** Sellers will add products here (prompt 11); others can open a shop when the flag is on. */
export default function CreateScreen() {
  const { t } = useTranslation();
  const sellerOnboarding = useFeatureFlag('seller_onboarding');
  const myShop = useMyShop();

  if (myShop.isPending)
    return (
      <Placeholder title={t('create.title')} body="">
        <LoadingState lines={1} />
      </Placeholder>
    );
  if (myShop.data) {
    return (
      <Placeholder title={t('create.title')} body={t('create.sellerBody')}>
        <Button variant="secondary" label={t('shop.my')} onPress={() => router.push('/shop')} />
      </Placeholder>
    );
  }
  return (
    <Placeholder title={t('create.title')} body={t('create.buyerBody')}>
      {sellerOnboarding ? (
        <Button label={t('shop.open')} onPress={() => router.push('/shop/new')} />
      ) : null}
    </Placeholder>
  );
}
