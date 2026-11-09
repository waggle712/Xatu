import * as SecureStore from 'expo-secure-store';

// Tokens live in the Keychain (iOS) / Keystore-backed storage (Android), never AsyncStorage.
const KEYS = {
  refreshToken: 'xatu.refreshToken',
  user: 'xatu.user',
  language: 'xatu.language',
} as const;
type Key = keyof typeof KEYS;

export async function readSecure(key: Key): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEYS[key]);
  } catch {
    return null;
  }
}

export async function writeSecure(key: Key, value: string | null): Promise<void> {
  if (value === null) await SecureStore.deleteItemAsync(KEYS[key]);
  else await SecureStore.setItemAsync(KEYS[key], value);
}
