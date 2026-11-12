/**
 * Sign-in and Face ID lock (docs/fachkonzept/01, 05).
 * - First sign-in needs network (e-mail + password); afterwards the app works offline with the stored session.
 * - Face ID only locks the app on this device (biometrics never leave the phone); fallback is the device code.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lockEnabled, login, type Session } from './session';
import { C, T, TINT } from './theme';
import { Row, Section } from './ui';

// Development only: one-tap test users (seeded with a development password, see packages/db/src/seed-ids.ts).
const TEST_USERS = [
  ['polier@example.test', 'Paul Polier', 'Polier'],
  ['bauleitung@example.test', 'Bea Bauleitung', 'Bauleitung'],
  ['elektro@example.test', 'Erik Elektro', 'NU Elektro Blitz'],
  ['projektleitung@example.test', 'Petra Projektleitung', 'Projektleitung'],
] as const;
const DEV_PASSWORD = 'Baustelle-Test-2026';

function Logo() {
  return (
    <View style={{ width: 72, height: 72, borderRadius: 16, backgroundColor: TINT.blue, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 26 }}>BA</Text>
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16, minHeight: 48 }}>
      <Text style={[T.body, { width: 92 }]}>{label}</Text>
      {children}
    </View>
  );
}

const inputStyle = { ...T.body, flex: 1, paddingVertical: 12, paddingRight: 16 } as const;

export function LoginScreen({ onLogin, email: presetEmail, notice }: { onLogin: (s: Session) => void; email?: string; notice?: string }) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState(presetEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<{ focus: () => void } | null>(null);
  const submit = (e = email, p = password) => {
    if (!e || !p || busy) return;
    setBusy(true);
    setError(null);
    login(e, p).then(onLogin, (err: Error) => {
      setError(err.message);
      setBusy(false);
    });
  };
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 20, paddingBottom: 40, maxWidth: 520, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Logo />
        <Text style={[T.largeTitle, { textAlign: 'center', marginTop: 18 }]}>Bau Akte Pro</Text>
        <Text style={[T.subhead, { textAlign: 'center', marginTop: 6, marginBottom: 28 }]}>{notice ?? 'Anmelden'}</Text>
        <Section footer="Zugangsdaten bekommen Sie per Einladung von der Bauleitung. Passwort vergessen? Im Browser unter „Passwort vergessen“ zurücksetzen.">
          <Field label="E-Mail">
            <TextInput style={inputStyle} value={email} onChangeText={setEmail} placeholder="name@firma.de" placeholderTextColor={C.label3 as unknown as string}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" autoComplete="email" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} />
          </Field>
          <Field label="Passwort">
            <TextInput ref={pwRef as never} style={inputStyle} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoComplete="current-password" returnKeyType="go" onSubmitEditing={() => submit()} />
          </Field>
        </Section>
        <Pressable onPress={() => submit()} disabled={busy || !email || !password}
          style={({ pressed }) => ({ backgroundColor: TINT.blue, borderRadius: 12, paddingVertical: 15, alignItems: 'center', opacity: busy || !email || !password ? 0.45 : pressed ? 0.8 : 1 })}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={[T.headline, { color: '#fff' }]}>Anmelden</Text>}
        </Pressable>
        {error && <Text style={[T.footnote, { color: C.red, textAlign: 'center', marginTop: 14 }]}>{error}</Text>}
        {__DEV__ && !!presetEmail && presetEmail.endsWith('@example.test') && (
          <Pressable onPress={() => submit(presetEmail, DEV_PASSWORD)} style={{ marginTop: 18, alignSelf: 'center' }}>
            <Text style={[T.body, { color: C.accent }]}>Mit Test-Passwort anmelden (nur Entwicklung)</Text>
          </Pressable>
        )}
        {__DEV__ && !presetEmail && (
          <View style={{ marginTop: 32 }}>
            <Section title="Testbenutzer (nur Entwicklung)">
              {TEST_USERS.map(([mail, name, role]) => (
                <Row key={mail} label={name} subtitle={role} chevron onPress={() => submit(mail, DEV_PASSWORD)} />
              ))}
            </Section>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Locks the app with Face ID / Touch ID / device code on start and after 5 minutes in the background. */
export function LockGate({ children, name }: { children: ReactNode; name?: string }) {
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const [error, setError] = useState<string | null>(null);
  const background = useRef<number | null>(null);

  const unlock = async () => {
    setError(null);
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Bau Akte Pro entsperren', cancelLabel: 'Abbrechen', disableDeviceFallback: false });
    if (r.success) setState('open');
    else if (r.error !== 'user_cancel' && r.error !== 'system_cancel' && r.error !== 'app_cancel') setError('Entsperren fehlgeschlagen. Bitte erneut versuchen.');
  };

  useEffect(() => {
    void (async () => {
      const usable = (await lockEnabled()) && (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      if (!usable) return setState('open');
      setState('locked');
      void unlock();
    })();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') background.current = Date.now();
      if (s === 'active' && background.current && Date.now() - background.current > 5 * 60 * 1000) {
        background.current = null;
        void (async () => {
          if ((await lockEnabled()) && (await LocalAuthentication.isEnrolledAsync())) {
            setState('locked');
            void unlock();
          }
        })();
      }
    });
    return () => sub.remove();
  }, []);

  if (state === 'open') return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
      <Logo />
      <Text style={T.title2}>Bau Akte Pro ist gesperrt</Text>
      {name && <Text style={T.subhead}>{name}</Text>}
      {state === 'locked' && (
        <Pressable onPress={() => void unlock()} style={({ pressed }) => ({ backgroundColor: TINT.blue, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, opacity: pressed ? 0.8 : 1 })}>
          <Text style={[T.headline, { color: '#fff' }]}>Entsperren</Text>
        </Pressable>
      )}
      {error && <Text style={[T.footnote, { color: C.red }]}>{error}</Text>}
    </View>
  );
}
