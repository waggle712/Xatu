import type { Language } from '@xatu/shared';
import { APP_NAME, PILOT_CITY } from '@xatu/config/brand';
import { Button, ProtectedPayIcon, Text, useTheme, VerifiedIcon, XatuMark } from '@xatu/ui';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, Smartphone, Star } from 'lucide-react-native';
import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Honeycomb } from '../../src/components/Honeycomb';
import { useSession } from '../../src/store/session';

export default function Welcome() {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const language = useSession((s) => s.language);
  const chooseLanguage = useSession((s) => s.chooseLanguage);
  const c = theme.colors;
  // Only while this screen is in front, so the next screens get dark status bar text again.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  return (
    <ScrollView
      style={{ backgroundColor: c.surface }}
      contentContainerStyle={{ flexGrow: 1 }}
      bounces={false}
    >
      {/* Light status bar text on the plum hero. */}
      {focused ? <StatusBar style="light" /> : null}
      <View style={[styles.hero, { backgroundColor: c.plum, paddingTop: insets.top + 24 }]}>
        <View style={[styles.honeycomb, { top: insets.top + 8 }]}>
          <Honeycomb width={160} />
        </View>
        <View
          style={styles.logoRow}
          accessible
          accessibilityRole="header"
          accessibilityLabel={APP_NAME}
        >
          <XatuMark size={34} />
          <Text variant="display" color="onPlum" style={styles.wordmark}>
            {APP_NAME.toLowerCase()}
          </Text>
        </View>
        <View style={{ gap: 10, marginTop: 'auto' }}>
          <Text
            variant="display"
            color="onPlum"
            // Tamil runs about 30% longer, so its headline is set smaller.
            style={
              language === 'ta'
                ? { fontSize: 26, lineHeight: 36 }
                : { fontSize: 32, lineHeight: 38 }
            }
          >
            {t('welcome.headline')}
          </Text>
          <Text color="onPlum" style={{ opacity: 0.88 }}>
            {t('welcome.subtitle', { city: PILOT_CITY })}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: c.surface,
            borderTopLeftRadius: theme.radius.lg,
            borderTopRightRadius: theme.radius.lg,
            paddingBottom: insets.bottom + 20,
          },
        ]}
      >
        <View style={{ gap: 10 }}>
          <Text variant="heading" accessibilityRole="header">
            {t('welcome.chooseLanguage')}
          </Text>
          <View style={styles.langRow} accessibilityRole="radiogroup">
            {(['ta', 'en'] as Language[]).map((lang) => (
              <LanguageCard
                key={lang}
                selected={language === lang}
                title={t(`language.${lang}`)}
                subtitle={lang === 'ta' ? 'Tamil' : 'English'}
                onPress={() => void chooseLanguage(lang)}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: 12 }}>
          <TrustRow
            icon={<VerifiedIcon size={20} color={c.sage} />}
            label={t('welcome.trustChecked')}
          />
          <TrustRow
            icon={<ProtectedPayIcon size={20} color={c.sage} />}
            label={t('welcome.trustPay')}
          />
          <TrustRow
            icon={<Star size={20} strokeWidth={1.75} color={c.sage} />}
            label={t('welcome.trustReviews')}
          />
        </View>

        <View style={{ gap: 10, marginTop: 'auto' }}>
          <Button
            label={t('welcome.continuePhone')}
            icon={<Smartphone size={20} strokeWidth={1.75} color={c.onMarigold} />}
            onPress={() => {
              void chooseLanguage(language);
              router.push('/phone');
            }}
          />
          <Text variant="caption" color="inkMuted" style={{ textAlign: 'center' }}>
            {t('welcome.otpNote')}
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/phone')}
            style={{
              alignSelf: 'center',
              minHeight: 48,
              justifyContent: 'center',
              paddingHorizontal: 12,
            }}
          >
            <Text variant="label" style={{ textDecorationLine: 'underline', textAlign: 'center' }}>
              {t('welcome.maker')}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function LanguageCard(props: {
  selected: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={`${props.title}, ${props.subtitle}`}
      onPress={props.onPress}
      style={[
        styles.langCard,
        {
          borderRadius: theme.radius.md,
          backgroundColor: props.selected ? c.blush : c.surfaceRaised,
          borderColor: props.selected ? c.brandFill : c.line,
          borderWidth: props.selected ? 2 : 1,
        },
      ]}
    >
      <View style={styles.langTop}>
        <Text variant="title" style={{ lineHeight: 32 }}>
          {props.title}
        </Text>
        {props.selected ? (
          <View style={[styles.radioOn, { backgroundColor: c.ink }]}>
            <Check size={14} strokeWidth={2.5} color={c.surface} />
          </View>
        ) : (
          <View style={[styles.radioOff, { borderColor: c.inkMuted }]} />
        )}
      </View>
      <Text variant="label" color="inkMuted" style={{ fontFamily: 'HindMadurai_400Regular' }}>
        {props.subtitle}
      </Text>
    </Pressable>
  );
}

function TrustRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <View style={styles.trustRow}>
      {icon}
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { minHeight: 400, paddingHorizontal: 24, paddingBottom: 56, overflow: 'hidden' },
  honeycomb: { position: 'absolute', right: -10 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: { fontSize: 30, lineHeight: 36, letterSpacing: -0.3 },
  sheet: { marginTop: -28, paddingHorizontal: 20, paddingTop: 24, gap: 20, flexGrow: 1 },
  langRow: { flexDirection: 'row', gap: 12 },
  langCard: { flex: 1, paddingVertical: 14, paddingHorizontal: 16, minHeight: 72 },
  langTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  radioOn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOff: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
