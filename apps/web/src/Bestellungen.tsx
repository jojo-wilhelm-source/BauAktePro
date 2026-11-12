/**
 * Bestellanforderungen (per site), Einkaufsportal (all sites of the Einkauf) and Mitteilungen
 * (docs/fachkonzept/12 and 04, decided 12.11.2026).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BANF_LABEL, BANF_TONE, banfOffen, formatDate, type BanfStatus } from '@bap/domain';
import { api, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

export interface Banf {
  id: string; project_id: string; project: string; number: number; titel: string; beschreibung: string | null;
  positionen: { text: string; menge?: number | null; einheit?: string | null }[];
  location_id: string | null; ort: string | null; gewerk_id: string | null; gewerk: string | null;
  benoetigt_am: string | null; dringend: boolean; status: BanfStatus; bearbeiter: string | null;
  lv_id: string | null; lv_nummer: number | null; lv_status: string | null;
  lieferant: string | null; bestell_nr: string | null; liefertermin: string | null; bemerkung_einkauf: string | null;
  version: number; created_by: string; angefordert_von: string; created_at: string;
}

const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });
const tone = (s: BanfStatus) => `c-${BANF_TONE[s]}`;
const StatusPill = ({ b }: { b: Banf }) => <span className={`pill ${tone(b.status)}`}>{BANF_LABEL[b.status]}</span>;
const faellig = (b: Banf) => b.benoetigt_am && banfOffen(b.status) && b.benoetigt_am <= new Date().toISOString().slice(0, 10);

function ortPfad(info: ProjectInfo | null, id: string | null) {
  if (!info || !id) return null;
  const parts: string[] = [];
  let cur = info.locations.find((l) => l.id === id);
  while (cur) { parts.unshift(cur.name); cur = info.locations.find((l) => l.id === cur!.parent_id); }
  return parts.join(' › ');
}

function BanfZeile({ b, onOpen, mitBaustelle }: { b: Banf; onOpen: () => void; mitBaustelle?: boolean }) {
  return (
    <tr onClick={onOpen}>
      <td className="num">{b.number}</td>
      <td>
        {b.dringend && <span className="pill c-red" style={{ marginRight: 6 }}>dringend</span>}<strong>{b.titel}</strong>
        <div className="sub">{mitBaustelle ? `${b.project} · ` : ''}{b.positionen.length ? `${b.positionen.length} Position${b.positionen.length > 1 ? 'en' : ''}` : 'ohne Positionen'}{b.ort ? ` · ${b.ort}` : ''} · {b.angefordert_von}</div>
      </td>
      <td style={{ color: faellig(b) ? 'var(--red)' : undefined }}>{b.benoetigt_am ? formatDate(b.benoetigt_am) : '–'}</td>
      <td><StatusPill b={b} />{b.status === 'bestellt' && b.lieferant && <div className="sub">{b.lieferant}{b.liefertermin ? ` · ${formatDate(b.liefertermin)}` : ''}</div>}</td>
    </tr>
  );
}

function BanfTabelle({ rows, onOpen, mitBaustelle }: { rows: Banf[]; onOpen: (b: Banf) => void; mitBaustelle?: boolean }) {
  return (
    <div className="card">
      <table className="table">
        <thead><tr><th style={{ width: 50 }}>Nr.</th><th>Anforderung</th><th style={{ width: 120 }}>benötigt am</th><th style={{ width: 200 }}>Status</th></tr></thead>
        <tbody>{rows.map((b) => <BanfZeile key={b.id} b={b} mitBaustelle={mitBaustelle} onOpen={() => onOpen(b)} />)}</tbody>
      </table>
      {!rows.length && <div className="empty">Keine Bestellanforderungen.</div>}
    </div>
  );
}

/** Per site: list, new request, detail. */
export function BestellungenPage({ info, run, meId, openId, onOpenLv }: { info: ProjectInfo; run: Run; meId: string; openId?: string | null; onOpenLv: (lvId: string) => void }) {
  const [rows, setRows] = useState<Banf[]>([]);
  const [neu, setNeu] = useState(false);
  const [offen, setOffen] = useState<string | null>(openId ?? null);
  const [alle, setAlle] = useState(false);
  const load = useCallback(async () => setRows(await api<Banf[]>(`/projects/${info.project.id}/bestellanforderungen`)), [info.project.id]);
  useEffect(() => void load(), [load]);
  const runAndLoad: Run = async (fn, ok) => { await run(fn, ok); await load(); };
  const sichtbar = alle ? rows : rows.filter((b) => banfOffen(b.status) || b.status === 'bestellt');
  const b = rows.find((r) => r.id === offen) ?? null;
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Bestellanforderungen"
        action={<button className="btn filled" onClick={() => setNeu(true)}><Icon name="plus" size={16} /> Anfordern</button>}>
        <div className="segmented">
          <button className={!alle ? 'on' : ''} onClick={() => setAlle(false)}>Laufend ({rows.filter((r) => banfOffen(r.status) || r.status === 'bestellt').length})</button>
          <button className={alle ? 'on' : ''} onClick={() => setAlle(true)}>Alle ({rows.length})</button>
        </div>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1100 }}>
        <BanfTabelle rows={sichtbar} onOpen={(x) => setOffen(x.id)} />
        <div className="footnote">Polier, Bau- und Projektleitung fordern Material oder Leistungen an – auch offline in der App. Der Einkauf wird sofort benachrichtigt, macht daraus ein LV oder bestellt direkt; Sie bekommen Bescheid, sobald bestellt ist.</div>
      </div>
      {neu && <BanfSheet info={info} onClose={() => setNeu(false)} run={runAndLoad} />}
      {b && <BanfDetail b={b} info={info} meId={meId} run={runAndLoad} onClose={() => setOffen(null)} onOpenLv={onOpenLv} />}
    </>
  );
}

/** New request, or edit an existing one (requester while new, Einkauf / Leitung always). */
export function BanfSheet({ info, onClose, run, edit }: { info: ProjectInfo; onClose: () => void; run: Run; edit?: Banf }) {
  const [titel, setTitel] = useState(edit?.titel ?? '');
  const [beschreibung, setBeschreibung] = useState(edit?.beschreibung ?? '');
  const [pos, setPos] = useState<{ text: string; menge: string; einheit: string }[]>(
    edit?.positionen.length ? edit.positionen.map((p) => ({ text: p.text, menge: p.menge != null ? String(p.menge).replace('.', ',') : '', einheit: p.einheit ?? '' })) : [{ text: '', menge: '', einheit: 'St' }]);
  const [ort, setOrt] = useState(edit?.location_id ?? '');
  const [gewerk, setGewerk] = useState(edit?.gewerk_id ?? '');
  const [datum, setDatum] = useState(edit?.benoetigt_am ?? '');
  const [dringend, setDringend] = useState(edit?.dringend ?? false);
  const orte = useMemo(() => info.locations.map((l) => ({ id: l.id, name: ortPfad(info, l.id) ?? l.name })).sort((a, b) => a.name.localeCompare(b.name, 'de')), [info]);
  const positionen = pos.filter((p) => p.text.trim()).map((p) => ({ text: p.text.trim(), menge: p.menge.trim() ? Number(p.menge.replace(/\./g, '').replace(',', '.')) || null : null, einheit: p.einheit.trim() || null }));
  const body = { titel: titel.trim(), beschreibung: beschreibung.trim() || null, positionen, location_id: ort || null, gewerk_id: gewerk || null, benoetigt_am: datum || null, dringend };
  return (
    <Sheet title={edit ? `Bestellanforderung Nr. ${edit.number} bearbeiten` : 'Neue Bestellanforderung'} primary={edit ? 'Sichern' : 'Anfordern'} primaryDisabled={titel.trim().length < 2} wide onCancel={onClose}
      onPrimary={() => void run(async () => {
        if (edit) await api(`/bestellanforderungen/${edit.id}`, { method: 'PATCH', body: { ...body, base_version: edit.version } });
        else await api('/bestellanforderungen', { method: 'POST', body: { ...body, id: crypto.randomUUID(), project_id: info.project.id } });
        onClose();
      }, edit ? 'Gesichert' : 'Angefordert – der Einkauf ist benachrichtigt')}>
      <div className="group">
        <div className="row"><span className="k">Was wird gebraucht?</span><input autoFocus value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="z. B. Bauzaun und Schuttmulde" /></div>
        <div className="row"><span className="k">Benötigt am</span><input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
        <label className="row"><span className="k">Dringend</span><input type="checkbox" className="switch" checked={dringend} onChange={(e) => setDringend(e.target.checked)} /></label>
        <div className="row"><span className="k">Ort</span><select value={ort} onChange={(e) => setOrt(e.target.value)}><option value="">– ganze Baustelle –</option>{orte.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div className="row"><span className="k">Gewerk</span><select value={gewerk} onChange={(e) => setGewerk(e.target.value)}><option value="">–</option>{info.gewerke.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        <div className="row stack"><textarea rows={2} placeholder="Beschreibung, Hinweise für den Einkauf (Lieferadresse, Ansprechpartner, Abladestelle …)" value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} /></div>
      </div>
      <div className="group-title" style={{ marginTop: 14 }}>Positionen</div>
      <div className="card">
        <table className="table lv-table">
          <thead><tr><th>Material / Leistung</th><th className="money" style={{ width: 100 }}>Menge</th><th style={{ width: 80 }}>Einheit</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {pos.map((p, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td><input className="lv-input" placeholder="z. B. Schalungsplatte 3S 21 mm" value={p.text} onChange={(e) => setPos(pos.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></td>
                <td className="money"><input className="lv-input num-in" inputMode="decimal" value={p.menge} onChange={(e) => setPos(pos.map((x, j) => (j === i ? { ...x, menge: e.target.value } : x)))} /></td>
                <td><input className="lv-input" value={p.einheit} onChange={(e) => setPos(pos.map((x, j) => (j === i ? { ...x, einheit: e.target.value } : x)))} /></td>
                <td><button className="btn small plain destructive" aria-label="Entfernen" onClick={() => setPos(pos.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="meta-row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => setPos([...pos, { text: '', menge: '', einheit: 'St' }])}>+ Position</button></div>
    </Sheet>
  );
}

type Aktion = 'bestellt' | 'abgelehnt' | null;

/** Detail with the actions of the Einkauf (and withdraw for the requester). */
export function BanfDetail({ b, info, meId, run, onClose, onOpenLv }: { b: Banf; info: ProjectInfo | null; meId: string; run: Run; onClose: () => void; onOpenLv: (lvId: string, projectId: string) => void }) {
  const einkauf = info ? info.role === 'bauleitung' || info.role === 'einkauf' : true;
  const mein = b.created_by === meId;
  const [aktion, setAktion] = useState<Aktion>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ lieferant: b.lieferant ?? '', bestell_nr: b.bestell_nr ?? '', liefertermin: b.liefertermin ?? '', bemerkung: '' });
  const status = (s: BanfStatus, extra: Record<string, unknown> = {}, ok = BANF_LABEL[s]) =>
    void run(async () => { await api(`/bestellanforderungen/${b.id}/status`, { method: 'POST', body: { status: s, base_version: b.version, ...extra } }); setAktion(null); }, ok);
  if (edit && info) return <BanfSheet info={info} edit={b} run={run} onClose={() => setEdit(false)} />;
  if (aktion === 'bestellt') {
    return (
      <Sheet title="Als bestellt markieren" primary="Bestellt" primaryDisabled={!f.lieferant.trim()} onCancel={() => setAktion(null)}
        onPrimary={() => status('bestellt', { lieferant: f.lieferant.trim(), bestell_nr: f.bestell_nr.trim() || null, liefertermin: f.liefertermin || null, bemerkung: f.bemerkung.trim() || undefined }, 'Bestellt – der Anforderer ist benachrichtigt')}>
        <div className="group">
          <div className="row"><span className="k">Lieferant</span><input autoFocus value={f.lieferant} onChange={(e) => setF({ ...f, lieferant: e.target.value })} placeholder="z. B. Baustoff Huber" /></div>
          <div className="row"><span className="k">Bestell-Nr.</span><input value={f.bestell_nr} onChange={(e) => setF({ ...f, bestell_nr: e.target.value })} /></div>
          <div className="row"><span className="k">Liefertermin</span><input type="date" value={f.liefertermin} onChange={(e) => setF({ ...f, liefertermin: e.target.value })} /></div>
          <div className="row stack"><textarea rows={2} placeholder="Hinweis an die Baustelle (optional)" value={f.bemerkung} onChange={(e) => setF({ ...f, bemerkung: e.target.value })} /></div>
        </div>
      </Sheet>
    );
  }
  if (aktion === 'abgelehnt') {
    return (
      <Sheet title="Anforderung ablehnen" primary="Ablehnen" destructive primaryDisabled={!f.bemerkung.trim()} onCancel={() => setAktion(null)}
        onPrimary={() => status('abgelehnt', { bemerkung: f.bemerkung.trim() }, 'Abgelehnt – der Anforderer ist benachrichtigt')}>
        <div className="group"><div className="row stack"><textarea autoFocus rows={3} placeholder="Grund (z. B. noch auf Lager, bitte bei … abholen)" value={f.bemerkung} onChange={(e) => setF({ ...f, bemerkung: e.target.value })} /></div></div>
      </Sheet>
    );
  }
  const s = b.status;
  return (
    <Sheet title={`Bestellanforderung Nr. ${b.number}`} primary="Fertig" wide onCancel={onClose} onPrimary={onClose}>
      <div className="meta-row" style={{ marginBottom: 10 }}>
        <StatusPill b={b} />{b.dringend && <span className="pill c-red">dringend</span>}
        <span className="sub">{b.project} · angefordert von {b.angefordert_von} am {formatDate(b.created_at)}{b.bearbeiter ? ` · Einkauf: ${b.bearbeiter}` : ''}</span>
      </div>
      <div className="group">
        <div className="row"><span className="k">Was</span><strong>{b.titel}</strong></div>
        <div className="row"><span className="k">Benötigt am</span><span style={{ color: faellig(b) ? 'var(--red)' : undefined }}>{b.benoetigt_am ? formatDate(b.benoetigt_am) : '–'}</span></div>
        {(b.ort || b.location_id) && <div className="row"><span className="k">Ort</span><span>{ortPfad(info, b.location_id) ?? b.ort}</span></div>}
        {b.gewerk && <div className="row"><span className="k">Gewerk</span><span>{b.gewerk}</span></div>}
        {b.beschreibung && <div className="row stack"><span className="sub">{b.beschreibung}</span></div>}
        {(b.lieferant || b.bestell_nr || b.liefertermin) && <div className="row"><span className="k">Bestellung</span><span>{[b.lieferant, b.bestell_nr && `Nr. ${b.bestell_nr}`, b.liefertermin && `Liefertermin ${formatDate(b.liefertermin)}`].filter(Boolean).join(' · ')}</span></div>}
        {b.bemerkung_einkauf && <div className="row"><span className="k">Einkauf</span><span>{b.bemerkung_einkauf}</span></div>}
        {b.lv_id && <div className="row"><span className="k">Leistungsverzeichnis</span><span><button className="btn small plain" onClick={() => onOpenLv(b.lv_id!, b.project_id)}>LV {b.lv_nummer} öffnen ›</button></span></div>}
      </div>
      {b.positionen.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <table className="table">
            <thead><tr><th>Material / Leistung</th><th className="money" style={{ width: 120 }}>Menge</th></tr></thead>
            <tbody>{b.positionen.map((p, i) => <tr key={i} style={{ cursor: 'default' }}><td>{p.text}</td><td className="money">{p.menge != null ? `${num(p.menge)} ${p.einheit ?? ''}` : '–'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="meta-row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        {einkauf && s === 'offen' && <button className="btn" onClick={() => status('in_bearbeitung', {}, 'Übernommen')}>Übernehmen</button>}
        {einkauf && (s === 'offen' || s === 'in_bearbeitung') && !b.lv_id && <button className="btn" onClick={() => void run(async () => { const r = await api<{ lv_id: string }>(`/bestellanforderungen/${b.id}/lv`, { method: 'POST', body: {} }); onOpenLv(r.lv_id, b.project_id); }, 'LV angelegt – jetzt ergänzen und anfragen')}>LV / Anfrage daraus machen</button>}
        {einkauf && ['offen', 'in_bearbeitung', 'angefragt'].includes(s) && <button className="btn filled" onClick={() => setAktion('bestellt')}>Bestellt …</button>}
        {einkauf && s === 'bestellt' && <button className="btn filled" onClick={() => status('geliefert', {}, 'Als geliefert markiert')}>Geliefert</button>}
        {einkauf && ['offen', 'in_bearbeitung', 'angefragt'].includes(s) && <button className="btn destructive" onClick={() => setAktion('abgelehnt')}>Ablehnen …</button>}
        {einkauf && s === 'abgelehnt' && <button className="btn" onClick={() => status('offen', {}, 'Wieder geöffnet')}>Wieder öffnen</button>}
        {mein && s === 'offen' && <button className="btn destructive" onClick={() => status('zurueckgezogen', {}, 'Zurückgezogen')}>Zurückziehen</button>}
        {info && ((mein && s === 'offen') || einkauf) && !['geliefert', 'zurueckgezogen'].includes(s) && <button className="btn plain" onClick={() => setEdit(true)}>Bearbeiten</button>}
      </div>
    </Sheet>
  );
}

interface Baustelle { id: string; name: string; neu: number; in_arbeit: number; bestellt: number; dringend: number; ueberfaellig: number; naechster_bedarf: string | null; aelteste_neue: string | null; letzte_anforderung: string | null }
interface Portal { baustellen: Baustelle[]; anforderungen: Banf[] }

const seit = (iso: string) => {
  const t = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return t <= 0 ? 'heute' : t === 1 ? 'seit gestern' : `seit ${t} Tagen`;
};
type Filter = 'neu' | 'arbeit' | 'bestellt' | 'alle';
const FILTER: [Filter, string, (b: Banf) => boolean][] = [
  ['neu', 'Neu', (b) => b.status === 'offen'],
  ['arbeit', 'In Arbeit', (b) => b.status === 'in_bearbeitung' || b.status === 'angefragt'],
  ['bestellt', 'Bestellt', (b) => b.status === 'bestellt'],
  ['alle', 'Alle', () => true],
];

/**
 * Einkaufsportal (decided 12.11.2026): first a dashboard over all sites – key figures and, per site, what is
 * requested and how urgent; a click on a site opens its requests.
 */
export function EinkaufsportalPage({ meId, run, onOpenLv, onOpenProject }: { meId: string; run: Run; onOpenLv: (lvId: string, projectId: string) => void; onOpenProject: (projectId: string) => void }) {
  const [d, setD] = useState<Portal | null>(null);
  const [baustelle, setBaustelle] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('neu');
  const [offen, setOffen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => setD(await api<Portal>('/einkaufsportal?status=alle')), []);
  useEffect(() => void load(), [load]);
  useEffect(() => { const t = setInterval(() => void load(), 60_000); return () => clearInterval(t); }, [load]);
  const runAndLoad: Run = async (fn, ok) => { await run(fn, ok); await load(); };
  if (!d) return <p className="loading">Wird geladen …</p>;
  const b = d.anforderungen.find((x) => x.id === offen) ?? null;
  const detail = b && <BanfDetail b={b} info={null} meId={meId} run={runAndLoad} onClose={() => setOffen(null)} onOpenLv={onOpenLv} />;
  const site = d.baustellen.find((x) => x.id === baustelle);

  // --- One site: its requests ---------------------------------------------------------------------
  if (site) {
    const alleDer = d.anforderungen.filter((x) => x.project_id === site.id);
    const f = FILTER.find((x) => x[0] === filter)!;
    const rows = alleDer.filter(f[2]).filter((x) => !q || `${x.titel} ${x.angefordert_von} ${x.positionen.map((p) => p.text).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
    return (
      <>
        <PageHeader eyebrow="Einkaufsportal" title={site.name}
          action={<div className="meta-row"><button className="btn" onClick={() => { setBaustelle(null); setQ(''); }}>‹ Alle Baustellen</button><button className="btn" onClick={() => onOpenProject(site.id)}>Baustelle öffnen</button></div>}>
          <div className="segmented">
            {FILTER.map(([k, label, fn]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label} ({alleDer.filter(fn).length})</button>)}
          </div>
        </PageHeader>
        <div className="list-pad" style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="search" style={{ flex: 'none', maxWidth: 420 }}><Icon name="suche" size={16} /><input placeholder="Suchen (Material, Anforderer)" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <BanfTabelle rows={rows} onOpen={(x) => setOffen(x.id)} />
        </div>
        {detail}
      </>
    );
  }

  // --- Dashboard over all sites --------------------------------------------------------------------
  const sum = (k: keyof Pick<Baustelle, 'neu' | 'in_arbeit' | 'bestellt' | 'dringend' | 'ueberfaellig'>) => d.baustellen.reduce((s, x) => s + x[k], 0);
  const kacheln: [string, number, string][] = [
    ['Neu', sum('neu'), 'var(--orange)'], ['In Arbeit', sum('in_arbeit'), 'var(--accent)'], ['Bestellt, unterwegs', sum('bestellt'), 'var(--label-2)'],
    ['Dringend', sum('dringend'), 'var(--red)'], ['Überfällig', sum('ueberfaellig'), 'var(--red)'],
  ];
  const offeneJe = (pid: string) => d.anforderungen.filter((x) => x.project_id === pid && banfOffen(x.status))
    .sort((x, y) => Number(y.dringend) - Number(x.dringend) || (x.benoetigt_am ?? '9').localeCompare(y.benoetigt_am ?? '9'));
  return (
    <>
      <PageHeader eyebrow="Alle Baustellen" title="Einkaufsportal" />
      <div className="list-pad" style={{ maxWidth: 1200, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="kpi-row">
          {kacheln.map(([label, n, c]) => <div key={label} className="card kpi"><div className="kpi-n" style={{ color: n ? c : 'var(--label-3)' }}>{n}</div><div className="sub">{label}</div></div>)}
        </div>
        <div className="group-title" style={{ margin: 0 }}>Baustellen ({d.baustellen.length})</div>
        <div className="portal-grid">
          {d.baustellen.map((s) => {
            const top = offeneJe(s.id);
            const ruhig = !s.neu && !s.in_arbeit && !s.bestellt;
            return (
              <button key={s.id} className={`card portal-card ${s.neu ? 'hat-neu' : ''}`} onClick={() => { setBaustelle(s.id); setFilter(s.neu ? 'neu' : s.in_arbeit ? 'arbeit' : s.bestellt ? 'bestellt' : 'alle'); }}>
                <div className="meta-row" style={{ justifyContent: 'space-between' }}><strong>{s.name}</strong><Icon name="chevron" size={16} /></div>
                {ruhig ? <span className="sub">Keine offenen Anforderungen{s.letzte_anforderung ? ` · letzte ${formatDate(s.letzte_anforderung)}` : ''}</span> : (
                  <div className="meta-row">
                    {s.neu > 0 && <span className="pill c-orange">{s.neu} neu</span>}
                    {s.in_arbeit > 0 && <span className="pill c-blue">{s.in_arbeit} in Arbeit</span>}
                    {s.bestellt > 0 && <span className="pill c-gray">{s.bestellt} bestellt</span>}
                    {s.dringend > 0 && <span className="pill c-red">{s.dringend} dringend</span>}
                    {s.ueberfaellig > 0 && <span className="pill c-red">{s.ueberfaellig} überfällig</span>}
                  </div>
                )}
                {top.length > 0 && (
                  <ul className="portal-top">
                    {top.slice(0, 3).map((x) => <li key={x.id}><span>{x.dringend ? '❗ ' : ''}{x.titel}</span><span className="sub">{x.benoetigt_am ? formatDate(x.benoetigt_am) : BANF_LABEL[x.status]}</span></li>)}
                    {top.length > 3 && <li className="sub">+ {top.length - 3} weitere</li>}
                  </ul>
                )}
                {(s.aelteste_neue || s.naechster_bedarf) && <span className="sub">{[s.aelteste_neue && `älteste neue ${seit(s.aelteste_neue)}`, s.naechster_bedarf && `nächster Bedarf ${formatDate(s.naechster_bedarf)}`].filter(Boolean).join(' · ')}</span>}
              </button>
            );
          })}
        </div>
        <div className="footnote">Baustellen mit neuen Anforderungen stehen oben. Neue Anforderungen kommen sofort als Mitteilung und per E-Mail; ein Klick auf die Baustelle zeigt ihre Anforderungen. Daraus wird mit einem Klick ein LV für die Anfrage, nach der Bestellung bekommt die Baustelle Bescheid.</div>
      </div>
      {detail}
    </>
  );
}

export interface Mitteilung { id: string; project_id: string | null; project: string | null; art: string; titel: string; text: string | null; entity: string | null; entity_id: string | null; created_at: string; read_at: string | null; von: string | null }

/** Notification centre. */
export function MitteilungenPage({ onOpen, onChange }: { onOpen: (m: Mitteilung) => void; onChange: () => void }) {
  const [d, setD] = useState<{ ungelesen: number; nachrichten: Mitteilung[] } | null>(null);
  const load = useCallback(async () => setD(await api(`/mitteilungen`)), []);
  useEffect(() => void load(), [load]);
  const gelesen = async (id: string) => { await api(`/mitteilungen/${id}/gelesen`, { method: 'POST', body: {} }); await load(); onChange(); };
  if (!d) return <p className="loading">Wird geladen …</p>;
  return (
    <>
      <PageHeader eyebrow="Für Sie" title="Mitteilungen" action={d.ungelesen > 0 ? <button className="btn" onClick={() => void gelesen('alle')}>Alle als gelesen markieren</button> : undefined} />
      <div className="list-pad" style={{ maxWidth: 900 }}>
        <div className="group">
          {d.nachrichten.map((m) => (
            <button key={m.id} className={`row mitteilung ${m.read_at ? '' : 'neu'}`} onClick={() => { if (!m.read_at) void gelesen(m.id); onOpen(m); }}>
              <span className="k">
                <strong>{m.titel}</strong>
                {m.text && <div className="sub" style={{ whiteSpace: 'pre-line' }}>{m.text}</div>}
                <div className="sub">{m.project ?? ''}{m.von ? ` · ${m.von}` : ''} · {new Date(m.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</div>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
          {!d.nachrichten.length && <div className="empty">Keine Mitteilungen.</div>}
        </div>
      </div>
    </>
  );
}
