import React, { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { colors, typography } from '../src/theme';
import { supabase } from '../src/utils/supabase';
import * as Linking from 'expo-linking';
import { openAuthSessionAsync, maybeCompleteAuthSession } from 'expo-web-browser';

// Required: completes auth session on redirect back
maybeCompleteAuthSession();

// Always use the native app scheme — never localhost
const GOOGLE_REDIRECT = 'hacktrackr://auth/callback';

export default function AuthScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signInWithEmail() {
    if (!email || !password) {
      alert('Please enter both email and password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) alert(error.message);
    setLoading(false);
  }

  async function signUpWithEmail() {
    if (!email || !password || !name) {
      alert('Please enter your name, email and password to sign up.');
      return;
    }
    setLoading(true);
    const {
      data: { session },
      error,
    } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { full_name: name },
        emailRedirectTo: Linking.createURL('/'),
      },
    });

    if (error) alert(error.message);
    else if (!session) alert('Please check your inbox for email verification!');
    setLoading(false);
  }

  async function signInWithGoogle() {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: GOOGLE_REDIRECT,
          skipBrowserRedirect: true,
        },
      });

      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL returned');

      const result = await openAuthSessionAsync(data.url, GOOGLE_REDIRECT);

      if (result.type === 'success') {
        // Supabase returns tokens in the URL hash fragment
        const hashPart = result.url.split('#')[1] ?? result.url.split('?')[1] ?? '';
        const params = new URLSearchParams(hashPart);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          alert('Sign-in incomplete. Please try again.');
        }
      }
      // if result.type === 'cancel', user dismissed browser — do nothing
    } catch (err: any) {
      alert(err.message || 'Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>{isSignUp ? 'Create an account.' : 'Welcome back.'}</Text>
        <Text style={styles.subtitle}>
          {isSignUp ? 'Join to start planning hackathons' : 'Sign in to save your hackathons'}
        </Text>

        {/* ── Google Button ── */}
        <TouchableOpacity
          style={[styles.button, styles.googleButton]}
          onPress={signInWithGoogle}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <View style={styles.googleButtonInner}>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Divider ── */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* ── Email / Password Form ── */}
        {isSignUp && (
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              onChangeText={(text) => setName(text)}
              value={name}
              placeholder="Full Name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />
          </View>
        )}

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            onChangeText={(text) => setEmail(text)}
            value={email}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            onChangeText={(text) => setPassword(text)}
            value={password}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => (isSignUp ? signUpWithEmail() : signInWithEmail())}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggleContainer}
          onPress={() => setIsSignUp(!isSignUp)}
          disabled={loading}
        >
          <Text style={styles.toggleText}>
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: 32,
  },
  // Google button
  googleButton: {
    backgroundColor: colors.accentWhite,
  },
  googleButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'transparent',
  },
  googleIcon: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 18,
    color: '#EA4335',
    lineHeight: 22,
  },
  googleButtonText: {
    fontFamily: 'Inter-Medium',
    fontSize: 17,
    color: '#000',
  },
  // Divider
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
    backgroundColor: 'transparent',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
  },
  // Form
  inputContainer: {
    marginBottom: 16,
    backgroundColor: 'transparent',
  },
  textInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    color: colors.text,
    ...typography.body,
  },
  button: {
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  buttonPrimary: {
    backgroundColor: colors.accentYellow,
    marginTop: 8,
  },
  buttonText: {
    ...typography.h3,
    fontSize: 18,
    color: '#000',
    fontWeight: '500',
  },
  toggleContainer: {
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  toggleText: {
    ...typography.body,
    color: colors.textMuted,
  },
});