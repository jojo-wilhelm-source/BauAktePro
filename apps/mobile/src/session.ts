import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

/**
 * Session on the device (docs/fachkonzept/01, 05): access token (12 h) + refresh token (30 days), kept in the
 * iOS Keychain. Offline the session simply stays as it is; renewing happens when the network is back.
 */
export interface Session { token: string; refresh?: string; userId: string; email: string; name?: string }
const KEY = 'bap.session';

export class SignInError extends Error {}

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

async function store(s: Session) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  return s;
}

async function withName(token: string, refresh: string | undefined, userId: string, email: string): Promise<Session> {
  const me = await fetch(`${API_URL}/me`, { headers: { authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null), () => null);
  return store({ token, refresh, userId, email, name: (me as { user?: { name?: string } } | null)?.user?.name });
}

/** E-mail + password. Errors carry the server's German message. */
export async function login(email: string, password: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  } catch {
    throw new SignInError('Keine Verbindung zum Server. Die erste Anmeldung braucht Netz.');
  }
  const body = (await res.json().catch(() => ({}))) as { token?: string; refresh?: string; userId?: string; error?: string };
  if (!res.ok || !body.token) throw new SignInError(body.error ?? `Anmeldung fehlgeschlagen (${res.status})`);
  return withName(body.token, body.refresh, body.userId!, email.trim().toLowerCase());
}

/** Listeners for "the server says this session is over" (password changed, access removed, 30 days unused). */
const expiredListeners = new Set<() => void>();
export const onSessionExpired = (fn: () => void) => {
  expiredListeners.add(fn);
  return () => {
    expiredListeners.delete(fn);
  };
};

/** Seconds until the JWT expires (negative if expired). */
function secondsLeft(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return (payload.exp ?? 0) - Date.now() / 1000;
  } catch {
    return -1;
  }
}

/** Renews the access token shortly before it expires. Offline (or server down) the old session is kept. */
export async function freshSession(s: Session): Promise<Session> {
  if (secondsLeft(s.token) > 300) return s;
  if (!s.refresh) {
    // Old session without refresh token (e.g. from the test login): ask to sign in again once it has expired.
    if (secondsLeft(s.token) <= 0) expiredListeners.forEach((l) => l());
    return s;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh: s.refresh }) });
  } catch {
    return s;
  }
  if (res.status === 401 || res.status === 403) {
    expiredListeners.forEach((l) => l());
    return s;
  }
  if (!res.ok) return s;
  const { token } = (await res.json()) as { token: string };
  return store({ ...s, token });
}

export async function logout(s?: Session | null) {
  if (s?.refresh) await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh: s.refresh }) }).catch(() => {});
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
