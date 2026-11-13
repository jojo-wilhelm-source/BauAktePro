/**
 * Own layout for the IT administrator (decided 13.11.2026: every role gets a layout tailored to its work).
 * System overview, users & projects, company settings (values that used to be fixed in code), audit log.
 * "Zu den Projekten" switches to the normal project view (the administrator has Bauleitung rights everywhere).
 */
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { EINSTELLUNGEN_STANDARD, FOTODOKU_KATEGORIEN, type Einstellungen } from '@bap/domain';
import { ApiError, api, type Me } from './api';
import { AdminPage } from './Admin';
import { Kachel, Abschnitt } from './Cockpit';
import { Icon, type IconName } from './ui/Icon';
import { PageHeader, type Run } from './ui/layout';
import { initials } from './ui/status';
import { KontoSheet } from './ui/Konto';

type View = 'system' | 'benutzer' | 'einstellungen' | 'protokoll';
type Toast = { kind: 'ok' | 'error'; text: string } | null;

const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB` : `${(b / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`);
const zeit = (t: string) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

export function AdminShell({ me, onLogout, onProjekte }: { me: Me; onLogout: () => void; onProjekte: (projectId?: string) => void }) {
  const [view, setView] = useState<View>('system');
  const [toast, setToast] = useState<Toast>(null);
  const [kontoOffen, setKontoOffen] = useState(false);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);
  const run: Run = async (fn, ok) => {
    try { await fn(); setToast({ kind: 'ok', text: ok }); } catch (e) { setToast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) }); }
  };
  const item = (v: View, icon: IconName, label: string) => (
    <button className={`side-item ${view === v ? 'active' : ''}`} onClick={() => setView(v)}><Icon name={icon} />{label}</button>
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="app-icon">BA</div><div><strong>Bau Akte Pro</strong><small>Administration</small></div></div>
        {item('system', 'portal', 'Systemübersicht')}
        {item('benutzer', 'zugang', 'Benutzer & Projekte')}
        {item('einstellungen', 'stift', 'Einstellungen')}
        {item('protokoll', 'anzeige', 'Protokoll')}
        <div className="side-section">Arbeiten</div>
        <button className="side-item" onClick={() => onProjekte()}><Icon name="firmen" />Zu den Projekten</button>
        <div className="sidebar-footer">
          <span className="avatar">{initials(me.user.name)}</span>
          <button className="who konto-btn" onClick={() => setKontoOffen(true)} title="Mein Konto"><div>{me.user.name}</div><small>{me.user.company}</small></button>
          <button className="btn plain" onClick={onLogout} title="Abmelden" aria-label="Abmelden"><Icon name="abmelden" /></button>
        </div>
      </aside>
      {kontoOffen && <KontoSheet onClose={() => setKontoOffen(false)} />}
      <div className="content">
        {view === 'system' && <SystemPage onOpen={setView} />}
        {view === 'benutzer' && <AdminPage meId={me.user.id} run={run} onOpenProject={(id) => onProjekte(id)} />}
        {view === 'einstellungen' && <EinstellungenPage run={run} />}
        {view === 'protokoll' && <ProtokollPage />}
      </div>
      {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.kind === 'ok' && <Icon name="haken" size={18} />}{toast.text}</div>}
    </div>
  );
}

interface System {
  zahlen: Record<string, number>;
  anmeldungen: { id: string; name: string; firma: string; zuletzt: string }[];
  rechte: { id: string; entity: string; action: string; recorded_at: string; von: string; projekt: string | null; data: Record<string, unknown> }[];
  speicher: { bereich: string; label: string; bytes: number; dateien: number }[];
  datenbank_bytes: number | null;
}

function SystemPage({ onOpen }: { onOpen: (v: View) => void }) {
  const [d, setD] = useState<System | null>(null);
  useEffect(() => void api<System>('/admin/system').then(setD), []);
  if (!d) return <p className="loading">Wird geladen …</p>;
  const z = d.zahlen;
  const gesamt = d.speicher.reduce((s, x) => s + x.bytes, 0);
  return (
    <>
      <PageHeader eyebrow="Administration" title="Systemübersicht" />
      <div className="list-pad cockpit">
        <div className="kpi-row">
          <Kachel n={z.benutzer_aktiv ?? 0} label={`aktive Benutzer (${z.aktiv_7_tage ?? 0} in den letzten 7 Tagen)`} tone="var(--accent)" onClick={() => onOpen('benutzer')} />
          <Kachel n={z.benutzer_gesperrt ?? 0} label="gesperrte Zugänge" tone="var(--orange)" onClick={() => onOpen('benutzer')} />
          <Kachel n={z.einladungen_offen ?? 0} label="offene Einladungen" tone="var(--orange)" onClick={() => onOpen('benutzer')} />
          <Kachel n={z.projekte ?? 0} label={`Projekte · ${z.nachunternehmer ?? 0} Nachunternehmer`} onClick={() => onOpen('benutzer')} />
          <Kachel n={z.konflikte ?? 0} label="offene Abgleich-Konflikte" tone="var(--red)" />
          <Kachel n={z.ereignisse_24h ?? 0} label="Protokoll-Einträge (24 h)" onClick={() => onOpen('protokoll')} />
        </div>
        <div className="cockpit-grid">
          <Abschnitt titel={`Speicher · ${mb(gesamt)} Dateien${d.datenbank_bytes ? ` · ${mb(d.datenbank_bytes)} Datenbank` : ''}`}>
            {d.speicher.map((s) => (
              <div key={s.bereich} className="row">
                <span className="k">{s.label}<div className="speicher-balken"><span style={{ width: `${gesamt ? Math.max(1, (s.bytes / gesamt) * 100) : 0}%` }} /></div></span>
                <span className="v">{mb(s.bytes)} · {s.dateien.toLocaleString('de-DE')} Dateien</span>
              </div>
            ))}
          </Abschnitt>
          <Abschnitt titel="Zuletzt aktiv" mehr="Benutzer" onMehr={() => onOpen('benutzer')}>
            {d.anmeldungen.map((a) => <div key={a.id} className="row"><span className="k">{a.name}<div className="sub">{a.firma}</div></span><span className="v">{zeit(a.zuletzt)}</span></div>)}
            {!d.anmeldungen.length && <div className="empty">Noch keine Anmeldungen.</div>}
          </Abschnitt>
          <Abschnitt titel="Letzte Rechte- und Einstellungsänderungen" mehr="Protokoll" onMehr={() => onOpen('protokoll')}>
            {d.rechte.map((r) => <div key={r.id} className="row"><span className="k">{r.entity} · {r.action}<div className="sub">{r.von}{r.projekt ? ` · ${r.projekt}` : ''}</div></span><span className="v">{zeit(r.recorded_at)}</span></div>)}
            {!d.rechte.length && <div className="empty">Keine Änderungen.</div>}
          </Abschnitt>
          <Abschnitt titel="Papierkorb">
            <div className="row"><span className="k">Gelöschte Mängel</span><span className="v">{z.papierkorb ?? 0}</span></div>
            <div className="footnote" style={{ padding: '0 16px 12px' }}>Gelöschtes wird nie endgültig entfernt; die Bauleitung kann es im Projekt wiederherstellen.</div>
          </Abschnitt>
        </div>
      </div>
    </>
  );
}

/** Company settings with defaults; saving writes one audit entry with the changed areas. */
function EinstellungenPage({ run }: { run: Run }) {
  const [e, setE] = useState<Einstellungen | null>(null);
  const [dirty, setDirty] = useState(false);
  const load = useCallback(async () => { setE(await api<Einstellungen>('/einstellungen')); setDirty(false); }, []);
  useEffect(() => void load(), [load]);
  if (!e) return <p className="loading">Wird geladen …</p>;
  const set = (fn: (x: Einstellungen) => void) => { const n = structuredClone(e); fn(n); setE(n); setDirty(true); };
  const zahl = (v: number, onChange: (n: number) => void, suffix = 'Tage', step = 1) => (
    <span className="einst-zahl"><input type="number" min={0} step={step} value={v} onChange={(ev) => onChange(Number(ev.target.value))} />{suffix}</span>
  );
  const prio = (k: 'frist_tage' | 'nachfrist_tage', label: string) => (
    <div className="row"><span className="k">{label}</span><span className="einst-prio">
      {(['kritisch', 'normal', 'gering'] as const).map((p) => <label key={p}><small>{p}</small>{zahl(e.maengel[k][p], (n) => set((x) => { x.maengel[k][p] = n; }))}</label>)}
    </span></div>
  );
  const schalter = (k: keyof Einstellungen['benachrichtigung'], label: string, sub: string) => (
    <label className="row"><span className="k">{label}<div className="sub">{sub}</div></span>
      <input type="checkbox" className="switch" checked={e.benachrichtigung[k]} onChange={(ev) => set((x) => { x.benachrichtigung[k] = ev.target.checked; })} /></label>
  );
  return (
    <>
      <PageHeader eyebrow="Administration" title="Einstellungen"
        action={<div className="meta-row">
          <button className="btn plain" onClick={() => { setE(structuredClone(EINSTELLUNGEN_STANDARD)); setDirty(true); }}>Standardwerte</button>
          {dirty && <button className="btn" onClick={() => void load()}>Verwerfen</button>}
          <button className="btn filled" disabled={!dirty} onClick={() => void run(async () => { setE(await api<Einstellungen>('/admin/einstellungen', { method: 'PUT', body: e })); setDirty(false); }, 'Einstellungen gespeichert')}>Speichern</button>
        </div>} />
      <div className="list-pad einst">
        <Gruppe titel="Allgemein">
          <div className="row"><span className="k">Name der Anwendung</span><input value={e.anzeige.app_name} onChange={(ev) => set((x) => { x.anzeige.app_name = ev.target.value; })} /></div>
        </Gruppe>
        <Gruppe titel="Mängel – Fristen und Eskalation" fuss="Gilt für neu erfasste Mängel und für die Ampel in Listen und Startseiten.">
          {prio('frist_tage', 'Standardfrist nach Erfassung')}
          {prio('nachfrist_tage', 'Vorschlag Nachfrist')}
          <div className="row"><span className="k">„Bald fällig“ ab</span>{zahl(e.maengel.vorwarnung_tage, (n) => set((x) => { x.maengel.vorwarnung_tage = n; }), 'Tage vor der Frist')}</div>
          <div className="row"><span className="k">An die Bauleitung ab</span>{zahl(e.maengel.eskalation_tage, (n) => set((x) => { x.maengel.eskalation_tage = n; }), 'Tage überfällig')}</div>
        </Gruppe>
        <Gruppe titel="Freigaben" fuss="Nachträge über diesem Betrag brauchen eine zusätzliche Freigabe (offener Punkt D11: durch wen).">
          <div className="row"><span className="k">Freigabegrenze Nachträge (netto)</span>{zahl(e.freigabe.nachtrag_grenze_netto, (n) => set((x) => { x.freigabe.nachtrag_grenze_netto = n; }), '€', 1000)}</div>
        </Gruppe>
        <Gruppe titel="E-Mail-Benachrichtigungen" fuss="Mitteilungen in der App kommen immer; hier lässt sich nur die zusätzliche E-Mail abschalten.">
          {schalter('bestellung_mail', 'Neue Bestellanforderung', 'E-Mail an den Einkauf')}
          {schalter('status_mail', 'Status einer Bestellanforderung', 'E-Mail an den Anforderer (bestellt, abgelehnt …)')}
          {schalter('angebot_mail', 'Angebot eingegangen', 'E-Mail an den Ersteller des LV')}
        </Gruppe>
        <Gruppe titel="Fotodokumentation – Kategorien" fuss="Bezeichnungen frei änderbar; abgeschaltete Kategorien werden bei neuen Fotos nicht mehr angeboten.">
          {FOTODOKU_KATEGORIEN.map((k) => (
            <div key={k} className="row">
              <input value={e.fotodoku.kategorien[k]!.label} onChange={(ev) => set((x) => { x.fotodoku.kategorien[k]!.label = ev.target.value; })} />
              <input type="checkbox" className="switch" checked={e.fotodoku.kategorien[k]!.aktiv} onChange={(ev) => set((x) => { x.fotodoku.kategorien[k]!.aktiv = ev.target.checked; })} />
            </div>
          ))}
        </Gruppe>
        <div className="footnote">Weitere einstellbare Werte (Statusketten, Plantypen, Vorlagen) folgen; Firmendaten und Logo stehen unter „Benutzer & Projekte“.</div>
      </div>
    </>
  );
}
function Gruppe({ titel, fuss, children }: { titel: string; fuss?: string; children: ReactNode }) {
  return <section><div className="group-title">{titel}</div><div className="group">{children}</div>{fuss && <div className="footnote">{fuss}</div>}</section>;
}

interface Eintrag { id: number; entity: string; entity_id: string; action: string; occurred_at: string; recorded_at: string; device_id: string | null; data: Record<string, unknown>; von: string; projekt: string | null }

/** Audit log of the whole company with filter; loads 100 at a time. */
function ProtokollPage() {
  const [rows, setRows] = useState<Eintrag[]>([]);
  const [bereiche, setBereiche] = useState<string[]>([]);
  const [weiter, setWeiter] = useState<number | null>(null);
  const [bereich, setBereich] = useState('');
  const [q, setQ] = useState('');
  const [offen, setOffen] = useState<number | null>(null);
  const laden = useCallback(async (vor?: number) => {
    const p = new URLSearchParams();
    if (bereich) p.set('bereich', bereich);
    if (q.trim()) p.set('q', q.trim());
    if (vor) p.set('vor', String(vor));
    const r = await api<{ eintraege: Eintrag[]; bereiche: string[]; weiter: number | null }>(`/admin/protokoll?${p}`);
    setRows((alt) => (vor ? [...alt, ...r.eintraege] : r.eintraege));
    setBereiche(r.bereiche); setWeiter(r.weiter);
  }, [bereich, q]);
  useEffect(() => { const t = setTimeout(() => void laden(), 250); return () => clearTimeout(t); }, [laden]);
  return (
    <>
      <PageHeader eyebrow="Administration" title="Protokoll">
        <div className="meta-row">
          <select value={bereich} onChange={(e) => setBereich(e.target.value)}><option value="">Alle Bereiche</option>{bereiche.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          <label className="search" style={{ flex: 'none', width: 300 }}><Icon name="suche" size={16} /><input placeholder="Suchen (Aktion, Person, Inhalt)" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1200 }}>
        <div className="card">
          <table className="table">
            <thead><tr><th style={{ width: 150 }}>Zeit</th><th>Person</th><th>Bereich</th><th>Aktion</th><th>Projekt</th><th>Gerät</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr onClick={() => setOffen(offen === r.id ? null : r.id)}>
                    <td className="sub">{zeit(r.recorded_at)}{r.occurred_at.slice(0, 16) !== r.recorded_at.slice(0, 16) && <div title="Auf dem Gerät erfasst (offline)">erfasst {zeit(r.occurred_at)}</div>}</td>
                    <td>{r.von}</td><td>{r.entity}</td><td><strong>{r.action}</strong></td><td>{r.projekt ?? '–'}</td><td className="sub">{r.device_id ?? '–'}</td>
                  </tr>
                  {offen === r.id && <tr><td colSpan={6}><pre className="protokoll-daten">{JSON.stringify(r.data, null, 2)}</pre></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">Keine Einträge.</div>}
        </div>
        {weiter && <div className="meta-row" style={{ marginTop: 12 }}><button className="btn" onClick={() => void laden(weiter)}>Weitere laden</button></div>}
        <div className="footnote">Freigaben, Abnahmen, Unterschriften, Statuswechsel, Rechte- und Einstellungsänderungen werden unveränderlich protokolliert (Person, Zeit, Gerät). Ein Klick zeigt die Details.</div>
      </div>
    </>
  );
}
