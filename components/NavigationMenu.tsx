import React, { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, Dimensions, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { ArrowUpRight, X } from 'lucide-react-native';
import { colors, typography } from '../src/theme';
import { useRouter, usePathname } from 'expo-router';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';

interface NavigationMenuProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export function NavigationMenu({ isOpen, setIsOpen }: NavigationMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const menuAnimation = useSharedValue(0);

  useEffect(() => {
    menuAnimation.value = withTiming(isOpen ? 1 : 0, {
      duration: 300,
      easing: Easing.out(Easing.exp),
    });
  }, [isOpen]);

  const animatedOverlayStyle = useAnimatedStyle(() => {
    return {
      opacity: menuAnimation.value,
      transform: [{ translateY: 20 * (1 - menuAnimation.value) }],
    };
  });

  const handleNav = (path: any) => {
    if (pathname !== path) {
      router.push(path);
    }
    setTimeout(() => setIsOpen(false), 500);
  };

  return (
    <Animated.View style={[styles.fullScreenOverlay, animatedOverlayStyle]} pointerEvents={isOpen ? 'auto' : 'none'}>
      <SafeAreaView style={styles.overlaySafeArea}>
        <View style={styles.overlayHeader}>
          <TouchableOpacity onPress={() => setIsOpen(false)} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
            <X color={colors.text} size={28} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.logo}>.hack</Text>
        </View>

        <View style={styles.overlayContent}>
          <TouchableOpacity onPress={() => handleNav('/')}>
            {pathname === '/' ? (
              <View style={styles.menuItemActiveRow}>
                <Text style={styles.menuItemActive}>Dashboard</Text>
                <ArrowUpRight color={colors.text} size={32} strokeWidth={1.5} />
              </View>
            ) : (
              <Text style={styles.menuItemMuted}>Dashboard</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => handleNav('/discover')}>
            {pathname === '/discover' ? (
              <View style={styles.menuItemActiveRow}>
                <Text style={styles.menuItemActive}>Discover</Text>
                <ArrowUpRight color={colors.text} size={32} strokeWidth={1.5} />
              </View>
            ) : (
              <Text style={styles.menuItemMuted}>Discover</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => handleNav('/hackathons')}>
            {pathname === '/hackathons' ? (
              <View style={styles.menuItemActiveRow}>
                <Text style={styles.menuItemActive}>Hackathons</Text>
                <ArrowUpRight color={colors.text} size={32} strokeWidth={1.5} />
              </View>
            ) : (
              <Text style={styles.menuItemMuted}>Hackathons</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => handleNav('/academia')}>
            {pathname === '/academia' ? (
              <View style={styles.menuItemActiveRow}>
                <Text style={styles.menuItemActive}>Academia</Text>
                <ArrowUpRight color={colors.text} size={32} strokeWidth={1.5} />
              </View>
            ) : (
              <Text style={styles.menuItemMuted}>Academia</Text>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => handleNav('/two')}>
            {pathname === '/two' ? (
              <View style={styles.menuItemActiveRow}>
                <Text style={styles.menuItemActive}>+ Add Hackathon</Text>
                <ArrowUpRight color={colors.text} size={32} strokeWidth={1.5} />
              </View>
            ) : (
              <Text style={styles.menuItemMuted}>+ Add Hackathon</Text>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => handleNav('/stats')}>
            {pathname === '/stats' ? (
              <View style={styles.menuItemActiveRow}>
                <Text style={styles.menuItemActive}>Stats</Text>
                <ArrowUpRight color={colors.text} size={32} strokeWidth={1.5} />
              </View>
            ) : (
              <Text style={styles.menuItemMuted}>Stats</Text>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => handleNav('/account')}>
            {pathname === '/account' ? (
              <View style={styles.menuItemActiveRow}>
                <Text style={styles.menuItemActive}>Account</Text>
                <ArrowUpRight color={colors.text} size={32} strokeWidth={1.5} />
              </View>
            ) : (
              <Text style={styles.menuItemMuted}>Account</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

export function HamburgerHeader({ onMenuPress }: { onMenuPress: () => void }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.menuIcon} onPress={onMenuPress}>
        <View style={styles.menuLineLong} />
        <View style={styles.menuLineShort} />
      </TouchableOpacity>
      <Text style={styles.logo}>.hack</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#040404',
    zIndex: 999,
  },
  overlaySafeArea: {
    flex: 1,
    paddingTop: StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 40,
  },
  overlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 80,
    backgroundColor: 'transparent',
  },
  overlayContent: {
    paddingHorizontal: 24,
    backgroundColor: 'transparent',
    gap: 40,
  },
  menuItemMuted: {
    ...typography.h2,
    fontSize: 34,
    color: colors.textMuted,
    fontWeight: '300',
  },
  menuItemActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  menuItemActive: {
    ...typography.h2,
    fontSize: 34,
    color: colors.text,
    fontWeight: '300',
  },
  logo: {
    ...typography.body,
    fontWeight: '500',
    color: colors.text,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 40,
    backgroundColor: 'transparent',
  },
  menuIcon: {
    width: 28,
    gap: 6,
    backgroundColor: 'transparent',
    paddingVertical: 8,
  },
  menuLineLong: {
    height: 2,
    width: 28,
    backgroundColor: colors.text,
    borderRadius: 2,
  },
  menuLineShort: {
    height: 2,
    width: 20,
    backgroundColor: colors.text,
    borderRadius: 2,
  },
});
