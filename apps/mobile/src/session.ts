import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

/** DURCHSTICH: dev login with a seeded test user. Token stored in the iOS Keychain. */
export interface Session { token: string; userId: string; email: string; name?: string }
const KEY = 'bap.session';

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export async function login(email: string): Promise<Session> {
  const res = await fetch(`${API_URL}/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!res.ok) throw new Error(`Anmeldung fehlgeschlagen (${res.status})`);
  const { token, userId } = (await res.json()) as { token: string; userId: string };
  const me = await fetch(`${API_URL}/me`, { headers: { authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null), () => null);
  const s: Session = { token, userId, email, name: (me as { user?: { name?: string } } | null)?.user?.name };
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  return s;
}

/** Seconds until the JWT expires (negative if expired). */
function secondsLeft(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return (payload.exp ?? 0) - Date.now() / 1000;
  } catch {
    return -1;
  }
}

/**
 * DEV ONLY: renews the test-login token shortly before it expires (tokens live 12 h).
 * Replaced by real refresh tokens with Better Auth. Offline the old session is kept.
 */
export async function freshSession(s: Session): Promise<Session> {
  if (secondsLeft(s.token) > 300) return s;
  try {
    return await login(s.email);
  } catch {
    return s;
  }
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
