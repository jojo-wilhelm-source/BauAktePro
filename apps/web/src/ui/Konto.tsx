/**
 * "Mein Konto" for every role (decided 13.11.2026): name, phone, password, which notifications also come by e-mail.
 * Opened from the name at the bottom of the sidebar.
 */
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { Sheet } from './layout';

interface Konto { id: string; name: string; email: string; telefon: string | null; firma: string; einstellungen: { mail_aus?: string[] }; mail_arten: Record<string, string> }

export function KontoSheet({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [k, setK] = useState<Konto | null>(null);
  const [pw, setPw] = useState({ alt: '', neu: '', neu2: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => void api<Konto>('/konto').then(setK), []);
  if (!k) return null;
  const aus = new Set(k.einstellungen.mail_aus ?? []);
  const speichern = async () => {
    try {
      await api('/konto', { method: 'PATCH', body: { name: k.name, telefon: k.telefon, einstellungen: { mail_aus: [...aus] } } });
      if (pw.neu) {
        if (pw.neu !== pw.neu2) throw new Error('Die neuen Passwörter stimmen nicht überein');
        await api('/konto/passwort', { method: 'POST', body: { alt: pw.alt, neu: pw.neu, refresh: localStorage.getItem('bap.refresh') } });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError || e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Sheet title="Mein Konto" primary="Sichern" primaryDisabled={k.name.trim().length < 2} onCancel={onClose} onPrimary={() => void speichern()}>
      <div className="group">
        <div className="row"><span className="k">Name</span><input value={k.name} onChange={(e) => setK({ ...k, name: e.target.value })} /></div>
        <div className="row"><span className="k">Telefon</span><input value={k.telefon ?? ''} onChange={(e) => setK({ ...k, telefon: e.target.value })} placeholder="für Rückfragen von der Baustelle" /></div>
        <div className="row"><span className="k">E-Mail</span><span className="v">{k.email}</span></div>
        <div className="row"><span className="k">Firma</span><span className="v">{k.firma}</span></div>
      </div>
      <div className="group-title" style={{ marginTop: 14 }}>E-Mails zusätzlich zur Mitteilung in der App</div>
      <div className="group">
        {Object.entries(k.mail_arten).map(([art, label]) => (
          <label key={art} className="row"><span className="k">{label}</span>
            <input type="checkbox" className="switch" checked={!aus.has(art)} onChange={(e) => { const n = new Set(aus); if (e.target.checked) n.delete(art); else n.add(art); setK({ ...k, einstellungen: { ...k.einstellungen, mail_aus: [...n] } }); }} />
          </label>
        ))}
      </div>
      <div className="group-title" style={{ marginTop: 14 }}>Passwort ändern</div>
      <div className="group">
        <div className="row"><span className="k">Bisheriges Passwort</span><input type="password" autoComplete="current-password" value={pw.alt} onChange={(e) => setPw({ ...pw, alt: e.target.value })} /></div>
        <div className="row"><span className="k">Neues Passwort</span><input type="password" autoComplete="new-password" value={pw.neu} onChange={(e) => setPw({ ...pw, neu: e.target.value })} placeholder="mindestens 10 Zeichen" /></div>
        <div className="row"><span className="k">Wiederholen</span><input type="password" autoComplete="new-password" value={pw.neu2} onChange={(e) => setPw({ ...pw, neu2: e.target.value })} /></div>
      </div>
      <div className="footnote">Nach einer Passwortänderung müssen sich andere Geräte neu anmelden; dieses bleibt angemeldet.</div>
      {msg && <div className={`toast ${msg.ok ? 'ok' : 'error'}`} style={{ position: 'static', marginTop: 10 }}>{msg.text}</div>}
    </Sheet>
  );
}
