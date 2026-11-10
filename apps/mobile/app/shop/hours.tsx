import {
  type MyShop,
  type OpeningHours,
  openingHoursSchema,
  WEEKDAYS,
  type Weekday,
} from '@xatu/shared';
import { Button, Text, Toggle, useTheme } from '@xatu/ui';
import { Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { ErrorState, LoadingState, OfflineBanner } from '../../src/components/States';
import { useShopEditor } from '../../src/features/shop/useShopEditor';
import { errorMessage } from '../../src/lib/errors';

type Range = { open: string; close: string };

export default function ShopHours() {
  const { t } = useTranslation();
  const { query, shop } = useShopEditor();
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('shop.hours.title')} />
      <OfflineBanner />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError || !shop ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : (
        <HoursForm shop={shop} />
      )}
    </Screen>
  );
}

/** "0930" → "09:30" while typing. */
function formatTime(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function HoursForm({ shop }: { shop: MyShop }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { update, save } = useShopEditor();
  const [hours, setHours] = useState<Record<Weekday, Range[]>>(
    () =>
      Object.fromEntries(WEEKDAYS.map((d) => [d, shop.openingHours[d] ?? []])) as Record<
        Weekday,
        Range[]
      >,
  );
  const parsed = openingHoursSchema.safeParse(hours);

  const setDay = (day: Weekday, ranges: Range[]) => setHours((h) => ({ ...h, [day]: ranges }));

  return (
    <View style={{ gap: theme.space[3], flexGrow: 1 }}>
      {WEEKDAYS.map((day) => {
        const ranges = hours[day];
        const open = ranges.length > 0;
        const dayName = t(`shop.hours.days.${day}`);
        return (
          <View
            key={day}
            style={{
              gap: theme.space[2],
              padding: theme.space[3],
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.line,
              backgroundColor: theme.colors.surfaceRaised,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 48,
                gap: theme.space[2],
              }}
            >
              <Text variant="heading" style={{ flex: 1 }}>
                {dayName}
              </Text>
              <Text variant="label" color="inkMuted">
                {open ? t('shop.hours.open') : t('shop.hours.closed')}
              </Text>
              <Toggle
                accessibilityLabel={dayName}
                value={open}
                onChange={(v) => setDay(day, v ? [{ open: '09:00', close: '18:00' }] : [])}
              />
            </View>
            {ranges.map((r, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space[2],
                  flexWrap: 'wrap',
                }}
              >
                <TimeInput
                  label={`${dayName} ${t('shop.hours.from')}`}
                  value={r.open}
                  onChange={(v) =>
                    setDay(
                      day,
                      ranges.map((x, j) => (j === i ? { ...x, open: v } : x)),
                    )
                  }
                />
                <Text color="inkMuted">–</Text>
                <TimeInput
                  label={`${dayName} ${t('shop.hours.to')}`}
                  value={r.close}
                  onChange={(v) =>
                    setDay(
                      day,
                      ranges.map((x, j) => (j === i ? { ...x, close: v } : x)),
                    )
                  }
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('shop.hours.remove')} ${r.open}–${r.close}`}
                  onPress={() =>
                    setDay(
                      day,
                      ranges.filter((_, j) => j !== i),
                    )
                  }
                  style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={20} strokeWidth={1.75} color={theme.colors.inkMuted} />
                </Pressable>
              </View>
            ))}
            {open && ranges.length < 3 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setDay(day, [...ranges, { open: '16:00', close: '20:00' }])}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.space[1],
                  minHeight: 48,
                }}
              >
                <Plus size={18} strokeWidth={1.75} color={theme.colors.brand} />
                <Text variant="label" color="brand">
                  {t('shop.hours.addRange')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {!parsed.success ? (
        <Text variant="label" color="critical" accessibilityLiveRegion="polite">
          {t('shop.hours.invalid')}
        </Text>
      ) : null}
      {update.isError ? (
        <Text variant="label" color="critical">
          {errorMessage(update.error, t)}
        </Text>
      ) : null}
      <Button
        label={t('shop.save')}
        disabled={!parsed.success}
        loading={update.isPending}
        onPress={() => parsed.success && save({ openingHours: parsed.data as OpeningHours })}
      />
    </View>
  );
}

function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={(v) => onChange(formatTime(v))}
      keyboardType="number-pad"
      maxLength={5}
      placeholder="09:00"
      placeholderTextColor={theme.colors.inkMuted}
      style={{
        minWidth: 92,
        minHeight: 48,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.line,
        color: theme.colors.ink,
        fontFamily: 'HindMadurai_500Medium',
        fontSize: 17,
        textAlign: 'center',
      }}
    />
  );
}
