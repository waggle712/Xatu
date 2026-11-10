import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../src/components/Placeholder';

export default function OrdersScreen() {
  const { t } = useTranslation();
  return <Placeholder title={t('orders.title')} body={t('orders.empty')} />;
}
