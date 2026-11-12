/** Sign-in pages (docs/fachkonzept/01): Anmelden, Passwort vergessen, neues Passwort, Einladung annehmen. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, setSession } from './api';
import { initials } from './ui/status';

const MIN = 10;

// Development only: one-click test users (seeded with a development password).
const TEST_USERS = [
  ['bauleitung@example.test', 'Bea Bauleitung', 'Bauleitung'],
  ['polier@example.test', 'Paul Polier', 'Polier'],
  ['elektro@example.test', 'Erik Elektro', 'NU Elektro Blitz'],
  ['fliesen@example.test', 'Fiona Fliesen', 'NU Fliesen Fuchs'],
  ['bauherr@example.test', 'Hanna Bauherr', 'Bauherr'],
  ['projektleitung@example.test', 'Petra Projektleitung', 'Projektleitung'],
  ['admin@example.test', 'Anna Admin', 'Administratorin'],
] as const;

const msg = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

function Frame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="login">
      <div className="login-box">
        <div className="app-icon">BA</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function PasswordField({ value, onChange, label = 'Passwort', autoComplete = 'current-password', autoFocus }: { value: string; onChange: (v: string) => void; label?: string; autoComplete?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="row">
      <span className="k">{label}</span>
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} required />
      <button type="button" className="btn plain small" onClick={() => setShow(!show)} aria-label={show ? 'Passwort verbergen' : 'Passwort anzeigen'}>
        {show ? 'Verbergen' : 'Zeigen'}
      </button>
    </div>
  );
}

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);

  const signIn = async (e: string, p: string) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await api<{ token: string; refresh: string }>('/auth/login', { method: 'POST', body: { email: e, password: p } }));
      onLogin();
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (forgot) {
      setBusy(true);
      void api('/auth/passwort-vergessen', { method: 'POST', body: { email } })
        .then(() => setSent(true), (err) => setError(msg(err)))
        .finally(() => setBusy(false));
    } else void signIn(email, password);
  };

  return (
    <Frame title="Bau Akte Pro" subtitle={forgot ? 'Wir schicken Ihnen einen Link zum Zurücksetzen.' : 'Anmelden'}>
      <form onSubmit={submit} style={{ display: 'contents' }}>
        <div className="group">
          <div className="row">
            <span className="k">E-Mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required placeholder="name@firma.de" />
          </div>
          {!forgot && <PasswordField value={password} onChange={setPassword} />}
        </div>
        {sent ? (
          <p className="notice">Wenn es für diese Adresse einen Zugang gibt, ist jetzt eine E-Mail mit einem Link unterwegs (gültig 1 Stunde).</p>
        ) : (
          <button className="btn filled large" disabled={busy || !email || (!forgot && !password)}>
            {busy ? 'Bitte warten …' : forgot ? 'Link senden' : 'Anmelden'}
          </button>
        )}
        <button type="button" className="btn plain" onClick={() => { setForgot(!forgot); setSent(false); setError(null); }}>
          {forgot ? 'Zurück zur Anmeldung' : 'Passwort vergessen?'}
        </button>
      </form>
      {error && <p className="toast error">{error}</p>}
      {import.meta.env.DEV && !forgot && (
        <div>
          <div className="group-title">Testbenutzer (nur lokale Entwicklung)</div>
          <div className="group">
            {TEST_USERS.map(([mail, name, role]) => (
              <button key={mail} className="row action" onClick={() => void signIn(mail, 'Baustelle-Test-2026')}>
                <span className="avatar">{initials(name)}</span>
                <span className="who">
                  {name}
                  <small>{role}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Frame>
  );
}

export function ResetPasswordPage({ token, onDone }: { token: string; onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/auth/passwort-neu', { method: 'POST', body: { token, password: pw } });
      setDone(true);
    } catch (err) {
      setError(msg(err));
    }
  };
  return (
    <Frame title="Neues Passwort" subtitle={done ? 'Das Passwort ist geändert. Alle Geräte wurden abgemeldet.' : `Mindestens ${MIN} Zeichen.`}>
      {done ? (
        <button className="btn filled large" onClick={onDone}>Zur Anmeldung</button>
      ) : (
        <form onSubmit={(e) => void submit(e)} style={{ display: 'contents' }}>
          <div className="group">
            <PasswordField label="Neues Passwort" value={pw} onChange={setPw} autoComplete="new-password" autoFocus />
            <PasswordField label="Wiederholen" value={pw2} onChange={setPw2} autoComplete="new-password" />
          </div>
          {pw2 && pw !== pw2 && <p className="hint">Die beiden Passwörter stimmen nicht überein.</p>}
          <button className="btn filled large" disabled={pw.length < MIN || pw !== pw2}>Passwort speichern</button>
        </form>
      )}
      {error && <p className="toast error">{error}</p>}
    </Frame>
  );
}

interface InviteInfo { email: string; name: string | null; roleLabel: string; project: string; company: string; invitedBy: string }

export function AcceptInvitationPage({ token, onLogin }: { token: string; onLogin: () => void }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<InviteInfo>(`/auth/einladung/${token}`).then((i) => {
      setInfo(i);
      setName(i.name ?? '');
    }, (e) => setError(msg(e)));
  }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api<{ token: string; refresh: string }>(`/auth/einladung/${token}`, { method: 'POST', body: { name, password: pw } }));
      window.history.replaceState(null, '', '/');
      onLogin();
    } catch (err) {
      setError(msg(err));
      setBusy(false);
    }
  };
  if (!info) return <Frame title="Einladung" subtitle={error ?? 'Wird geladen …'}>{error && <a className="btn plain" href="/">Zur Anmeldung</a>}</Frame>;
  return (
    <Frame title="Zugang einrichten" subtitle={<>{info.invitedBy} lädt Sie zu <strong>{info.project}</strong> ein – als {info.roleLabel} ({info.company}).</>}>
      <form onSubmit={(e) => void submit(e)} style={{ display: 'contents' }}>
        <div className="group">
          <div className="row"><span className="k">E-Mail</span><span className="v">{info.email}</span></div>
          <div className="row"><span className="k">Ihr Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus required /></div>
          <PasswordField label="Passwort wählen" value={pw} onChange={setPw} autoComplete="new-password" />
        </div>
        <p className="hint">Mindestens {MIN} Zeichen. Mit diesem Passwort melden Sie sich im Browser und in der App an.</p>
        <button className="btn filled large" disabled={busy || name.trim().length < 2 || pw.length < MIN}>{busy ? 'Bitte warten …' : 'Zugang einrichten'}</button>
      </form>
      {error && <p className="toast error">{error}</p>}
    </Frame>
  );
}
