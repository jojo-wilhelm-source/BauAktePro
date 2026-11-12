/**
 * Einkauf (docs/fachkonzept/12): Leistungsverzeichnis anlegen (auch per Einfügen aus Excel), an Nachunternehmer
 * anfragen (Link/QR per Mail), Preisspiegel nebeneinander, Vergabe. Plus the public offer page (no account) and the
 * NU portal list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, formatEuro, paketAusmultiplizieren, parsePositionen } from '@bap/domain';
import { api, getToken, openPdf, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

type Art = 'titel' | 'untertitel' | 'position' | 'text';
interface Pos { id: string; art: Art; oz: string; kurztext: string; langtext?: string | null; menge: number; einheit: string | null }
interface Ordner { id: string; parent_id: string | null; name: string; sort: number }
interface LvListItem { id: string; nummer: number; titel: string; angebotsfrist: string | null; status: 'entwurf' | 'angefragt' | 'vergeben'; gewerk: string | null; ordner_id: string | null; positionen: number; angefragt: number; angebote: number; vergeben_an_name: string | null; link?: string; abgegeben_at?: string | null }
interface Lv { id: string; project_id: string; nummer: number; titel: string; beschreibung: string | null; angebotsfrist: string | null; gewerk_id: string | null; ordner_id: string | null; status: LvListItem['status']; vergeben_an: string | null; positionen: Pos[]; anfragen: { id: string; company_id: string; company: string; email: string | null; sent_at: string | null; abgegeben_at: string | null }[] }
interface Spiegel {
  lv: Lv;
  angebote: { id: string; company_id: string; company: string; nachlass: number; summe: number | null; bemerkung: string | null; has_pdf: boolean; abgegeben_von: string; abgegeben_at: string }[];
  preise: { id: string; preise: Record<string, number> }[];
  kalkulation: { preise: Record<string, number>; gp: Record<string, number | null>; summe: number; fehlende_positionen: number; titelsummen: Record<string, number>; updated_at: string | null };
  spiegel: { zeilen: { position_id: string; gp: (number | null)[]; guenstigster: string[] }[]; summen: { angebot_id: string; summe: number; nachlass_prozent: number; summe_nach_nachlass: number; fehlende_positionen: number }[]; rang: string[]; guenstigstes: string | null; titelsummen: Record<string, number[]>; abweichung: Record<string, number | null> };
}
interface PaketPos { kurztext: string; langtext?: string | null; einheit: string; faktor: number }
interface Stamm { id: string; kategorie: string; kurztext: string; langtext: string | null; einheit: string; paket: PaketPos[] }
/** A picked library entry: packages carry the total quantity they are multiplied out with. */
type StammPick = Stamm & { menge: number };
const STATUS: Record<LvListItem['status'], [string, string]> = { entwurf: ['Entwurf', 'c-orange'], angefragt: ['Angefragt', 'c-blue'], vergeben: ['Vergeben', 'c-green'] };
const ART_LABEL: Record<Art, string> = { titel: 'Titel', untertitel: 'Untertitel', position: 'Position', text: 'Hinweistext' };
const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });

export function AusschreibungPage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [list, setList] = useState<LvListItem[]>([]);
  const [ordner, setOrdner] = useState<Ordner[]>([]);
  const [sel, setSel] = useState<string | null>(null); // null = alle
  const [open, setOpen] = useState<string | null>(null);
  const [bib, setBib] = useState(false);
  const nu = info.role === 'nu';
  const load = useCallback(async () => {
    setList(await api<LvListItem[]>(`/projects/${info.project.id}/lv`));
    if (!nu) setOrdner(await api<Ordner[]>(`/projects/${info.project.id}/lv-ordner`));
  }, [info.project.id, nu]);
  useEffect(() => void load(), [load]);
  const runAndLoad: Run = async (fn, ok) => { await run(fn, ok); await load(); };
  const neu = () => void run(async () => {
    const id = crypto.randomUUID();
    await api('/lv', { method: 'PUT', body: { id, project_id: info.project.id, titel: 'Neues Leistungsverzeichnis', ordner_id: sel, positionen: [] } });
    await load();
    setOpen(id);
  }, 'Leistungsverzeichnis angelegt');
  const neuerOrdner = (parent: string | null) => {
    const name = window.prompt(parent ? 'Name des Unterordners' : 'Name des Ordners (z. B. Rohbau, Ausbau, TGA)');
    if (name?.trim()) void runAndLoad(() => api(`/projects/${info.project.id}/lv-ordner`, { method: 'PUT', body: { id: crypto.randomUUID(), name: name.trim(), parent_id: parent } }), 'Ordner angelegt');
  };
  // All LVs in the selected folder and its sub-folders.
  const unter = (id: string): string[] => [id, ...ordner.filter((o) => o.parent_id === id).flatMap((o) => unter(o.id))];
  const sichtbar = sel ? list.filter((l) => l.ordner_id && unter(sel).includes(l.ordner_id)) : list;
  const Baum = ({ parent, tiefe }: { parent: string | null; tiefe: number }) => (
    <>
      {ordner.filter((o) => o.parent_id === parent).map((o) => (
        <div key={o.id}>
          <button className={`side-item ordner ${sel === o.id ? 'active' : ''}`} style={{ paddingLeft: 12 + tiefe * 16 }} onClick={() => setSel(o.id)}
            onDoubleClick={() => { const n = window.prompt('Ordner umbenennen', o.name); if (n?.trim()) void runAndLoad(() => api(`/projects/${info.project.id}/lv-ordner`, { method: 'PUT', body: { ...o, name: n.trim() } }), 'Umbenannt'); }}>
            <Icon name="ordner" size={16} /> {o.name}
            <span className="count">{list.filter((l) => l.ordner_id && unter(o.id).includes(l.ordner_id)).length}</span>
          </button>
          <Baum parent={o.id} tiefe={tiefe + 1} />
        </div>
      ))}
    </>
  );

  if (open) return <LvDetail id={open} info={info} run={run} ordner={ordner} onBack={() => { setOpen(null); void load(); }} onOpen={setOpen} />;
  if (nu) {
    return (
      <>
        <PageHeader eyebrow={info.project.name} title="Anfragen" />
        <div className="list-pad" style={{ maxWidth: 1100 }}>
          <div className="group">
            {list.map((l) => (
              <div key={l.id} className="row">
                <span className="k">{l.titel}<div className="sub">{l.angebotsfrist ? `Angebot bis ${formatDate(l.angebotsfrist)}` : 'ohne Frist'}{l.abgegeben_at ? ` · abgegeben ${formatDate(l.abgegeben_at)}` : ''}</div></span>
                {l.status === 'angefragt' ? <a className="btn small filled" href={l.link} target="_blank" rel="noreferrer">{l.abgegeben_at ? 'Angebot ändern' : 'Angebot abgeben'}</a> : <span className={`pill ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span>}
              </div>
            ))}
            {list.length === 0 && <div className="empty">Keine Anfragen</div>}
          </div>
          <div className="footnote">Preise anderer Bieter sind nie sichtbar.</div>
        </div>
      </>
    );
  }
  const selOrdner = ordner.find((o) => o.id === sel);
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Leistungsverzeichnisse & Angebote"
        action={<div className="meta-row">
          <button className="btn" onClick={() => setBib(true)}>Stammleistungen</button>
          <button className="btn filled" onClick={neu}><Icon name="plus" size={16} /> Leistungsverzeichnis{selOrdner ? ` in „${selOrdner.name}“` : ''}</button>
        </div>} />
      <div className="lv-split">
        <aside className="lv-tree">
          <button className={`side-item ordner ${sel === null ? 'active' : ''}`} onClick={() => setSel(null)}><Icon name="ordner" size={16} /> Alle LVs <span className="count">{list.length}</span></button>
          <Baum parent={null} tiefe={0} />
          <div className="lv-tree-actions">
            <button className="btn small plain" onClick={() => neuerOrdner(null)}>+ Ordner</button>
            {selOrdner && <button className="btn small plain" onClick={() => neuerOrdner(selOrdner.id)}>+ Unterordner</button>}
            {selOrdner && <button className="btn small plain destructive" onClick={() => void runAndLoad(async () => { await api(`/lv-ordner/${selOrdner.id}`, { method: 'DELETE' }); setSel(null); }, 'Ordner gelöscht')}>Löschen</button>}
          </div>
          <div className="footnote">Doppelklick benennt einen Ordner um. Ordner frei wählbar, z. B. Rohbau › Estrich.</div>
        </aside>
        <div>
          <div className="group">
            {sichtbar.map((l) => (
              <button key={l.id} className="row action" style={{ color: 'var(--label)' }} onClick={() => setOpen(l.id)}>
                <span className="k">LV {l.nummer} · {l.titel}
                  <div className="sub">{ordner.find((o) => o.id === l.ordner_id)?.name ?? 'ohne Ordner'} · {l.gewerk ?? 'ohne Gewerk'} · {l.positionen} Positionen · {l.angefragt} angefragt · {l.angebote} Angebote{l.angebotsfrist ? ` · Frist ${formatDate(l.angebotsfrist)}` : ''}{l.vergeben_an_name ? ` · vergeben an ${l.vergeben_an_name}` : ''}</div>
                </span>
                <span className={`pill ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span>
              </button>
            ))}
            {sichtbar.length === 0 && <div className="empty">Noch kein Leistungsverzeichnis{selOrdner ? ' in diesem Ordner' : ''}</div>}
          </div>
          <div className="footnote">Bieter antworten über einen Link (ohne Konto) oder im Portal – mit Einheitspreisen oder als PDF. Vergeben darf die Bau- oder Projektleitung.</div>
        </div>
      </div>
      {bib && <StammSheet onClose={() => setBib(false)} run={run} />}
    </>
  );
}

function LvDetail({ id, info, run, ordner, onBack, onOpen }: { id: string; info: ProjectInfo; run: Run; ordner: Ordner[]; onBack: () => void; onOpen: (id: string) => void }) {
  const [lv, setLv] = useState<Lv | null>(null);
  const [rows, setRows] = useState<Pos[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'lv' | 'spiegel'>('lv');
  const [paste, setPaste] = useState(false);
  const [bib, setBib] = useState(false);
  const [anfragen, setAnfragen] = useState(false);
  const [sp, setSp] = useState<Spiegel | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const load = useCallback(async () => {
    const l = await api<Lv>(`/lv/${id}`);
    setLv(l);
    setRows(l.positionen);
    setDirty(false);
    setSp(await api<Spiegel>(`/lv/${id}/preisspiegel`));
  }, [id]);
  useEffect(() => void load(), [load]);
  if (!lv) return <p className="loading">Wird geladen …</p>;
  const draft = lv.status === 'entwurf';
  const head = (patch: Partial<Lv>, ok = 'Gespeichert') => run(async () => {
    const n = { ...lv, ...patch };
    await api('/lv', { method: 'PUT', body: { id: n.id, project_id: n.project_id, titel: n.titel, beschreibung: n.beschreibung, gewerk_id: n.gewerk_id, angebotsfrist: n.angebotsfrist, ordner_id: n.ordner_id } });
    await load();
  }, ok);
  const saveRows = () => run(async () => {
    await api('/lv', { method: 'PUT', body: { id: lv.id, project_id: lv.project_id, titel: lv.titel, auto_oz: true,
      positionen: rows.map((p) => ({ ...p, langtext: p.langtext || null, einheit: p.art === 'position' ? p.einheit : null })) } });
    await load();
  }, 'LV gespeichert, OZ neu nummeriert');
  const edit = (rs: Pos[]) => { setRows(rs); setDirty(true); };
  const add = (art: Art, after?: number) => {
    const z: Pos = { id: crypto.randomUUID(), art, oz: '', kurztext: '', langtext: null, menge: art === 'position' ? 1 : 0, einheit: art === 'position' ? 'St' : null };
    const i = after ?? rows.length - 1;
    edit([...rows.slice(0, i + 1), z, ...rows.slice(i + 1)]);
  };
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j]!, n[i]!]; edit(n); };
  const set = (i: number, p: Partial<Pos>) => edit(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const anzahl = rows.filter((r) => r.art === 'position').length;
  const valid = rows.every((r) => r.kurztext.trim() && (r.art !== 'position' || (r.einheit ?? '').trim()));
  const kopie = () => void run(async () => { const r = await api<{ id: string }>(`/lv/${lv.id}/kopie`, { method: 'POST', body: { project_id: lv.project_id, ordner_id: lv.ordner_id } }); onOpen(r.id); }, 'Kopie angelegt (Entwurf)');
  return (
    <>
      <PageHeader eyebrow={`${info.project.name} · LV ${lv.nummer}`} title={lv.titel}
        action={<div className="meta-row">
          <button className="btn" onClick={onBack}>Alle LVs</button>
          <button className="btn" onClick={() => void openPdf(`/lv/${lv.id}/pdf`)}>LV als PDF</button>
          <button className="btn" onClick={kopie}>Kopieren / als Vorlage</button>
          {lv.status !== 'vergeben' && <button className="btn filled" disabled={!anzahl || dirty} onClick={() => setAnfragen(true)}>An Nachunternehmer anfragen …</button>}
        </div>}>
        <div className="segmented">
          <button className={tab === 'lv' ? 'on' : ''} onClick={() => setTab('lv')}>Gliederung ({anzahl} Positionen)</button>
          <button className={tab === 'spiegel' ? 'on' : ''} disabled={dirty} onClick={() => setTab('spiegel')}>Kalkulation & Preisspiegel{sp ? ` (${sp.angebote.length})` : ''}</button>
        </div>
        <span className={`pill ${STATUS[lv.status][1]}`}>{STATUS[lv.status][0]}</span>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1400, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {tab === 'lv' ? (
          <>
            <div className="group">
              <div className="row"><span className="k">Bezeichnung</span><input defaultValue={lv.titel} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== lv.titel && void head({ titel: e.target.value.trim() })} /></div>
              <div className="row"><span className="k">Ordner</span><select value={lv.ordner_id ?? ''} onChange={(e) => void head({ ordner_id: e.target.value || null }, 'Verschoben')}><option value="">ohne Ordner</option>{ordner.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
              <div className="row"><span className="k">Gewerk</span><select value={lv.gewerk_id ?? ''} onChange={(e) => void head({ gewerk_id: e.target.value || null })}><option value="">–</option>{info.gewerke.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
              <div className="row"><span className="k">Angebotsfrist</span><input type="date" value={lv.angebotsfrist ?? ''} onChange={(e) => void head({ angebotsfrist: e.target.value || null })} /></div>
            </div>
            {draft && (
              <div className="meta-row lv-toolbar">
                <button className="btn small" onClick={() => add('titel')}>+ Titel</button>
                <button className="btn small" onClick={() => add('untertitel')}>+ Untertitel</button>
                <button className="btn small" onClick={() => add('position')}>+ Position</button>
                <button className="btn small" onClick={() => add('text')}>+ Hinweistext</button>
                <button className="btn small" onClick={() => setBib(true)}>Aus Stammleistungen …</button>
                <button className="btn small" onClick={() => setPaste(true)}>Aus Excel einfügen …</button>
                <span className="spacer" />
                {dirty && <button className="btn small plain" onClick={() => void load()}>Verwerfen</button>}
                <button className="btn small filled" disabled={!dirty || !valid} onClick={() => void saveRows()}>Speichern</button>
              </div>
            )}
            <div className="card">
              <table className="table lv-table">
                <thead><tr><th style={{ width: 110 }}>OZ</th><th>Kurztext</th><th className="money" style={{ width: 110 }}>Menge</th><th style={{ width: 80 }}>Einheit</th>{draft && <th style={{ width: 150 }} />}</tr></thead>
                <tbody>
                  {rows.map((p, i) => (
                      <tr key={p.id} className={`lv-${p.art}`} style={{ cursor: 'default' }}>
                        <td className="num">{dirty ? <span className="sub">{ART_LABEL[p.art]}</span> : p.oz}</td>
                        <td style={{ paddingLeft: p.art === 'position' || p.art === 'text' ? 28 : p.art === 'untertitel' ? 16 : 8 }}>
                          {draft ? <input className="lv-input" placeholder={ART_LABEL[p.art]} value={p.kurztext} onChange={(e) => set(i, { kurztext: e.target.value })} /> : <span>{p.kurztext}</span>}
                          {p.art === 'position' && (draft
                            ? <button className="btn small plain" onClick={() => setLang(lang === p.id ? null : p.id)}>{p.langtext ? 'Langtext ✓' : 'Langtext'}</button>
                            : p.langtext && <div className="sub">{p.langtext}</div>)}
                          {lang === p.id && draft && <textarea className="lv-lang" rows={4} placeholder="Langtext der Position" value={p.langtext ?? ''} onChange={(e) => set(i, { langtext: e.target.value })} />}
                        </td>
                        <td className="money">{p.art === 'position' ? (draft ? <input className="lv-input num-in" inputMode="decimal" value={String(p.menge).replace('.', ',')} onChange={(e) => set(i, { menge: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 })} /> : num(p.menge)) : ''}</td>
                        <td>{p.art === 'position' ? (draft ? <input className="lv-input" value={p.einheit ?? ''} onChange={(e) => set(i, { einheit: e.target.value })} /> : p.einheit) : ''}</td>
                        {draft && (
                          <td className="lv-actions">
                            <button className="btn small plain" title="nach oben" onClick={() => move(i, -1)}>↑</button>
                            <button className="btn small plain" title="nach unten" onClick={() => move(i, 1)}>↓</button>
                            <button className="btn small plain" title="Position darunter" onClick={() => add('position', i)}>+</button>
                            {(p.art === 'titel' || p.art === 'untertitel') && <button className="btn small plain" title="Als Leistungspaket in die Stammleistungen" onClick={() => {
                              const unter: PaketPos[] = [];
                              for (const r of rows.slice(i + 1)) {
                                if (r.art === 'titel' || (r.art === 'untertitel' && p.art === 'untertitel')) break;
                                if (r.art === 'position') unter.push({ kurztext: r.kurztext, langtext: r.langtext ?? null, einheit: r.einheit ?? 'St', faktor: r.menge });
                              }
                              if (!unter.length) return;
                              void run(() => api('/stammleistungen', { method: 'PUT', body: { id: crypto.randomUUID(), kategorie: info.gewerke.find((g) => g.id === lv.gewerk_id)?.name ?? 'Allgemein', kurztext: p.kurztext || 'Leistungspaket', einheit: 'St', paket: unter } }), `Paket mit ${unter.length} Positionen übernommen (je 1 St – Bezugseinheit in den Stammleistungen anpassen)`);
                            }}>★</button>}
                            {p.art === 'position' && <button className="btn small plain" title="In Stammleistungen übernehmen" onClick={() => void run(() => api('/stammleistungen', { method: 'PUT', body: { id: crypto.randomUUID(), kategorie: info.gewerke.find((g) => g.id === lv.gewerk_id)?.name ?? 'Allgemein', kurztext: p.kurztext, langtext: p.langtext ?? null, einheit: p.einheit } }), 'In Stammleistungen übernommen')}>★</button>}
                            <button className="btn small plain destructive" aria-label="Entfernen" onClick={() => edit(rows.filter((_, j) => j !== i))}>✕</button>
                          </td>
                        )}
                      </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <div className="empty">Noch leer – mit „+ Titel“ und „+ Position“ beginnen, aus den Stammleistungen wählen oder aus Excel einfügen.</div>}
            </div>
            <div className="footnote">{draft ? 'OZ werden beim Speichern automatisch vergeben (Titel 01, Untertitel 01.01, Position 01.01.0010). ★ übernimmt eine Position in die Stammleistungen der Firma.' : 'Nach dem Versand ist das LV gesperrt – alle Bieter rechnen dasselbe LV. Für Änderungen: „Kopieren / als Vorlage“.'}</div>
            {lv.anfragen.length > 0 && (
              <div>
                <div className="group-title">Angefragt</div>
                <div className="group">
                  {lv.anfragen.map((a) => (
                    <div key={a.id} className="row"><span className="k">{a.company}<div className="sub">{a.email ?? 'keine E-Mail'} · angefragt {a.sent_at ? formatDate(a.sent_at) : '–'}</div></span>
                      <span className={`pill ${a.abgegeben_at ? 'c-green' : 'c-gray'}`}>{a.abgegeben_at ? `Angebot ${formatDate(a.abgegeben_at)}` : 'offen'}</span></div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : sp && <PreisspiegelView sp={sp} info={info} run={async (fn, ok) => { await run(fn, ok); await load(); }} />}
      </div>
      {paste && <PasteSheet onClose={() => setPaste(false)} onOk={(neu) => { setPaste(false); edit([...rows, ...neu]); }} />}
      {bib && <StammSheet pick onClose={() => setBib(false)} run={run}
        onPick={(sel) => { setBib(false); edit([...rows, ...sel.flatMap((x): Pos[] => x.paket.length
          ? [{ id: crypto.randomUUID(), art: 'untertitel', oz: '', kurztext: `${x.kurztext} (${num(x.menge)} ${x.einheit})`, langtext: null, menge: 0, einheit: null },
            ...paketAusmultiplizieren(x.paket, x.menge).map((q) => ({ id: crypto.randomUUID(), art: 'position' as const, oz: '', ...q }))]
          : [{ id: crypto.randomUUID(), art: 'position', oz: '', kurztext: x.kurztext, langtext: x.langtext, menge: x.menge, einheit: x.einheit }])]); }} />}
      {anfragen && <AnfrageSheet lv={lv} info={info} onClose={() => setAnfragen(false)} run={async (fn, ok) => { await run(fn, ok); await load(); }} />}
    </>
  );
}

/** Company library of standard items and service packages: search, pick several for an LV (packages with a total quantity), maintain. */
function StammSheet({ onClose, run, pick, onPick }: { onClose: () => void; run: Run; pick?: boolean; onPick?: (s: StammPick[]) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Stamm[]>([]);
  const [chosen, setChosen] = useState<Map<string, number>>(new Map());
  const [offen, setOffen] = useState<{ s: Stamm; paket: boolean } | null>(null);
  const [neu, setNeu] = useState({ kategorie: '', kurztext: '', einheit: '', paket: false });
  const load = useCallback(async () => setRows(await api<Stamm[]>(`/stammleistungen${q ? `?q=${encodeURIComponent(q)}` : ''}`)), [q]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  const kats = [...new Set(rows.map((r) => r.kategorie))];
  const toggle = (id: string, on: boolean) => { const n = new Map(chosen); if (on) n.set(id, n.get(id) ?? 1); else n.delete(id); setChosen(n); };
  if (offen) return <PaketSheet stamm={offen.s} paket={offen.paket} run={run} onClose={() => { setOffen(null); void load(); }} />;
  return (
    <Sheet title="Stammleistungen" primary={pick ? `${chosen.size} einfügen` : 'Fertig'} primaryDisabled={pick && !chosen.size} wide onCancel={onClose}
      onPrimary={() => (pick ? onPick?.(rows.filter((r) => chosen.has(r.id)).map((r) => ({ ...r, menge: chosen.get(r.id) ?? 1 }))) : onClose())}>
      <label className="search" style={{ marginBottom: 10 }}><Icon name="suche" size={16} /><input autoFocus placeholder="Suchen (Text oder Kategorie)" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {kats.map((k) => (
        <div key={k}>
          <div className="group-title">{k}</div>
          <div className="group">
            {rows.filter((r) => r.kategorie === k).map((r) => (
              <div key={r.id} className="row">
                <span className="k">
                  {r.paket.length > 0 && <span className="pill c-blue" style={{ marginRight: 6 }}>Paket</span>}{r.kurztext}
                  {r.paket.length > 0
                    ? <div className="sub">je {r.einheit}: {r.paket.map((x) => `${x.kurztext} ${num(x.faktor)} ${x.einheit}`).join(' · ')}</div>
                    : r.langtext && <div className="sub">{r.langtext.slice(0, 140)}{r.langtext.length > 140 ? '…' : ''}</div>}
                </span>
                <span className="actions">
                  {pick && chosen.has(r.id)
                    ? <><input className="lv-input num-in" style={{ width: 80 }} inputMode="decimal" aria-label="Menge" value={String(chosen.get(r.id)).replace('.', ',')}
                        onChange={(e) => setChosen(new Map(chosen).set(r.id, Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0))} /><span className="v">{r.einheit}</span></>
                    : <span className="v">{r.einheit}</span>}
                  {pick ? <input type="checkbox" className="switch" checked={chosen.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
                    : <>
                        <button className="btn small plain" onClick={() => setOffen({ s: r, paket: r.paket.length > 0 })}>{r.paket.length ? `${r.paket.length} Positionen` : 'Bearbeiten'}</button>
                        <button className="btn small plain destructive" aria-label="Entfernen" onClick={() => void run(async () => { await api(`/stammleistungen/${r.id}`, { method: 'DELETE' }); await load(); }, 'Entfernt')}>✕</button>
                      </>}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {rows.length === 0 && <div className="empty">Keine Stammleistungen{q ? ' zu dieser Suche' : ' – unten anlegen oder im LV mit ★ übernehmen'}.</div>}
      {pick && chosen.size > 0 && <div className="footnote">Pakete werden als Untertitel mit ihren Positionen eingefügt; die Mengen ergeben sich aus der eingegebenen Gesamtmenge.</div>}
      <div className="group-title" style={{ marginTop: 14 }}>Neue Stammleistung oder Leistungspaket</div>
      <div className="group">
        <div className="row teil-row">
          <input placeholder="Kategorie, z. B. Rohbau" value={neu.kategorie} onChange={(e) => setNeu({ ...neu, kategorie: e.target.value })} />
          <input className="tb-left" placeholder={neu.paket ? 'Paket, z. B. Bodenplatte' : 'Kurztext'} value={neu.kurztext} onChange={(e) => setNeu({ ...neu, kurztext: e.target.value })} />
          <input placeholder={neu.paket ? 'je, z. B. m2' : 'Einheit'} style={{ width: 90 }} value={neu.einheit} onChange={(e) => setNeu({ ...neu, einheit: e.target.value })} />
          <label className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={neu.paket} onChange={(e) => setNeu({ ...neu, paket: e.target.checked })} />Paket</label>
          <button className="btn small" disabled={!neu.kurztext.trim() || !neu.einheit.trim()} onClick={() => void run(async () => {
            const body: Stamm = { id: crypto.randomUUID(), kategorie: neu.kategorie.trim() || 'Allgemein', kurztext: neu.kurztext.trim(), langtext: null, einheit: neu.einheit.trim(), paket: [] };
            if (!neu.paket) await api('/stammleistungen', { method: 'PUT', body });
            setNeu({ ...neu, kurztext: '', einheit: '' });
            if (neu.paket) setOffen({ s: body, paket: true }); else await load();
          }, neu.paket ? 'Positionen jetzt festlegen' : 'Stammleistung angelegt')}>{neu.paket ? 'Positionen festlegen …' : 'Anlegen'}</button>
        </div>
      </div>
    </Sheet>
  );
}

/** Edit a library entry; a package holds several positions with their quantity per package unit. */
function PaketSheet({ stamm, paket, run, onClose }: { stamm: Stamm; paket: boolean; run: Run; onClose: () => void }) {
  const [d, setD] = useState<Stamm>(stamm);
  const [faktorText, setFaktorText] = useState<string[]>(stamm.paket.map((x) => String(x.faktor).replace('.', ',')));
  const setPos = (i: number, patch: Partial<PaketPos>) => setD({ ...d, paket: d.paket.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const add = () => { setD({ ...d, paket: [...d.paket, { kurztext: '', einheit: '', faktor: 0 }] }); setFaktorText([...faktorText, '']); };
  const valid = d.kurztext.trim() && d.einheit.trim() && d.paket.every((x) => x.kurztext.trim() && x.einheit.trim());
  const istPaket = d.paket.length > 0;
  return (
    <Sheet title={paket || istPaket ? 'Leistungspaket' : 'Stammleistung'} primary="Sichern" primaryDisabled={!valid} wide onCancel={onClose}
      onPrimary={() => void run(async () => { await api('/stammleistungen', { method: 'PUT', body: { ...d, paket: d.paket.map((x) => ({ ...x, kurztext: x.kurztext.trim(), einheit: x.einheit.trim() })) } }); onClose(); }, 'Gesichert')}>
      <div className="group">
        <div className="row"><span className="k">Kategorie</span><input value={d.kategorie} onChange={(e) => setD({ ...d, kategorie: e.target.value })} /></div>
        <div className="row"><span className="k">Bezeichnung</span><input value={d.kurztext} onChange={(e) => setD({ ...d, kurztext: e.target.value })} /></div>
        <div className="row"><span className="k">{istPaket ? 'Bezugseinheit (je …)' : 'Einheit'}</span><input value={d.einheit} onChange={(e) => setD({ ...d, einheit: e.target.value })} /></div>
        {!istPaket && <div className="row"><span className="k">Langtext</span><textarea rows={3} value={d.langtext ?? ''} onChange={(e) => setD({ ...d, langtext: e.target.value || null })} /></div>}
      </div>
      <div className="group-title" style={{ marginTop: 14 }}>Positionen im Paket{d.einheit ? ` – Menge je 1 ${d.einheit}` : ''}</div>
      <div className="card">
        <table className="table lv-table">
          <thead><tr><th>Kurztext</th><th className="money" style={{ width: 120 }}>Menge je {d.einheit || 'Einheit'}</th><th style={{ width: 90 }}>Einheit</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {d.paket.map((x, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td><input className="lv-input" placeholder="z. B. Beton C30/37 liefern und einbauen" value={x.kurztext} onChange={(e) => setPos(i, { kurztext: e.target.value })} /></td>
                <td className="money"><input className="lv-input num-in" inputMode="decimal" value={faktorText[i] ?? ''} onChange={(e) => {
                  const t = [...faktorText]; t[i] = e.target.value; setFaktorText(t);
                  setPos(i, { faktor: Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 });
                }} /></td>
                <td><input className="lv-input" placeholder="m3" value={x.einheit} onChange={(e) => setPos(i, { einheit: e.target.value })} /></td>
                <td><button className="btn small plain destructive" aria-label="Entfernen" onClick={() => { setD({ ...d, paket: d.paket.filter((_, j) => j !== i) }); setFaktorText(faktorText.filter((_, j) => j !== i)); }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.paket.length === 0 && <div className="empty">Einzelleistung – mit „+ Position“ wird daraus ein Paket.</div>}
      </div>
      <div className="meta-row" style={{ marginTop: 8 }}><button className="btn small" onClick={add}>+ Position</button></div>
      <div className="footnote">Beispiel Bodenplatte je m²: Aushub 0,40 m³ · Bewehrung 0,03 t · Randschalung 0,20 m · Beton 0,25 m³. Beim Einfügen ins LV gibt man die Gesamtmenge an (z. B. 120 m²), die Mengen werden ausmultipliziert.</div>
    </Sheet>
  );
}

const parseNum = (t: string) => { const n = Number(t.trim().replace(/\s|€/g, '').replace(/\./g, '').replace(',', '.')); return t.trim() && Number.isFinite(n) ? n : null; };
const epText = (n: number | undefined) => (n == null ? '' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * Preisspiegel: own calculation on the left, then the bidders side by side (cheapest first or in order of receipt).
 * Offers received by mail or on paper are entered here by Einkauf / Leitung.
 */
function PreisspiegelView({ sp, info, run }: { sp: Spiegel; info: ProjectInfo; run: Run }) {
  const { lv, angebote, preise, spiegel, kalkulation: kalk } = sp;
  const [reihe, setReihe] = useState<'rang' | 'eingang'>('rang');
  const [kalkEdit, setKalkEdit] = useState<Record<string, string> | null>(null);
  const [erfassen, setErfassen] = useState<{ company_id?: string } | null>(null);
  const order = (reihe === 'rang' ? spiegel.rang : [...angebote].sort((x, y) => x.abgegeben_at.localeCompare(y.abgegeben_at)).map((a) => a.id)).map((id) => angebote.findIndex((a) => a.id === id));
  const ep = (aIdx: number, pid: string) => preise[aIdx]?.preise[pid];
  const zeile = new Map(spiegel.zeilen.map((z) => [z.position_id, z]));
  const positionen = lv.positionen.filter((p) => p.art === 'position');
  const kalkLive = (pid: string) => (kalkEdit ? parseNum(kalkEdit[pid] ?? '') : kalk.preise[pid] ?? null);
  const kalkGp = (p: Pos) => { const e = kalkLive(p.id); return e == null ? null : Math.round(e * p.menge * 100) / 100; };
  const kalkSumme = kalkEdit ? positionen.reduce((s, p) => s + (kalkGp(p) ?? 0), 0) : kalk.summe;
  const hatKalk = kalkEdit != null || Object.keys(kalk.preise).length > 0;
  const kalkTitel = (id: string) => {
    if (!kalkEdit) return kalk.titelsummen[id] ?? 0;
    let on = false, sum = 0; const start = lv.positionen.find((x) => x.id === id)!;
    for (const x of lv.positionen) {
      if (x.id === id) { on = true; continue; }
      if (!on) continue;
      if (x.art === 'titel' || (x.art === 'untertitel' && start.art === 'untertitel')) break;
      if (x.art === 'position') sum += kalkGp(x) ?? 0;
    }
    return sum;
  };
  const vergeben = lv.status === 'vergeben';
  const pctTone = (v: number | null) => (v == null ? '' : v > 10 ? 'var(--red)' : v > 0 ? 'var(--orange)' : 'var(--green)');
  return (
    <>
      <div className="meta-row">
        {!vergeben && (kalkEdit
          ? <>
              <button className="btn small plain" onClick={() => setKalkEdit(null)}>Abbrechen</button>
              <button className="btn small filled" onClick={() => void run(async () => {
                const body: Record<string, number> = {};
                for (const [k, v] of Object.entries(kalkEdit)) { const n = parseNum(v); if (n != null) body[k] = n; }
                await api(`/lv/${lv.id}/kalkulation`, { method: 'PUT', body: { preise: body } });
                setKalkEdit(null);
              }, 'Kalkulation gespeichert')}>Kalkulation speichern</button>
            </>
          : <button className="btn small" onClick={() => setKalkEdit(Object.fromEntries(positionen.map((p) => [p.id, epText(kalk.preise[p.id])])))}>{hatKalk ? 'Kalkulation bearbeiten' : 'Eigene Kalkulation eintragen'}</button>)}
        {!vergeben && <button className="btn small" onClick={() => setErfassen({})}>Angebot erfassen …</button>}
        <span className="spacer" />
        {angebote.length > 1 && <div className="segmented small">
          <button className={reihe === 'rang' ? 'on' : ''} onClick={() => setReihe('rang')}>Günstigstes zuerst</button>
          <button className={reihe === 'eingang' ? 'on' : ''} onClick={() => setReihe('eingang')}>Nach Eingang</button>
        </div>}
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table spiegel">
          <thead>
            <tr><th style={{ width: 90 }}>OZ</th><th style={{ minWidth: 220 }}>Leistung</th><th className="money">Menge</th>
              <th className="money kalk" colSpan={2}>Kalkulation<div className="sub">{kalk.updated_at ? `Stand ${formatDate(kalk.updated_at)}` : 'eigene Preise'}</div></th>
              {order.map((i, r) => <th key={angebote[i]!.id} className="money" colSpan={2}>
                <span className="sub">Bieter {angebote.length > 1 ? (reihe === 'rang' ? r + 1 : [...angebote].sort((x, y) => x.abgegeben_at.localeCompare(y.abgegeben_at)).findIndex((a) => a.id === angebote[i]!.id) + 1) : 1}</span><br />
                {reihe === 'rang' && r === 0 && angebote.length > 1 && '★ '}{angebote[i]!.company}<div className="sub">{formatDate(angebote[i]!.abgegeben_at)}{angebote[i]!.abgegeben_von.startsWith('erfasst') ? ' · erfasst' : ''}</div></th>)}</tr>
            <tr><th /><th /><th /><th className="money sub kalk">EP</th><th className="money sub kalk">GP</th>{order.map((i) => [<th key={`e${i}`} className="money sub">EP</th>, <th key={`g${i}`} className="money sub">GP</th>])}</tr>
          </thead>
          <tbody>
            {lv.positionen.map((p) => {
              if (p.art === 'titel' || p.art === 'untertitel') {
                const ts = spiegel.titelsummen[p.id] ?? [];
                return (
                  <tr key={p.id} className={`lv-${p.art}`} style={{ cursor: 'default' }}>
                    <td className="num">{p.oz}</td><td colSpan={2}><strong>{p.kurztext}</strong></td>
                    <td colSpan={2} className="money kalk"><strong>{hatKalk ? formatEuro(kalkTitel(p.id)) : ''}</strong></td>
                    {order.map((i) => <td key={i} colSpan={2} className="money"><strong>{formatEuro(ts[i] ?? 0)}</strong></td>)}
                  </tr>
                );
              }
              if (p.art === 'text') return <tr key={p.id} className="lv-text"><td /><td colSpan={4 + order.length * 2} className="sub">{p.kurztext}</td></tr>;
              const z = zeile.get(p.id);
              const kg = kalkGp(p);
              return (
                <tr key={p.id} style={{ cursor: 'default' }}>
                  <td className="num">{p.oz}</td><td>{p.kurztext}</td><td className="money">{num(p.menge)} {p.einheit}</td>
                  <td className="money kalk">{kalkEdit
                    ? <input className="lv-input num-in" inputMode="decimal" aria-label={`Kalkulation EP ${p.oz}`} value={kalkEdit[p.id] ?? ''} onChange={(e) => setKalkEdit({ ...kalkEdit, [p.id]: e.target.value })} />
                    : <span className="sub">{kalk.preise[p.id] != null ? formatEuro(kalk.preise[p.id]!) : '–'}</span>}</td>
                  <td className="money kalk">{kg != null ? formatEuro(kg) : '–'}</td>
                  {order.map((i) => {
                    const best = z?.guenstigster.includes(angebote[i]!.id);
                    const e = ep(i, p.id);
                    const k = kalkLive(p.id);
                    const ueber = e != null && k ? (e - k) / k : 0;
                    return [<td key={`e${i}`} className="money sub" title={k && e != null ? `${ueber >= 0 ? '+' : ''}${(ueber * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % zur Kalkulation` : undefined}
                        style={ueber > 0.2 ? { color: 'var(--red)' } : undefined}>{e != null ? formatEuro(e) : '–'}</td>,
                      <td key={`g${i}`} className={`money ${best && angebote.length > 1 ? 'best' : ''}`}>{z?.gp[i] != null ? formatEuro(z.gp[i]!) : '–'}</td>];
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(['summe', 'nachlass', 'netto', 'abw'] as const).map((k) => (
              <tr key={k}><td /><td><strong>{{ summe: 'Summe netto', nachlass: 'Nachlass', netto: 'Angebotssumme nach Nachlass', abw: 'Abweichung zur Kalkulation' }[k]}</strong></td><td />
                <td colSpan={2} className="money kalk">{k === 'summe' || k === 'netto' ? (hatKalk ? <strong>{formatEuro(kalkSumme)}</strong> : '–') : ''}
                  {k === 'netto' && hatKalk && !kalkEdit && kalk.fehlende_positionen > 0 && <div className="sub" style={{ color: 'var(--orange)' }}>{kalk.fehlende_positionen} Pos. ohne Preis</div>}</td>
                {order.map((i, r) => {
                  const s = spiegel.summen.find((x) => x.angebot_id === angebote[i]!.id)!;
                  const abw = spiegel.abweichung[angebote[i]!.id] ?? null;
                  return <td key={i} colSpan={2} className={`money ${k === 'netto' && r === 0 && reihe === 'rang' && angebote.length > 1 ? 'best' : ''}`}>
                    {k === 'summe' ? formatEuro(s.summe) : k === 'nachlass' ? `${s.nachlass_prozent.toLocaleString('de-DE')} %`
                      : k === 'netto' ? <strong>{formatEuro(s.summe_nach_nachlass)}</strong>
                      : <span style={{ color: pctTone(abw) }}>{abw == null ? '–' : `${abw > 0 ? '+' : ''}${abw.toLocaleString('de-DE')} %`}</span>}
                    {k === 'netto' && s.fehlende_positionen > 0 && <div className="sub" style={{ color: 'var(--orange)' }}>{s.fehlende_positionen} Pos. ohne Preis</div>}
                  </td>;
                })}
              </tr>
            ))}
            <tr><td /><td /><td /><td colSpan={2} />
              {order.map((i) => (
                <td key={i} colSpan={2} className="money">
                  {angebote[i]!.has_pdf && <button className="btn small" onClick={() => void openPdf(`/angebote/${angebote[i]!.id}/pdf`)}>PDF</button>}{' '}
                  {!vergeben && <button className="btn small plain" onClick={() => setErfassen({ company_id: angebote[i]!.company_id })}>Korrigieren</button>}{' '}
                  {info.role === 'bauleitung' && !vergeben && <button className="btn small filled" onClick={() => void run(() => api(`/lv/${lv.id}/vergeben`, { method: 'POST', body: { company_id: angebote[i]!.company_id } }), `Vergeben an ${angebote[i]!.company}`)}>Vergeben</button>}
                  {lv.vergeben_an === angebote[i]!.company_id && <span className="pill c-green">Vergeben</span>}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
        {!angebote.length && <div className="empty">Noch keine Angebote. Bieter antworten über ihren Link – Angebote per Mail oder Papier mit „Angebot erfassen“ eintragen.</div>}
      </div>
      <div className="footnote">Kalkulation = eigene Einheitspreise (sehen nur Einkauf und Leitung, nie die Bieter). ★ = günstigstes Angebot nach Nachlass. Grün = günstigster Preis je Position, rot = EP mehr als 20 % über der Kalkulation. Bemerkungen der Bieter: {angebote.filter((a) => a.bemerkung).map((a) => `${a.company}: „${a.bemerkung}“`).join(' · ') || 'keine'}.</div>
      {erfassen && <ErfassenSheet sp={sp} info={info} companyId={erfassen.company_id} onClose={() => setErfassen(null)} run={run} />}
    </>
  );
}

/** Enter an offer received by mail or on paper: unit prices per position (or paste an EP column from Excel), or only a total. */
function ErfassenSheet({ sp, info, companyId, onClose, run }: { sp: Spiegel; info: ProjectInfo; companyId?: string; onClose: () => void; run: Run }) {
  const { lv } = sp;
  const positionen = lv.positionen.filter((p) => p.art === 'position');
  const nus = info.companies.filter((c) => c.kind === 'nu');
  const vorher = (cid?: string) => { const i = sp.angebote.findIndex((a) => a.company_id === cid); return i < 0 ? null : { a: sp.angebote[i]!, preise: sp.preise[i]?.preise ?? {} }; };
  const [firma, setFirma] = useState(companyId ?? '');
  const [ep, setEp] = useState<Record<string, string>>(() => Object.fromEntries(positionen.map((p) => [p.id, epText(vorher(companyId)?.preise[p.id])])));
  const [nachlass, setNachlass] = useState(() => String(vorher(companyId)?.a.nachlass ?? '').replace('.', ','));
  const [summe, setSumme] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [paste, setPaste] = useState(false);
  const preise = Object.fromEntries(Object.entries(ep).map(([k, v]) => [k, parseNum(v)]).filter(([, v]) => v != null)) as Record<string, number>;
  const anzahl = Object.keys(preise).length;
  const gesamt = positionen.reduce((s, p) => s + (preise[p.id] ?? 0) * p.menge, 0);
  const ok = !!firma && (anzahl > 0 || parseNum(summe) != null);
  return (
    <Sheet title={companyId ? 'Angebot korrigieren' : 'Angebot erfassen'} primary="Erfassen" primaryDisabled={!ok} wide onCancel={onClose}
      onPrimary={() => void run(async () => {
        await api(`/lv/${lv.id}/angebote`, { method: 'POST', body: { company_id: firma, preise, nachlass_prozent: parseNum(nachlass) ?? 0, summe_netto: anzahl ? null : parseNum(summe), bemerkung: bemerkung || null } });
        onClose();
      }, 'Angebot erfasst')}>
      <div className="group">
        <div className="row"><span className="k">Bieter</span>
          <select value={firma} onChange={(e) => { setFirma(e.target.value); const v = vorher(e.target.value); if (v) { setEp(Object.fromEntries(positionen.map((p) => [p.id, epText(v.preise[p.id])]))); setNachlass(String(v.a.nachlass).replace('.', ',')); } }}>
            <option value="">bitte wählen</option>{nus.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="row"><span className="k">Nachlass %</span><input inputMode="decimal" value={nachlass} onChange={(e) => setNachlass(e.target.value)} placeholder="0" /></div>
        <div className="row"><span className="k">Bemerkung</span><input value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} placeholder="z. B. Angebot per Mail vom …, gültig bis …" /></div>
      </div>
      <div className="meta-row" style={{ margin: '12px 0 6px' }}>
        <div className="group-title" style={{ margin: 0 }}>Einheitspreise ({anzahl} von {positionen.length}) · Summe {formatEuro(Math.round(gesamt * 100) / 100)}</div>
        <span className="spacer" />
        <button className="btn small" onClick={() => setPaste(!paste)}>EP-Spalte aus Excel einfügen</button>
      </div>
      {paste && <textarea rows={5} style={{ width: '100%' }} placeholder={`Spalte mit ${positionen.length} Einheitspreisen kopieren und hier einfügen (eine Zeile je Position, in LV-Reihenfolge)`}
        onChange={(e) => {
          const z = e.target.value.split(/\r?\n/).map((x) => x.split('\t').pop() ?? '').filter((x, i, all) => x.trim() || i < all.length - 1);
          setEp(Object.fromEntries(positionen.map((p, i) => [p.id, z[i] != null && parseNum(z[i]!) != null ? epText(parseNum(z[i]!)!) : ep[p.id] ?? ''])));
        }} />}
      <div className="card">
        <table className="table lv-table">
          <thead><tr><th style={{ width: 100 }}>OZ</th><th>Kurztext</th><th className="money">Menge</th><th className="money" style={{ width: 120 }}>EP €</th><th className="money" style={{ width: 120 }}>GP</th></tr></thead>
          <tbody>
            {positionen.map((p) => (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <td className="num">{p.oz}</td><td>{p.kurztext}</td><td className="money">{num(p.menge)} {p.einheit}</td>
                <td className="money"><input className="lv-input num-in" inputMode="decimal" aria-label={`EP ${p.oz}`} value={ep[p.id] ?? ''} onChange={(e) => setEp({ ...ep, [p.id]: e.target.value })} /></td>
                <td className="money">{preise[p.id] != null ? formatEuro(Math.round(preise[p.id]! * p.menge * 100) / 100) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anzahl === 0 && <div className="group" style={{ marginTop: 12 }}><div className="row"><span className="k">Nur Angebotssumme netto €</span><input inputMode="decimal" value={summe} onChange={(e) => setSumme(e.target.value)} placeholder="wenn keine Einzelpreise vorliegen" /></div></div>}
      <div className="footnote">{lv.status === 'entwurf' ? 'Mit dem ersten erfassten Angebot wird das LV gesperrt (alle Angebote beziehen sich auf dieselben Positionen). ' : ''}Ein erneutes Erfassen ersetzt das bisherige Angebot dieser Firma im Preisspiegel; alle Stände bleiben gespeichert.</div>
    </Sheet>
  );
}

function PasteSheet({ onClose, onOk }: { onClose: () => void; onOk: (p: Pos[]) => void }) {
  const [text, setText] = useState('');
  const r = useMemo(() => parsePositionen(text), [text]);
  return (
    <Sheet title="Positionen einfügen" primary={`${r.positionen.length} übernehmen`} primaryDisabled={!r.positionen.length} wide onCancel={onClose}
      onPrimary={() => onOk(r.positionen.map((p) => ({ ...p, id: crypto.randomUUID(), einheit: p.einheit ?? null })))}>
      <div className="group"><div className="row stack"><textarea autoFocus rows={10} placeholder={'In Excel die Spalten OZ, Kurztext, Menge, Einheit markieren, kopieren und hier einfügen.\n01.0010\tZementestrich 50 mm\t1.250\tm2'} value={text} onChange={(e) => setText(e.target.value)} /></div></div>
      {r.fehler.length > 0 && <div className="warn-box">{r.fehler.slice(0, 5).join(' · ')}</div>}
      <div className="footnote">GAEB-Dateien (X83) kommen später dazu.</div>
    </Sheet>
  );
}

function AnfrageSheet({ lv, info, onClose, run }: { lv: Lv; info: ProjectInfo; onClose: () => void; run: Run }) {
  const nus = info.companies.filter((c) => c.kind === 'nu');
  const [sel, setSel] = useState<Set<string>>(new Set(lv.anfragen.length ? [] : nus.filter((c) => info.gewerkCompanies.some((g) => g.gewerk_id === lv.gewerk_id && g.company_id === c.id)).map((c) => c.id)));
  return (
    <Sheet title="An Nachunternehmer anfragen" primary={`An ${sel.size} senden`} primaryDisabled={!sel.size} onCancel={onClose}
      onPrimary={() => run(async () => { await api(`/lv/${lv.id}/anfragen`, { method: 'POST', body: { company_ids: [...sel] } }); onClose(); }, 'Anfragen versendet (Link und QR-Code per E-Mail)')}>
      <div className="group">
        {nus.map((c) => {
          const schon = lv.anfragen.some((a) => a.company_id === c.id && a.sent_at);
          return (
            <label key={c.id} className="row"><span className="k">{c.name}<div className="sub">{c.email ?? 'keine E-Mail – Link bitte selbst weitergeben'}{schon ? ' · bereits angefragt (erneut senden)' : ''}</div></span>
              <input type="checkbox" className="switch" checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(c.id); else n.delete(c.id); setSel(n); }} /></label>
          );
        })}
      </div>
      <div className="footnote">Jeder Bieter bekommt einen eigenen Link mit QR-Code (ohne Anmeldung, nur für dieses LV). Mit Portal-Zugang sieht er die Anfrage auch dort. Danach sind die Positionen gesperrt.</div>
    </Sheet>
  );
}

// --- Public offer page (no account) ------------------------------------------------------------

interface PublicLv { titel: string; beschreibung: string | null; angebotsfrist: string | null; project: string; company: string; own_company: string; offen: boolean; positionen: Pos[]; letztes: { abgegeben_at: string; abgegeben_von: string; nachlass: number } | null; preise: Record<string, number> }

export function AngebotPage({ token }: { token: string }) {
  const [d, setD] = useState<PublicLv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ep, setEp] = useState<Record<string, string>>({});
  const [name, setName] = useState(() => localStorage.getItem('bap.bieter') ?? '');
  const [nachlass, setNachlass] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [pdf, setPdf] = useState<File | null>(null);
  const [summe, setSumme] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/public/angebot/${token}`);
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setError(b.error ?? 'Dieser Link funktioniert nicht.');
    setD(b);
    setEp(Object.fromEntries(Object.entries(b.preise as Record<string, number>).map(([k, v]) => [k, String(v).replace('.', ',')])));
    if (b.letztes) setNachlass(String(b.letztes.nachlass || '').replace('.', ','));
  }, [token]);
  useEffect(() => void load(), [load]);
  const p = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
  const gp = (pos: Pos) => (ep[pos.id] && Number.isFinite(p(ep[pos.id]!)) ? p(ep[pos.id]!) * pos.menge : null);
  const nurPos = d ? d.positionen.filter((x) => x.art === 'position') : [];
  const summeNetto = nurPos.reduce((s, x) => s + (gp(x) ?? 0), 0);
  const filled = nurPos.filter((x) => gp(x) != null).length;
  const submit = async () => {
    setBusy(true);
    setError(null);
    localStorage.setItem('bap.bieter', name);
    const preise = Object.fromEntries(Object.entries(ep).filter(([, v]) => v.trim() && Number.isFinite(p(v))).map(([k, v]) => [k, p(v)]));
    const fd = new FormData();
    fd.set('name', name);
    fd.set('preise', JSON.stringify(preise));
    fd.set('nachlass_prozent', String(nachlass ? p(nachlass) : 0));
    if (bemerkung) fd.set('bemerkung', bemerkung);
    if (summe) fd.set('summe_netto', String(p(summe)));
    if (pdf) fd.set('file', pdf);
    const r = await fetch(`/api/public/angebot/${token}`, pdf ? { method: 'POST', body: fd, headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {} }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, preise, nachlass_prozent: nachlass ? p(nachlass) : 0, bemerkung: bemerkung || null }) });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(b.error ?? 'Senden fehlgeschlagen');
    setDone(true);
    void load();
  };
  if (error && !d) return <div className="fm"><div className="card pad">{error}</div></div>;
  if (!d) return <p className="loading">Wird geladen …</p>;
  return (
    <div className="fm" style={{ maxWidth: 900 }}>
      <div className="fm-head"><div className="app-icon">BA</div><div><div className="sub">{d.own_company} · {d.project}</div><h1>Anfrage: {d.titel}</h1>
        <div className="sub">für {d.company}{d.angebotsfrist ? ` · Angebot bis ${formatDate(d.angebotsfrist)}` : ''}</div></div></div>
      {d.letztes && <div className="notice">Angebot abgegeben am {formatDate(d.letztes.abgegeben_at)} von {d.letztes.abgegeben_von}. {d.offen ? 'Sie können es bis zur Vergabe ändern – das neue ersetzt das alte.' : ''}</div>}
      {!d.offen && <div className="notice">Für diese Anfrage werden keine Angebote mehr angenommen.</div>}
      {done && <div className="notice">Vielen Dank – Ihr Angebot ist eingegangen.</div>}
      <div className="card angebot-table">
        <table className="table">
          <thead><tr><th className="oz">OZ</th><th>Leistung</th><th className="money">Menge</th><th className="money">EP netto €</th><th className="money gp">GP</th></tr></thead>
          <tbody>
            {d.positionen.map((x) => x.art === 'titel' || x.art === 'untertitel' ? (
              <tr key={x.id} className={`lv-${x.art}`}><td className="num oz">{x.oz}</td><td colSpan={4}><strong>{x.kurztext}</strong><div className="sub oz-m">{x.oz}</div></td></tr>
            ) : x.art === 'text' ? (
              <tr key={x.id} className="lv-text"><td className="oz" /><td colSpan={4} className="sub">{x.kurztext}</td></tr>
            ) : (
              <tr key={x.id} style={{ cursor: 'default' }}>
                <td className="num oz">{x.oz}</td><td>{x.kurztext}{x.langtext && <div className="sub">{x.langtext}</div>}<div className="sub oz-m">{x.oz}</div></td><td className="money">{num(x.menge)} {x.einheit}</td>
                <td className="money"><input className="ep" inputMode="decimal" disabled={!d.offen} value={ep[x.id] ?? ''} onChange={(e) => setEp({ ...ep, [x.id]: e.target.value })} placeholder="0,00" /></td>
                <td className="money gp">{gp(x) != null ? formatEuro(gp(x)!) : '–'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="oz" /><td colSpan={2}><strong>Summe netto</strong> <span className="sub">({filled} von {nurPos.length} Positionen)</span></td><td colSpan={2} className="money"><strong>{formatEuro(summeNetto)}</strong></td></tr></tfoot>
        </table>
      </div>
      {d.offen && (
        <>
          <div className="group fm-me">
            <div className="row"><span className="k">Ihr Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vor- und Nachname" /></div>
            <div className="row"><span className="k">Nachlass %</span><input inputMode="decimal" value={nachlass} onChange={(e) => setNachlass(e.target.value)} placeholder="0" /></div>
            <div className="row stack"><textarea rows={2} placeholder="Bemerkung (optional)" value={bemerkung} onChange={(e) => setBemerkung(e.target.value)} /></div>
          </div>
          <details className="group" style={{ padding: '10px 16px' }}>
            <summary>Auf Papier ausfüllen oder Angebot als PDF hochladen</summary>
            <div className="sub" style={{ marginTop: 8 }}>
              <a href={`/api/public/angebot/${encodeURIComponent(token)}/pdf`} target="_blank" rel="noreferrer">LV als PDF zum Ausfüllen herunterladen</a> – ausgefüllt und unterschrieben einscannen und hier hochladen (mit Angebotssumme).
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
              {!filled && <input inputMode="decimal" placeholder="Angebotssumme netto €" value={summe} onChange={(e) => setSumme(e.target.value)} />}
            </div>
          </details>
          {error && <div className="toast error">{error}</div>}
          <button className="btn filled large" disabled={busy || name.trim().length < 2 || (!filled && !pdf)} onClick={() => void submit()}>{busy ? 'Wird gesendet …' : 'Angebot verbindlich abgeben'}</button>
          <div className="sub">Ihre Preise sieht nur der Auftraggeber, nie andere Bieter.</div>
        </>
      )}
    </div>
  );
}
