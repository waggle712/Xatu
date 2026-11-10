import { Button, NearMeIcon, Text, useTheme } from '@xatu/ui';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Trichy city centre, used until the maker picks a point. */
const TRICHY: LatLng = { lat: 10.805, lng: 78.6856 };

const googleMapsConfigured =
  (Constants.expoConfig?.extra as { googleMapsConfigured?: boolean } | undefined)
    ?.googleMapsConfigured === true;
const mapAvailable = Platform.OS === 'ios' || (Platform.OS === 'android' && googleMapsConfigured);

interface Props {
  value: LatLng | null;
  onChange: (point: LatLng) => void;
  /** Area and pincode from reverse geocoding, to pre-fill empty fields. */
  onAddressGuess?: (guess: { area?: string; pincode?: string }) => void;
}

/**
 * Pick the exact pickup point: move the map under a fixed centre pin, or use the
 * phone's location. Android needs a Google Maps key; without one only "use my location" shows.
 */
export function LocationPicker({ value, onChange, onAddressGuess }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [camera, setCamera] = useState<LatLng>(value ?? TRICHY);
  const [cameraKey, setCameraKey] = useState(0);
  const [status, setStatus] = useState<'idle' | 'locating' | 'denied'>('idle');

  const useCurrentLocation = async () => {
    setStatus('locating');
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return setStatus('denied');
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      onChange(point);
      setCamera(point);
      setCameraKey((k) => k + 1); // re-centre the map
      const [place] = await Location.reverseGeocodeAsync({
        latitude: point.lat,
        longitude: point.lng,
      }).catch(() => []);
      if (place)
        onAddressGuess?.({
          area: place.district ?? place.subregion ?? undefined,
          pincode: place.postalCode ?? undefined,
        });
    } finally {
      setStatus((s) => (s === 'locating' ? 'idle' : s));
    }
  };

  const onCameraMove = (e: { coordinates: { latitude?: number; longitude?: number } }) => {
    const { latitude, longitude } = e.coordinates;
    if (latitude !== undefined && longitude !== undefined)
      onChange({ lat: latitude, lng: longitude });
  };

  const cameraPosition = { coordinates: { latitude: camera.lat, longitude: camera.lng }, zoom: 16 };

  return (
    <View style={{ gap: theme.space[2] }}>
      {mapAvailable ? (
        <>
          <Text variant="caption" color="inkMuted">
            {t('shop.location.mapHint')}
          </Text>
          <View
            style={[styles.map, { borderRadius: theme.radius.lg, borderColor: theme.colors.line }]}
            accessibilityLabel={t('shop.location.mapHint')}
          >
            {Platform.OS === 'ios' ? (
              <AppleMaps.View
                key={cameraKey}
                style={StyleSheet.absoluteFill}
                cameraPosition={cameraPosition}
                onCameraMove={onCameraMove}
              />
            ) : (
              <GoogleMaps.View
                key={cameraKey}
                style={StyleSheet.absoluteFill}
                cameraPosition={cameraPosition}
                onCameraMove={onCameraMove}
              />
            )}
            <View pointerEvents="none" style={styles.pinWrap}>
              <MapPin
                size={40}
                strokeWidth={2}
                color={theme.colors.plum}
                fill={theme.colors.marigold}
              />
            </View>
          </View>
        </>
      ) : (
        <View
          style={{
            padding: theme.space[4],
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.surfaceWarm,
            gap: theme.space[2],
          }}
        >
          <Text variant="label" color="inkMuted">
            {t('shop.location.noMap')}
          </Text>
          {value ? (
            <Text variant="label" color="sage">
              {t('shop.location.pointSet')} ({value.lat.toFixed(4)}, {value.lng.toFixed(4)})
            </Text>
          ) : null}
        </View>
      )}
      <Button
        variant="secondary"
        label={status === 'locating' ? t('shop.location.locating') : t('shop.location.useCurrent')}
        loading={status === 'locating'}
        icon={<NearMeIcon size={20} color={theme.colors.ink} />}
        onPress={() => void useCurrentLocation()}
      />
      {status === 'denied' ? (
        <Text variant="caption" color="critical" accessibilityLiveRegion="polite">
          {t('shop.location.permissionDenied')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 260, overflow: 'hidden', borderWidth: 1 },
  // The pin's tip sits on the map centre.
  pinWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
});
