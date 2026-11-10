import { Button, Text, useTheme } from '@xatu/ui';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { useIsOnline } from '../lib/network';

/** Grey blocks shaped like the content, shown while it loads. */
export function LoadingState({ lines = 4 }: { lines?: number }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t('states.loading')}
      accessibilityRole="progressbar"
      style={{ gap: theme.space[3] }}
    >
      <View
        style={{
          height: 140,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.surfaceWarm,
        }}
      />
      {Array.from({ length: lines }, (_, i) => (
        <View
          key={i}
          style={{
            height: 18,
            width: `${90 - i * 12}%`,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.line,
          }}
        />
      ))}
      <ActivityIndicator color={theme.colors.brand} style={{ marginTop: theme.space[2] }} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: theme.space[4],
        padding: theme.space[6],
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surfaceWarm,
      }}
    >
      <Text variant="heading">{t('states.errorTitle')}</Text>
      <Text color="inkMuted">{message}</Text>
      <Button
        variant="secondary"
        label={t('states.retry')}
        icon={<RefreshCw size={18} strokeWidth={1.75} color={theme.colors.ink} />}
        onPress={onRetry}
      />
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.space[3],
        padding: theme.space[6],
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surfaceWarm,
      }}
    >
      <Text variant="heading">{title}</Text>
      <Text color="inkMuted">{body}</Text>
      {action}
    </View>
  );
}

/** Thin banner while offline; cached data stays on screen underneath. */
export function OfflineBanner() {
  const online = useIsOnline();
  const theme = useTheme();
  const { t } = useTranslation();
  if (online) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        padding: theme.space[3],
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surfaceWarm,
      }}
    >
      <CloudOff size={18} strokeWidth={1.75} color={theme.colors.inkMuted} />
      <Text variant="label" color="inkMuted" style={{ flex: 1 }}>
        {t('states.offline')}
      </Text>
    </View>
  );
}
