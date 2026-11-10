import { useTheme } from '@xatu/ui';
import { Stack } from 'expo-router';

export default function ShopLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.surface },
      }}
    />
  );
}
