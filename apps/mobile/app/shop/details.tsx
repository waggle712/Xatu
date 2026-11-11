import type { MyShop } from '@xatu/shared';
import { Button, Chip, Text, useTheme } from '@xatu/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ToggleRow } from '../../src/components/Rows';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { TextField } from '../../src/components/TextField';
import { useCategories } from '../../src/features/shop/api';
import { useShopEditor } from '../../src/features/shop/useShopEditor';
import { errorMessage } from '../../src/lib/errors';

export default function ShopDetails() {
  const { t } = useTranslation();
  const { query, shop } = useShopEditor();
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('shop.details.title')} />
      <OfflineBanner />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError || !shop ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : (
        <DetailsForm shop={shop} />
      )}
    </Screen>
  );
}

function DetailsForm({ shop }: { shop: MyShop }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const categories = useCategories();
  const { update, save } = useShopEditor();
  const [businessName, setName] = useState(shop.businessName);
  const [categoryId, setCategoryId] = useState(shop.categoryId);
  const [storyEn, setStoryEn] = useState(shop.storyEn ?? '');
  const [storyTa, setStoryTa] = useState(shop.storyTa ?? '');
  const [pickupAvailable, setPickup] = useState(shop.pickupAvailable);
  const [localDelivery, setLocal] = useState(shop.localDelivery);
  const [fee, setFee] = useState(String(Math.round(shop.localDeliveryFeePaise / 100)));
  const feeRupees = /^\d{1,4}$/.test(fee.trim()) ? Number(fee.trim()) : NaN;
  const feeValid =
    !localDelivery || (Number.isInteger(feeRupees) && feeRupees >= 0 && feeRupees <= 1000);

  return (
    <View style={{ gap: theme.space[4], flexGrow: 1 }}>
      <TextField
        label={t('shop.new.name')}
        defaultValue={shop.businessName}
        onChangeText={setName}
        maxLength={60}
      />
      <Text variant="label" color="inkMuted">
        {t('shop.new.category')}
      </Text>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}
        accessibilityRole="radiogroup"
      >
        {(categories.data ?? []).map((c) => (
          <Chip
            key={c.id}
            label={`${c.nameTa} · ${c.nameEn}`}
            selected={categoryId === c.id}
            onPress={() => setCategoryId(c.id)}
          />
        ))}
      </View>
      <TextField
        label={t('shop.details.storyEn')}
        defaultValue={shop.storyEn ?? ''}
        onChangeText={setStoryEn}
        multiline
        maxLength={600}
        style={{ minHeight: 110, textAlignVertical: 'top' }}
      />
      <TextField
        label={t('shop.details.storyTa')}
        defaultValue={shop.storyTa ?? ''}
        onChangeText={setStoryTa}
        multiline
        maxLength={600}
        style={{ minHeight: 110, textAlignVertical: 'top' }}
      />
      <Text variant="caption" color="inkMuted">
        {t('shop.details.storyHint')}
      </Text>
      <ToggleRow label={t('shop.details.pickup')} value={pickupAvailable} onChange={setPickup} />
      <ToggleRow
        label={t('shop.details.localDelivery')}
        value={localDelivery}
        onChange={setLocal}
      />
      {localDelivery ? (
        <TextField
          label={t('shop.details.deliveryFee')}
          value={fee}
          onChangeText={setFee}
          keyboardType="number-pad"
          maxLength={4}
          prefix={<Text variant="label">₹</Text>}
          error={feeValid ? null : t('shop.details.deliveryFeeError')}
        />
      ) : null}
      {update.isError ? (
        <Text variant="label" color="critical" accessibilityLiveRegion="polite">
          {errorMessage(update.error, t)}
        </Text>
      ) : null}
      <Button
        label={t('shop.save')}
        loading={update.isPending}
        disabled={businessName.trim().length < 2 || !feeValid}
        onPress={() =>
          save({
            businessName: businessName.trim(),
            ...(categoryId ? { categoryId } : {}),
            storyEn: storyEn.trim() || null,
            storyTa: storyTa.trim() || null,
            pickupAvailable,
            localDelivery,
            ...(localDelivery ? { localDeliveryFeePaise: feeRupees * 100 } : {}),
          })
        }
        style={{ marginTop: 'auto' }}
      />
    </View>
  );
}
