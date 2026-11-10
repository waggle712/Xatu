import type { MyShop } from '@xatu/shared';
import { Button, Text, useTheme } from '@xatu/ui';
import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { TextField } from '../../src/components/TextField';
import { type LatLng, LocationPicker } from '../../src/features/shop/LocationPicker';
import { useShopEditor } from '../../src/features/shop/useShopEditor';
import { errorMessage } from '../../src/lib/errors';

export default function ShopLocation() {
  const { t } = useTranslation();
  const { query, shop } = useShopEditor();
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('shop.location.title')} />
      <OfflineBanner />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError || !shop ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : (
        <LocationForm shop={shop} />
      )}
    </Screen>
  );
}

function LocationForm({ shop }: { shop: MyShop }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { update, save } = useShopEditor();
  const [point, setPoint] = useState<LatLng | null>(shop.location);
  const [areaName, setArea] = useState(shop.areaName ?? '');
  const [pincode, setPincode] = useState(shop.pincode ?? '');
  const [address, setAddress] = useState(shop.pickupAddressLine ?? '');
  const [landmark, setLandmark] = useState(shop.pickupLandmark ?? '');
  const pincodeValid = pincode === '' || /^[1-9]\d{5}$/.test(pincode);
  const canSave = areaName.trim().length >= 2 && address.trim().length >= 5 && pincodeValid;

  return (
    <View style={{ gap: theme.space[4], flexGrow: 1 }}>
      <LocationPicker
        value={point}
        onChange={setPoint}
        onAddressGuess={(g) => {
          if (!areaName && g.area) setArea(g.area);
          if (!pincode && g.pincode) setPincode(g.pincode);
        }}
      />
      <TextField
        label={t('shop.location.area')}
        value={areaName}
        onChangeText={setArea}
        placeholder={t('shop.location.areaPlaceholder')}
        maxLength={60}
      />
      <TextField
        label={t('shop.location.pincode')}
        value={pincode}
        onChangeText={(v) => setPincode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        error={pincodeValid ? null : t('errors.codes.validation_failed')}
      />
      <View
        style={{
          flexDirection: 'row',
          gap: theme.space[2],
          alignItems: 'center',
          padding: theme.space[3],
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.sageSoft,
        }}
      >
        <Lock size={18} strokeWidth={1.75} color={theme.colors.sage} />
        <Text variant="label" color="sage" style={{ flex: 1 }}>
          {t('shop.location.privacy')}
        </Text>
      </View>
      <TextField
        label={t('shop.location.address')}
        defaultValue={shop.pickupAddressLine ?? ''}
        onChangeText={setAddress}
        multiline
        maxLength={200}
        style={{ minHeight: 72, textAlignVertical: 'top' }}
      />
      <Text variant="caption" color="inkMuted">
        {t('shop.location.addressHint')}
      </Text>
      <TextField
        label={t('shop.location.landmark')}
        defaultValue={shop.pickupLandmark ?? ''}
        onChangeText={setLandmark}
        maxLength={100}
      />
      {update.isError ? (
        <Text variant="label" color="critical" accessibilityLiveRegion="polite">
          {errorMessage(update.error, t)}
        </Text>
      ) : null}
      <Button
        label={t('shop.save')}
        disabled={!canSave}
        loading={update.isPending}
        onPress={() =>
          save({
            areaName: areaName.trim(),
            ...(pincode ? { pincode } : {}),
            pickupAddressLine: address.trim(),
            pickupLandmark: landmark.trim() || null,
            ...(point ? { location: point } : {}),
          })
        }
      />
    </View>
  );
}
