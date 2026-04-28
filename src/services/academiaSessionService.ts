import AsyncStorage from '@react-native-async-storage/async-storage';

import { ACADEMIA_EMAIL_STORAGE_KEY } from './academiaService';

export type AcademiaSessionMode = 'bound' | 'temporary';

export interface ActiveAcademiaAccount {
  email: string;
  mode: AcademiaSessionMode;
}

const BOUND_EMAIL_PREFIX = `${ACADEMIA_EMAIL_STORAGE_KEY}:bound:`;
const PROMPT_SEEN_PREFIX = `${ACADEMIA_EMAIL_STORAGE_KEY}:bind_prompt_seen:`;

let temporaryAcademiaEmail: string | null = null;
const listeners = new Set<() => void>();

function boundEmailKey(userId: string) {
  return `${BOUND_EMAIL_PREFIX}${userId}`;
}

function promptSeenKey(userId: string) {
  return `${PROMPT_SEEN_PREFIX}${userId}`;
}

function emitAcademiaSessionChange() {
  listeners.forEach((listener) => listener());
}

export function subscribeAcademiaSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function migrateLegacyAcademiaEmail(userId: string) {
  const [legacyEmail, boundEmail] = await Promise.all([
    AsyncStorage.getItem(ACADEMIA_EMAIL_STORAGE_KEY),
    AsyncStorage.getItem(boundEmailKey(userId)),
  ]);

  if (legacyEmail && !boundEmail) {
    await AsyncStorage.setItem(boundEmailKey(userId), legacyEmail);
  }

  if (legacyEmail) {
    await AsyncStorage.removeItem(ACADEMIA_EMAIL_STORAGE_KEY);
  }
}

export async function getBoundAcademiaEmail(userId: string) {
  await migrateLegacyAcademiaEmail(userId);
  return AsyncStorage.getItem(boundEmailKey(userId));
}

export async function setBoundAcademiaEmail(userId: string, email: string) {
  await AsyncStorage.setItem(boundEmailKey(userId), email);
  await AsyncStorage.setItem(promptSeenKey(userId), '1');
  emitAcademiaSessionChange();
}

export async function removeBoundAcademiaEmail(userId: string) {
  await AsyncStorage.removeItem(boundEmailKey(userId));
  emitAcademiaSessionChange();
}

export function getTemporaryAcademiaEmail() {
  return temporaryAcademiaEmail;
}

export function setTemporaryAcademiaEmail(email: string) {
  temporaryAcademiaEmail = email;
  emitAcademiaSessionChange();
}

export function clearTemporaryAcademiaEmail() {
  if (!temporaryAcademiaEmail) return;
  temporaryAcademiaEmail = null;
  emitAcademiaSessionChange();
}

export async function getActiveAcademiaAccount(userId?: string | null): Promise<ActiveAcademiaAccount | null> {
  if (temporaryAcademiaEmail) {
    return { email: temporaryAcademiaEmail, mode: 'temporary' };
  }

  if (!userId) return null;

  const boundEmail = await getBoundAcademiaEmail(userId);
  return boundEmail ? { email: boundEmail, mode: 'bound' } : null;
}

export async function shouldShowAcademiaBindPrompt(userId: string) {
  await migrateLegacyAcademiaEmail(userId);
  const [boundEmail, seen] = await Promise.all([
    AsyncStorage.getItem(boundEmailKey(userId)),
    AsyncStorage.getItem(promptSeenKey(userId)),
  ]);

  return !temporaryAcademiaEmail && !boundEmail && !seen;
}

export async function markAcademiaBindPromptSeen(userId: string) {
  await AsyncStorage.setItem(promptSeenKey(userId), '1');
}
