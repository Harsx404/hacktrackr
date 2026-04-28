import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { AlertCircle, GraduationCap, Lock, Timer, User } from 'lucide-react-native';

import { Text, View } from '@/components/Themed';
import { academiaApi } from '@/src/services/academiaService';
import {
  markAcademiaBindPromptSeen,
  setBoundAcademiaEmail,
  setTemporaryAcademiaEmail,
  type AcademiaSessionMode,
} from '@/src/services/academiaSessionService';
import { colors, typography } from '@/src/theme';

interface AcademiaBindPromptProps {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}

export function AcademiaBindPrompt({ visible, userId, onClose }: AcademiaBindPromptProps) {
  const [mode, setMode] = useState<AcademiaSessionMode | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode(null);
    setPassword('');
    setError(null);
    setLoading(false);
  };

  const handleMaybeLater = async () => {
    if (userId) {
      await markAcademiaBindPromptSeen(userId);
    }
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!mode || !trimmedEmail || !password.trim()) return;
    if (mode === 'bound' && !userId) {
      setError('Sign in to HackTrackr before binding Academia.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await academiaApi.login(trimmedEmail, password);
      if (!res.success) throw new Error(res.error || 'Academia login failed.');

      if (mode === 'bound' && userId) {
        await setBoundAcademiaEmail(userId, trimmedEmail);
      } else {
        setTemporaryAcademiaEmail(trimmedEmail);
      }

      setEmail(trimmedEmail);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to Academia.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleMaybeLater}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          {!mode ? (
            <>
              <View style={styles.iconWrap}>
                <GraduationCap color="#000" size={26} strokeWidth={1.6} />
              </View>
              <Text style={styles.title}>Bind Academia</Text>
              <Text style={styles.body}>
                Link your main Academia ID to this HackTrackr account, or use another Academia login only for this app session.
              </Text>

              <View style={styles.choiceStack}>
                <TouchableOpacity style={styles.choiceButton} onPress={() => setMode('bound')} activeOpacity={0.85}>
                  <User color={colors.accentYellow} size={20} strokeWidth={1.5} />
                  <View style={styles.choiceTextWrap}>
                    <Text style={styles.choiceTitle}>Bind main ID</Text>
                    <Text style={styles.choiceBody}>Saved for this HackTrackr account.</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={styles.choiceButton} onPress={() => setMode('temporary')} activeOpacity={0.85}>
                  <Timer color={colors.accentBlue} size={20} strokeWidth={1.5} />
                  <View style={styles.choiceTextWrap}>
                    <Text style={styles.choiceTitle}>Temporary ID</Text>
                    <Text style={styles.choiceBody}>Clears when the app restarts.</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.secondaryButton} onPress={handleMaybeLater} activeOpacity={0.8}>
                <Text style={styles.secondaryText}>Maybe later</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>{mode === 'bound' ? 'Bind main ID' : 'Temporary ID'}</Text>
              <Text style={styles.body}>
                {mode === 'bound'
                  ? 'This Academia email will be remembered for your HackTrackr account.'
                  : 'This login is kept only in memory for the current app run.'}
              </Text>

              {error ? (
                <View style={styles.errorBox}>
                  <AlertCircle color="#F87171" size={18} strokeWidth={1.5} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <View style={styles.inputShell}>
                <User color={colors.textMuted} size={18} strokeWidth={1.5} />
                <TextInput
                  style={styles.textInput}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Academia email"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              <View style={styles.inputShell}>
                <Lock color={colors.textMuted} size={18} strokeWidth={1.5} />
                <TextInput
                  style={styles.textInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Academia password"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  secureTextEntry
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>Continue</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryButton} onPress={reset} disabled={loading} activeOpacity={0.8}>
                <Text style={styles.secondaryText}>Back</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  card: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 24,
    gap: 16,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentYellow,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    fontSize: 34,
    lineHeight: 38,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
  },
  choiceStack: {
    gap: 12,
    backgroundColor: 'transparent',
  },
  choiceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  choiceTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  choiceTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
  },
  choiceBody: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 16,
    backgroundColor: colors.background,
  },
  textInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: 16,
  },
  primaryButton: {
    borderRadius: 100,
    backgroundColor: colors.accentYellow,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 17,
  },
  primaryText: {
    ...typography.h3,
    color: '#000',
    fontSize: 17,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  secondaryText: {
    ...typography.body,
    color: colors.textMuted,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.3)',
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    padding: 12,
  },
  errorText: {
    ...typography.body,
    flex: 1,
    color: '#F87171',
    fontSize: 13,
    lineHeight: 18,
  },
});
