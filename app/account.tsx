import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, StatusBar, Alert, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { supabase } from '../src/utils/supabase';
import { colors, typography } from '../src/theme';
import { useRouter, Stack } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Session } from '@supabase/supabase-js';

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<Session | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) alert(error.message);
    else router.replace('/');
  }

  async function requestReset() {
    if (!email) {
      Alert.alert('Error', 'No email associated with this account.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setIsResetting(true);
      Alert.alert('Success', 'A password reset code has been sent to your email.');
    }
  }

  async function updatePasswordWithCode() {
    if (!otpCode || !newPassword) {
      Alert.alert('Error', 'Please enter the 6-digit code and your new password.');
      return;
    }
    
    // Verify the OTP code
    const { error: otpError } = await supabase.auth.verifyOtp({
      email,
      token: otpCode,
      type: 'recovery',
    });
    
    if (otpError) {
      Alert.alert('Error', otpError.message);
      return;
    }

    // Update to the new password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      Alert.alert('Error', updateError.message);
    } else {
      Alert.alert('Success', 'Your password has been successfully updated. Please log in again.');
      setIsResetting(false);
      setOtpCode('');
      setNewPassword('');
      await supabase.auth.signOut();
      router.replace('/');
    }
  }

  const user = session?.user;
  const fullName = user?.user_metadata?.full_name || 'Hacker';
  const email = user?.email || '';

  return (
    <View style={[styles.safeArea, { paddingTop: Math.max(insets.top, 40) + 10 }]}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft color={colors.text} size={32} strokeWidth={1.5} />
        </TouchableOpacity>
        <Text style={styles.logo}>.hack</Text>
      </View>

      <View style={styles.container}>
        <View style={styles.profileSection}>
          <Text style={styles.name}>{fullName}</Text>
          <Text style={styles.email}>{email}</Text>
        </View>

        <View style={styles.actionList}>
          {isResetting ? (
            <View style={styles.resetForm}>
              <Text style={styles.resetInstructions}>Enter the 6-digit code sent to your email and your new password.</Text>
              
              <TextInput
                style={styles.textInput}
                placeholder="6-digit Code"
                placeholderTextColor={colors.textMuted}
                value={otpCode}
                onChangeText={setOtpCode}
                keyboardType="number-pad"
              />
              <TextInput
                style={styles.textInput}
                placeholder="New Password"
                placeholderTextColor={colors.textMuted}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
              
              <TouchableOpacity onPress={updatePasswordWithCode} style={{ marginTop: 24 }}>
                <Text style={[styles.actionText, { color: colors.text }]}>Confirm New Password</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIsResetting(false)}>
                <Text style={styles.actionText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={requestReset}>
              <Text style={styles.actionText}>Reset Password</Text>
            </TouchableOpacity>
          )}

          {!isResetting && (
            <TouchableOpacity onPress={signOut}>
              <Text style={styles.actionText}>Sign Out</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#040404',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 60,
    backgroundColor: 'transparent',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  logo: {
    ...typography.body,
    fontWeight: '500',
    color: colors.text,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    backgroundColor: 'transparent',
  },
  profileSection: {
    marginBottom: 80,
    backgroundColor: 'transparent',
  },
  name: {
    ...typography.h1,
    fontSize: 48,
    fontWeight: '300',
    color: colors.text,
    marginBottom: 12,
  },
  email: {
    ...typography.h3,
    fontSize: 20,
    fontWeight: '300',
    color: colors.textMuted,
  },
  actionList: {
    gap: 32,
    backgroundColor: 'transparent',
  },
  actionText: {
    ...typography.h2,
    fontSize: 34,
    color: colors.textMuted,
    fontWeight: '300',
  },
  resetForm: {
    gap: 16,
    backgroundColor: 'transparent',
  },
  resetInstructions: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: 8,
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
});
