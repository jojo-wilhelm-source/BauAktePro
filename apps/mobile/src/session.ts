import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

/** DURCHSTICH: dev login with a seeded test user. Token stored in the iOS Keychain. */
export interface Session { token: string; userId: string; email: string }
const KEY = 'bap.session';

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function login(email: string): Promise<Session> {
  const res = await fetch(`${API_URL}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!res.ok) throw new Error(`Anmeldung fehlgeschlagen (${res.status})`);
  const { token, userId } = (await res.json()) as { token: string; userId: string };
  const s = { token, userId, email };
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  return s;
}

export async function logout() {
  await SecureStore.deleteItemAsync(KEY);
}

/** Key for the encrypted local database (SQLCipher), generated once per device and kept in the Keychain. */
export async function dbKey(): Promise<string> {
  let k = await SecureStore.getItemAsync('bap.dbkey');
  if (!k) {
    const bytes = Crypto.getRandomBytes(32);
    k = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync('bap.dbkey', k);
  }
  return k;
}
