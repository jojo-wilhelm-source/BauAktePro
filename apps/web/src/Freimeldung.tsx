/**
 * Public QR-Freimeldung page (docs/fachkonzept/04): opened from the QR code / link of a Mangelanzeige on a phone.
 * No account: the fitter types name and company once (kept on this device), then reports each position as
 * fixed with a photo, or raises a query. The Bauleitung checks afterwards.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate } from '@bap/domain';

interface Meldung { kind: 'behoben' | 'rueckfrage'; name: string; firma: string; kommentar: string | null; foto_id: string | null; created_at: string }
interface Position { id: string; pos: number; number: number; description: string; status: string; statusLabel: string; location: string; gewerk: string; fotos: string[]; meldungen: Meldung[] }
interface Data { anzeige: string; project: string; company: string; ownCompany: string; deadline: string; positions: Position[] }

const ME_KEY = 'bap.freimelder';
const mNo = (n: number) => `M-${String(n).padStart(3, '0')}`;
const TONE: Record<string, string> = { behoben_gemeldet: 'c-teal', abgenommen: 'c-green', strittig: 'c-purple', nicht_behoben: 'c-red' };

export function FreimeldungPage({ token }: { token: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ name: string; firma: string }>(() => {
    try {
      return JSON.parse(localStorage.getItem(ME_KEY) ?? '') as { name: string; firma: string };
    } catch {
      return { name: '', firma: '' };
    }
  });
  const load = useCallback(async () => {
    const r = await fetch(`/api/public/freimeldung/${token}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) setError(body.error ?? 'Dieser Link funktioniert nicht.');
    else setD(body as Data);
  }, [token]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (d) document.title = `Freimeldung ${d.anzeige} – ${d.project}`;
  }, [d]);

  if (error) return <div className="fm"><div className="fm-head"><div className="app-icon">BA</div><h1>Freimeldung</h1><p className="fm-error">{error}</p></div></div>;
  if (!d) return <div className="fm"><p className="loading">Wird geladen …</p></div>;
  const offen = d.positions.filter((p) => p.status !== 'abgenommen' && p.status !== 'behoben_gemeldet').length;
  return (
    <div className="fm">
      <div className="fm-head">
        <div className="app-icon">BA</div>
        <div>
          <div className="sub">{d.ownCompany} · {d.project}</div>
          <h1>Mangelanzeige {d.anzeige}</h1>
          <div className="sub">An {d.company} · Frist {formatDate(d.deadline)} · {offen ? `${offen} offen` : 'alles gemeldet'}</div>
        </div>
      </div>
      <div className="group fm-me">
        <div className="row"><span className="k">Ihr Name</span><input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} autoComplete="name" placeholder="Vor- und Nachname" /></div>
        <div className="row"><span className="k">Firma</span><input value={me.firma} onChange={(e) => setMe({ ...me, firma: e.target.value })} autoComplete="organization" placeholder={d.company} /></div>
      </div>
      <p className="footnote">Wird nur auf diesem Gerät gespeichert, damit Sie es nicht jedes Mal eintippen müssen.</p>
      {d.positions.map((p) => (
        <PositionCard key={p.id} token={token} p={p} me={me} onDone={() => { localStorage.setItem(ME_KEY, JSON.stringify(me)); void load(); }} />
      ))}
      <p className="footnote">Die Bauleitung prüft jede Meldung und nimmt den Mangel ab oder meldet sich bei Ihnen.</p>
    </div>
  );
}

function PositionCard({ token, p, me, onDone }: { token: string; p: Position; me: { name: string; firma: string }; onDone: () => void }) {
  const [mode, setMode] = useState<'behoben' | 'rueckfrage' | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [kommentar, setKommentar] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = p.status === 'abgenommen';
  const meOk = me.name.trim().length >= 2 && me.firma.trim().length >= 2;
  const preview = foto ? URL.createObjectURL(foto) : null;

  const submit = async () => {
    if (!mode) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('art', mode);
    fd.append('name', me.name.trim());
    fd.append('firma', me.firma.trim());
    if (kommentar.trim()) fd.append('kommentar', kommentar.trim());
    if (foto) fd.append('file', foto, foto.name || 'nachweis.jpg');
    const r = await fetch(`/api/public/freimeldung/${token}/positionen/${p.id}`, { method: 'POST', body: fd });
    const body = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(body.error ?? 'Senden fehlgeschlagen');
    setMode(null);
    setFoto(null);
    setKommentar('');
    onDone();
  };

  return (
    <div className="card fm-pos">
      <div className="fm-pos-head">
        <span className="num">Pos. {p.pos} · {mNo(p.number)}</span>
        <span className={`pill ${TONE[p.status] ?? 'c-orange'}`}>{p.statusLabel}</span>
      </div>
      <div className="desc">{p.description}</div>
      <div className="sub">{p.location} · {p.gewerk}</div>
      {p.fotos.length > 0 && (
        <div className="fm-fotos">
          {p.fotos.slice(0, 3).map((id) => <img key={id} src={`/api/public/freimeldung/${token}/foto/${id}`} alt="Foto des Mangels" loading="lazy" />)}
        </div>
      )}
      {p.meldungen.map((m, i) => (
        <div key={i} className="fm-meldung">
          <strong>{m.kind === 'behoben' ? 'Behoben gemeldet' : 'Widerspruch'}</strong> von {m.name} ({m.firma}) · {new Date(m.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          {m.kommentar && <div>„{m.kommentar}“</div>}
          {m.foto_id && <img src={`/api/public/freimeldung/${token}/foto/${m.foto_id}`} alt="Nachweisfoto" loading="lazy" />}
        </div>
      ))}
      {!done && !mode && (
        <div className="fm-actions">
          <button className={`btn large ${p.status === 'behoben_gemeldet' ? '' : 'filled'}`} onClick={() => setMode('behoben')}>
            {p.status === 'behoben_gemeldet' ? 'Weiteres Foto senden' : 'Behoben melden'}
          </button>
          <button className="btn large" onClick={() => setMode('rueckfrage')}>Widerspruch</button>
        </div>
      )}
      {mode && (
        <div className="fm-form">
          {mode === 'behoben' && (
            <>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
              {preview ? (
                <button className="fm-preview" onClick={() => fileRef.current?.click()} title="Neu aufnehmen"><img src={preview} alt="Nachweisfoto" /></button>
              ) : (
                <button className="btn large" onClick={() => fileRef.current?.click()}>📷 Foto aufnehmen (Pflicht)</button>
              )}
            </>
          )}
          <textarea rows={3} placeholder={mode === 'behoben' ? 'Kommentar (optional), z. B. „Fuge neu verfugt“' : 'Begründung des Widerspruchs (Pflicht)'} value={kommentar} onChange={(e) => setKommentar(e.target.value)} />
          {!meOk && <p className="fm-error">Bitte oben Ihren Namen und die Firma eintragen.</p>}
          {error && <p className="fm-error">{error}</p>}
          <div className="fm-actions">
            <button className="btn filled large" disabled={busy || !meOk || (mode === 'behoben' ? !foto : !kommentar.trim())} onClick={() => void submit()}>
              {busy ? 'Wird gesendet …' : mode === 'behoben' ? 'Freimeldung senden' : 'Widerspruch senden'}
            </button>
            <button className="btn plain" onClick={() => { setMode(null); setFoto(null); setError(null); }}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}
