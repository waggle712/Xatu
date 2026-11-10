import { APP_NAME } from '@xatu/config/brand';
import type { MyShop } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SectionRow } from '../../src/components/Rows';
import { CoverPhotoEditor } from '../../src/features/media/CoverPhotoEditor';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { EmptyState, ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { useMyShop, useShopAction } from '../../src/features/shop/api';
import { errorMessage } from '../../src/lib/errors';

const DETAILS = ['category', 'story'];
const LOCATION = ['area', 'pickup_address', 'location'];

export default function MyShopScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const query = useMyShop();

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: theme.colors.surface }}
    >
      <ScrollView
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4], flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
        }
      >
        <ScreenHeader title={t('shop.my')} />
        <OfflineBanner />
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
        ) : !query.data ? (
          <EmptyState
            title={t('shop.open')}
            body={t('shop.openBody')}
            action={<Button label={t('shop.open')} onPress={() => router.replace('/shop/new')} />}
          />
        ) : (
          <ShopDashboard shop={query.data} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ShopDashboard({ shop }: { shop: MyShop }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const submit = useShopAction(shop.id, 'submit');
  const pause = useShopAction(shop.id, 'pause');
  const resume = useShopAction(shop.id, 'resume');
  const pending = submit.isPending || pause.isPending || resume.isPending;
  const error = submit.error ?? pause.error ?? resume.error;
  const missing = shop.missingForSubmit;
  const editable = shop.status !== 'suspended';
  const statusColors = {
    draft: theme.colors.surfaceWarm,
    kyc_pending: theme.colors.surfaceWarm,
    active: theme.colors.sageSoft,
    paused: theme.colors.blush,
    suspended: theme.colors.surfaceWarm,
  } as const;

  return (
    <View style={{ gap: theme.space[4], flexGrow: 1 }}>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="title">{shop.businessName}</Text>
        <Text variant="label" color="inkMuted">
          @{shop.handle}
        </Text>
      </View>

      <View
        accessibilityRole="summary"
        style={{
          padding: theme.space[4],
          borderRadius: theme.radius.md,
          backgroundColor: statusColors[shop.status],
        }}
      >
        <Text
          color={
            shop.status === 'active' ? 'sage' : shop.status === 'suspended' ? 'critical' : 'ink'
          }
        >
          {t(`shop.status.${shop.status}`, { app: APP_NAME })}
        </Text>
      </View>

      {editable ? <CoverPhotoEditor shop={shop} /> : null}

      {missing.length > 0 ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" color="inkMuted">
            {t('shop.checklist.title')}
          </Text>
          <Text>{missing.map((m) => t(`shop.checklist.${m}`)).join(' · ')}</Text>
        </View>
      ) : null}

      {editable ? (
        <View style={{ gap: theme.space[2] }}>
          <SectionRow
            label={t('shop.sections.details')}
            done={!missing.some((m) => DETAILS.includes(m))}
            onPress={() => router.push('/shop/details')}
          />
          <SectionRow
            label={t('shop.sections.location')}
            done={!missing.some((m) => LOCATION.includes(m))}
            onPress={() => router.push('/shop/location')}
          />
          <SectionRow
            label={t('shop.sections.hours')}
            done={!missing.includes('opening_hours')}
            onPress={() => router.push('/shop/hours')}
          />
        </View>
      ) : null}

      {shop.status === 'active' || shop.status === 'paused' ? (
        <SectionRow label={t('shop.viewPublic')} onPress={() => router.push(`/s/${shop.handle}`)} />
      ) : null}

      {error ? (
        <Text variant="label" color="critical" accessibilityLiveRegion="polite">
          {errorMessage(error, t)}
        </Text>
      ) : null}

      <View style={{ marginTop: 'auto', gap: theme.space[2] }}>
        {shop.status === 'draft' ? (
          <Button
            label={t('shop.submit')}
            disabled={missing.length > 0}
            loading={submit.isPending}
            onPress={() => submit.mutate()}
          />
        ) : null}
        {shop.status === 'active' ? (
          <Button
            variant="secondary"
            label={t('shop.pause')}
            disabled={pending}
            loading={pause.isPending}
            onPress={() => pause.mutate()}
          />
        ) : null}
        {shop.status === 'paused' ? (
          <Button
            label={t('shop.resume')}
            disabled={pending}
            loading={resume.isPending}
            onPress={() => resume.mutate()}
          />
        ) : null}
      </View>
    </View>
  );
}
