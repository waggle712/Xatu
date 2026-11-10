import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../src/components/Placeholder';
import { SearchScreen } from '../../src/features/discovery/SearchScreen';
import { useFeatureFlag } from '../../src/lib/analytics';

export default function DiscoverScreen() {
  const { t } = useTranslation();
  // Search results open product pages, which need `catalog` too.
  const discovery = useFeatureFlag('discovery');
  const catalog = useFeatureFlag('catalog');
  if (discovery && catalog) return <SearchScreen />;
  return <Placeholder title={t('discover.title')} body={t('discover.comingSoon')} />;
}
