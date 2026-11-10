import { Text } from '@xatu/ui';
import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../src/components/Placeholder';
import { useSession } from '../../src/store/session';

/** Buyers see how to open a shop; sellers will add products here. */
export default function CreateScreen() {
  const { t } = useTranslation();
  const isSeller = useSession((s) => s.user?.isSeller ?? false);
  if (isSeller) return <Placeholder title={t('create.title')} body={t('create.sellerBody')} />;
  return (
    <Placeholder title={t('create.title')} body={t('create.buyerBody')}>
      <Text variant="heading">{t('create.buyerTitle')}</Text>
    </Placeholder>
  );
}
