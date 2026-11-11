import '../src/lib/i18n';
import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  HindMadurai_400Regular,
  HindMadurai_500Medium,
  HindMadurai_600SemiBold,
} from '@expo-google-fonts/hind-madurai';
import {
  NotoSerifTamil_600SemiBold,
  NotoSerifTamil_700Bold,
} from '@expo-google-fonts/noto-serif-tamil';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider, useTheme } from '@xatu/ui';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setupOnlineManager } from '../src/lib/network';
import { takePendingLink } from '../src/lib/pendingLink';
import {
  cacheBuster,
  PERSIST_MAX_AGE,
  persister,
  queryClient,
  shouldPersist,
} from '../src/lib/queryClient';
import { initSentry, withSentry } from '../src/lib/sentry';
import { useSession } from '../src/store/session';

initSentry();
setupOnlineManager();
void SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    NotoSerifTamil_600SemiBold,
    NotoSerifTamil_700Bold,
    HindMadurai_400Regular,
    HindMadurai_500Medium,
    HindMadurai_600SemiBold,
  });
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id);
  const restore = useSession((s) => s.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  const ready = fontsLoaded && status !== 'loading';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: PERSIST_MAX_AGE,
            buster: cacheBuster(userId),
            dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
          }}
        >
          <RootStack signedIn={status === 'signedIn'} />
        </PersistQueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootStack({ signedIn }: { signedIn: boolean }) {
  const theme = useTheme();
  // A shared link opened while signed out opens right after sign-in.
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (signedIn && !wasSignedIn.current) {
      const link = takePendingLink();
      if (link) setTimeout(() => router.push(link as never), 0);
    }
    wasSignedIn.current = signedIn;
  }, [signedIn]);
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.surface },
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="shop" />
          <Stack.Screen name="s/[handle]" />
          <Stack.Screen name="p/[id]" />
          <Stack.Screen name="saved" />
          <Stack.Screen name="following" />
          <Stack.Screen name="report" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default withSentry(RootLayout);
