import { roundPoint } from '@xatu/shared';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import type { Point } from './api';

type Status = 'checking' | 'granted' | 'denied' | 'undetermined';

/** Remembered for the app session, so tabs don't ask the GPS again on every visit. */
let lastPoint: Point = null;

/**
 * The buyer's position, rounded to about 1 km before it leaves this hook (it goes into URLs).
 * Never asks for permission by itself: the feed starts from Trichy until the buyer taps
 * "Use my location".
 */
export function useBuyerLocation() {
  const [point, setPoint] = useState<Point>(lastPoint);
  const [status, setStatus] = useState<Status>(lastPoint ? 'granted' : 'checking');

  const locate = useCallback(async () => {
    const known = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
    const pos =
      known ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    lastPoint = roundPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    setPoint(lastPoint);
  }, []);

  useEffect(() => {
    if (lastPoint) return;
    void Location.getForegroundPermissionsAsync().then(async (perm) => {
      if (perm.granted) {
        setStatus('granted');
        await locate().catch(() => undefined);
      } else {
        setStatus(perm.canAskAgain ? 'undetermined' : 'denied');
      }
    });
  }, [locate]);

  const request = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setStatus('denied');
      return;
    }
    setStatus('granted');
    await locate().catch(() => undefined);
  }, [locate]);

  return { point, status, request };
}
