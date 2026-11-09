import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../src/components/Placeholder';

export default function DiscoverScreen() {
  const { t } = useTranslation();
  return <Placeholder title={t('discover.title')} body={t('discover.comingSoon')} />;
}
