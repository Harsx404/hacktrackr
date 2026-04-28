import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import {
  Inter_200ExtraLight,
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '../src/utils/supabase';
import Auth from '@/components/Auth';
import { AcademiaBindPrompt } from '@/components/AcademiaBindPrompt';
import { Session } from '@supabase/supabase-js';
import { registerForNotifications, syncAllReminders } from '../src/services/notificationService';
import {
  clearTemporaryAcademiaEmail,
  migrateLegacyAcademiaEmail,
  shouldShowAcademiaBindPrompt,
} from '../src/services/academiaSessionService';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    'Inter-ExtraLight': Inter_200ExtraLight,
    'Inter-Light':      Inter_300Light,
    'Inter-Regular':    Inter_400Regular,
    'Inter-Medium':     Inter_500Medium,
    'Inter-SemiBold':   Inter_600SemiBold,
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const [session, setSession] = useState<Session | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [academiaPromptVisible, setAcademiaPromptVisible] = useState(false);
  const [academiaPromptUserId, setAcademiaPromptUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function syncAcademiaPrompt(nextSession: Session | null) {
      try {
        const userId = nextSession?.user?.id;
        if (!userId) {
          clearTemporaryAcademiaEmail();
          if (mounted) {
            setAcademiaPromptVisible(false);
            setAcademiaPromptUserId(null);
          }
          return;
        }

        await migrateLegacyAcademiaEmail(userId);
        const shouldShow = await shouldShowAcademiaBindPrompt(userId);
        if (!mounted) return;

        setAcademiaPromptUserId(userId);
        setAcademiaPromptVisible(shouldShow);
      } catch {
        if (mounted) {
          setAcademiaPromptVisible(false);
        }
      }
    }

    function syncNotifications(nextSession: Session | null) {
      if (!nextSession?.user) return;

      registerForNotifications().then((granted) => {
        if (granted) {
          supabase
            .from('hackathons')
            .select('id, name, deadline')
            .then(({ data }) => {
              if (data) syncAllReminders(data);
            });
        }
      });
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setIsInitializing(false);
      syncAcademiaPrompt(session);
      syncNotifications(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      setTimeout(() => {
        syncAcademiaPrompt(nextSession);
        syncNotifications(nextSession);
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (isInitializing) {
    return null; // Or a themed splash screenView here.
  }

  const CustomDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: '#040404',
      card: '#111111',
    },
  };

  return (
    <ThemeProvider value={CustomDarkTheme}>
      <View style={{ flex: 1, backgroundColor: '#040404' }}>
        <Stack screenOptions={{ 
          contentStyle: { backgroundColor: '#040404' },
          animation: 'fade',
        }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="account" options={{ headerShown: false }} />
          <Stack.Screen name="hackathon/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
        
        {(!session || !session.user) && (
          <View style={StyleSheet.absoluteFill}>
            <Auth />
          </View>
        )}

        <AcademiaBindPrompt
          visible={!!session?.user && academiaPromptVisible}
          userId={academiaPromptUserId}
          onClose={() => setAcademiaPromptVisible(false)}
        />
      </View>
    </ThemeProvider>
  );
}
