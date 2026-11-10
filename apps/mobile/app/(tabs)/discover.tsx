import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../src/components/Placeholder';
import { SearchScreen } from '../../src/features/discovery/SearchScreen';
import { useFeatureFlag } from '../../src/lib/analytics';

export default function DiscoverScreen() {
  const { t } = useTranslation();
  const discovery = useFeatureFlag('discovery');
  if (discovery) return <SearchScreen />;
  return <Placeholder title={t('discover.title')} body={t('discover.comingSoon')} />;
}
