import { lightColors, Text, useTheme } from '@xatu/ui';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Home, type LucideIcon, Package, Plus, Search, User } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  discover: Search,
  orders: Package,
  profile: User,
};

/** Home, Discover, Create (marigold hive), Orders, Profile. 64px plus the safe area. */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: c.surfaceRaised,
          borderTopColor: c.line,
          paddingBottom: insets.bottom,
          height: 64 + insets.bottom,
        },
      ]}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const onPress = () => {
          const event = emitter.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };

        if (route.name === 'create') {
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={t('a11y.create')}
              onPress={onPress}
              style={styles.item}
            >
              <View style={styles.hive}>
                <Svg width={52} height={52} viewBox="0 0 52 52" style={StyleSheet.absoluteFill}>
                  <Polygon
                    points="26,3 46,14.5 46,37.5 26,49 6,37.5 6,14.5"
                    fill={lightColors.marigold}
                    stroke={lightColors.marigold}
                    strokeWidth={4}
                    strokeLinejoin="round"
                  />
                </Svg>
                <Plus size={26} strokeWidth={2.25} color={c.onMarigold} />
              </View>
            </Pressable>
          );
        }

        const Icon = ICONS[route.name] ?? Home;
        const color = focused ? c.brand : c.inkMuted;
        const label = t(`tabs.${route.name}`);
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            style={styles.item}
          >
            <Icon size={24} strokeWidth={1.75} color={color} />
            <Text
              variant="caption"
              // Tab labels scale a little; past that the bar would truncate them (as iOS tab bars do).
              maxFontSizeMultiplier={1.3}
              style={{
                color,
                fontFamily: focused ? 'HindMadurai_600SemiBold' : 'HindMadurai_500Medium',
              }}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 56 },
  hive: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
});
