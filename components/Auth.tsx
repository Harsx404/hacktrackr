import React, { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { colors, typography } from '../src/theme';
import { supabase } from '../src/utils/supabase';
import * as Linking from 'expo-linking';

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
        data: {
          full_name: name,
        },
        emailRedirectTo: Linking.createURL('/'),
      }
    });

    if (error) alert(error.message);
    else if (!session) alert('Please check your inbox for email verification!');
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>{isSignUp ? 'Create an account.' : 'Welcome back.'}</Text>
        <Text style={styles.subtitle}>{isSignUp ? 'Join to start planning hackathons' : 'Sign in to save your hackathons'}</Text>

        {isSignUp && (
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              onChangeText={(text) => setName(text)}
              value={name}
              placeholder="Full Name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize={'words'}
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
            autoCapitalize={'none'}
          />
        </View>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            onChangeText={(text) => setPassword(text)}
            value={password}
            secureTextEntry={true}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            autoCapitalize={'none'}
          />
        </View>

        <TouchableOpacity 
          style={[styles.button, styles.buttonPrimary]} 
          onPress={() => isSignUp ? signUpWithEmail() : signInWithEmail()}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>}
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
    marginTop: 16,
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