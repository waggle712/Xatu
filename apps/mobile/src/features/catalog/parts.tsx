import type { ProductStatus } from '@xatu/shared';
import { Text, useTheme } from '@xatu/ui';
import { Minus, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import type { UploadState } from '../media/useImageUpload';

/** − n + with 48dp buttons. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const button = (delta: number) => {
    const disabled = value + delta < min || value + delta > max;
    const Icon = delta < 0 ? Minus : Plus;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t(delta < 0 ? 'catalog.details.less' : 'catalog.details.more')}, ${label}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onChange(value + delta)}
        style={(s) => ({
          width: 48,
          height: 48,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.line,
          backgroundColor: theme.colors.surfaceWarm,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : s.pressed ? 0.8 : 1,
        })}
      >
        <Icon size={20} strokeWidth={2} color={theme.colors.ink} />
      </Pressable>
    );
  };
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="inkMuted">
        {label}
      </Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
          if (e.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 56,
          paddingHorizontal: theme.space[3],
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.line,
          backgroundColor: theme.colors.surfaceRaised,
        }}
      >
        <Text variant="heading" style={{ flex: 1 }}>
          {String(value)}
        </Text>
        {button(-1)}
        {button(1)}
      </View>
    </View>
  );
}

export function StatusPill({ status }: { status: ProductStatus }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const bg = {
    draft: theme.colors.surfaceWarm,
    active: theme.colors.sageSoft,
    paused: theme.colors.blush,
    archived: theme.colors.line,
  }[status];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: theme.space[2],
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
      }}
    >
      <Text variant="caption" color={status === 'active' ? 'sage' : 'ink'}>
        {t(`catalog.status.${status}`)}
      </Text>
    </View>
  );
}

/** Preparing / uploading with a progress bar / processing, announced to screen readers. */
export function UploadProgress({ state }: { state: UploadState }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const text =
    state.step === 'preparing'
      ? t('media.preparing')
      : state.step === 'uploading'
        ? t('media.uploading', { percent: Math.round(state.progress * 100) })
        : state.step === 'processing'
          ? t('media.processing')
          : state.step === 'failed'
            ? state.reason === 'rejected' && state.rejectReason
              ? t(`media.rejectReasons.${state.rejectReason}`, {
                  defaultValue: t('media.failed.rejected'),
                })
              : t(`media.failed.${state.reason}`)
            : null;
  if (!text) return null;
  return (
    <View style={{ gap: theme.space[1] }} accessibilityLiveRegion="polite">
      <Text variant="label" color={state.step === 'failed' ? 'critical' : 'ink'}>
        {text}
      </Text>
      {state.step === 'uploading' ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(state.progress * 100) }}
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.colors.line,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.round(state.progress * 100)}%`,
              height: '100%',
              backgroundColor: theme.colors.brandFill,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
