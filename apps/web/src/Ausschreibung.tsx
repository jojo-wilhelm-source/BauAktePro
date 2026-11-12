/**
 * Einkauf (docs/fachkonzept/12): Leistungsverzeichnis anlegen (auch per Einfügen aus Excel), an Nachunternehmer
 * anfragen (Link/QR per Mail), Preisspiegel nebeneinander, Vergabe. Plus the public offer page (no account) and the
 * NU portal list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, formatEuro, parsePositionen } from '@bap/domain';
import { api, getToken, openPdf, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface Pos { id: string; oz: string; kurztext: string; langtext?: string | null; menge: number; einheit: string }
interface LvListItem { id: string; nummer: number; titel: string; angebotsfrist: string | null; status: 'entwurf' | 'angefragt' | 'vergeben'; gewerk: string | null; positionen: number; angefragt: number; angebote: number; vergeben_an_name: string | null; link?: string; abgegeben_at?: string | null }
interface Lv { id: string; project_id: string; nummer: number; titel: string; beschreibung: string | null; angebotsfrist: string | null; gewerk_id: string | null; status: LvListItem['status']; vergeben_an: string | null; positionen: Pos[]; anfragen: { id: string; company_id: string; company: string; email: string | null; sent_at: string | null; abgegeben_at: string | null }[] }
interface Spiegel {
  lv: Lv;
  angebote: { id: string; company_id: string; company: string; nachlass: number; summe: number | null; bemerkung: string | null; has_pdf: boolean; abgegeben_von: string; abgegeben_at: string }[];
  preise: { id: string; preise: Record<string, number> }[];
  spiegel: { zeilen: { position_id: string; gp: (number | null)[]; guenstigster: string[] }[]; summen: { angebot_id: string; summe: number; nachlass_prozent: number; summe_nach_nachlass: number; fehlende_positionen: number }[]; rang: string[]; guenstigstes: string | null };
}
const STATUS: Record<LvListItem['status'], [string, string]> = { entwurf: ['Entwurf', 'c-orange'], angefragt: ['Angefragt', 'c-blue'], vergeben: ['Vergeben', 'c-green'] };
const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });

export function AusschreibungPage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [list, setList] = useState<LvListItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => setList(await api<LvListItem[]>(`/projects/${info.project.id}/lv`)), [info.project.id]);
  useEffect(() => void load(), [load]);
  const nu = info.role === 'nu';
  const neu = () => void run(async () => {
    const id = crypto.randomUUID();
    await api('/lv', { method: 'PUT', body: { id, project_id: info.project.id, titel: 'Neues Leistungsverzeichnis', positionen: [] } });
    await load();
    setOpen(id);
  }, 'Leistungsverzeichnis angelegt');

  if (open) return <LvDetail id={open} info={info} run={run} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <>
      <PageHeader eyebrow={info.project.name} title={nu ? 'Anfragen' : 'Leistungsverzeichnisse & Angebote'}
        action={!nu && <button className="btn filled" onClick={neu}><Icon name="plus" size={16} /> Leistungsverzeichnis</button>} />
      <div className="list-pad" style={{ maxWidth: 1100 }}>
        <div className="group">
          {list.map((l) => (
            nu ? (
              <div key={l.id} className="row">
                <span className="k">{l.titel}<div className="sub">{l.angebotsfrist ? `Angebot bis ${formatDate(l.angebotsfrist)}` : 'ohne Frist'}{l.abgegeben_at ? ` · abgegeben ${formatDate(l.abgegeben_at)}` : ''}</div></span>
                {l.status === 'angefragt' ? <a className="btn small filled" href={l.link} target="_blank" rel="noreferrer">{l.abgegeben_at ? 'Angebot ändern' : 'Angebot abgeben'}</a> : <span className={`pill ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span>}
              </div>
            ) : (
              <button key={l.id} className="row action" style={{ color: 'var(--label)' }} onClick={() => setOpen(l.id)}>
                <span className="k">LV {l.nummer} · {l.titel}
                  <div className="sub">{l.gewerk ?? 'ohne Gewerk'} · {l.positionen} Positionen · {l.angefragt} angefragt · {l.angebote} Angebote{l.angebotsfrist ? ` · Frist ${formatDate(l.angebotsfrist)}` : ''}{l.vergeben_an_name ? ` · vergeben an ${l.vergeben_an_name}` : ''}</div>
                </span>
                <span className={`pill ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span>
              </button>
            )
          ))}
          {list.length === 0 && <div className="empty">{nu ? 'Keine Anfragen' : 'Noch kein Leistungsverzeichnis'}</div>}
        </div>
        <div className="footnote">{nu ? 'Preise anderer Bieter sind nie sichtbar.' : 'Bieter antworten über einen Link (ohne Konto) oder im Portal – mit Einheitspreisen oder als PDF. Vergeben darf die Bau- oder Projektleitung.'}</div>
      </div>
    </>
  );
}

function LvDetail({ id, info, run, onBack }: { id: string; info: ProjectInfo; run: Run; onBack: () => void }) {
  const [lv, setLv] = useState<Lv | null>(null);
  const [tab, setTab] = useState<'lv' | 'spiegel'>('lv');
  const [paste, setPaste] = useState(false);
  const [anfragen, setAnfragen] = useState(false);
  const [sp, setSp] = useState<Spiegel | null>(null);
  const load = useCallback(async () => {
    const l = await api<Lv>(`/lv/${id}`);
    setLv(l);
    if (l.status !== 'entwurf') setSp(await api<Spiegel>(`/lv/${id}/preisspiegel`));
  }, [id]);
  useEffect(() => void load(), [load]);
  if (!lv) return <p className="loading">Wird geladen …</p>;
  const draft = lv.status === 'entwurf';
  const save = (patch: Partial<Lv>, ok = 'Gespeichert') => run(async () => {
    const n = { ...lv, ...patch };
    await api('/lv', { method: 'PUT', body: { id: n.id, project_id: n.project_id, titel: n.titel, beschreibung: n.beschreibung, gewerk_id: n.gewerk_id, angebotsfrist: n.angebotsfrist,
      ...(draft ? { positionen: n.positionen.map((p) => ({ ...p, langtext: p.langtext ?? null })) } : {}) } });
    await load();
  }, ok);
  const summeMenge = lv.positionen.length;
  return (
    <>
      <PageHeader eyebrow={`${info.project.name} · LV ${lv.nummer}`} title={lv.titel}
        action={<div className="meta-row">
          <button className="btn" onClick={onBack}>Alle LVs</button>
          {lv.status !== 'vergeben' && <button className="btn filled" disabled={!summeMenge} onClick={() => setAnfragen(true)}>An Nachunternehmer anfragen …</button>}
        </div>}>
        <div className="segmented">
          <button className={tab === 'lv' ? 'on' : ''} onClick={() => setTab('lv')}>Positionen</button>
          <button className={tab === 'spiegel' ? 'on' : ''} disabled={draft} onClick={() => setTab('spiegel')}>Preisspiegel{sp ? ` (${sp.angebote.length})` : ''}</button>
        </div>
        <span className={`pill ${STATUS[lv.status][1]}`}>{STATUS[lv.status][0]}</span>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1400, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {tab === 'lv' ? (
          <>
            <div className="group">
              <div className="row"><span className="k">Titel</span><input defaultValue={lv.titel} onBlur={(e) => e.target.value.trim() !== lv.titel && void save({ titel: e.target.value.trim() })} /></div>
              <div className="row"><span className="k">Gewerk</span><select value={lv.gewerk_id ?? ''} onChange={(e) => void save({ gewerk_id: e.target.value || null })}><option value="">–</option>{info.gewerke.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
              <div className="row"><span className="k">Angebotsfrist</span><input type="date" value={lv.angebotsfrist ?? ''} onChange={(e) => void save({ angebotsfrist: e.target.value || null })} /></div>
            </div>
            <div className="card">
              <table className="table">
                <thead><tr><th style={{ width: 110 }}>OZ</th><th>Kurztext</th><th className="money" style={{ width: 120 }}>Menge</th><th style={{ width: 80 }}>Einheit</th>{draft && <th style={{ width: 40 }} />}</tr></thead>
                <tbody>
                  {lv.positionen.map((p, i) => (
                    <tr key={p.id} style={{ cursor: 'default' }}>
                      <td className="num">{p.oz}</td><td>{p.kurztext}{p.langtext && <div className="sub">{p.langtext}</div>}</td>
                      <td className="money">{num(p.menge)}</td><td>{p.einheit}</td>
                      {draft && <td><button className="btn small plain destructive" aria-label="Entfernen" onClick={() => void save({ positionen: lv.positionen.filter((_, j) => j !== i) }, 'Position entfernt')}>✕</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {lv.positionen.length === 0 && <div className="empty">Noch keine Positionen – „Positionen einfügen“ übernimmt sie direkt aus Excel.</div>}
              {draft && <div className="add-row" onClick={() => setPaste(true)}>+ Positionen einfügen (aus Excel: OZ, Kurztext, Menge, Einheit)</div>}
            </div>
            {!draft && <div className="footnote">Nach dem Versand sind die Positionen gesperrt – alle Bieter rechnen dasselbe LV.</div>}
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
      {paste && <PasteSheet onClose={() => setPaste(false)} onOk={(neu) => { setPaste(false); void save({ positionen: [...lv.positionen, ...neu] }, `${neu.length} Positionen übernommen`); }} />}
      {anfragen && <AnfrageSheet lv={lv} info={info} onClose={() => setAnfragen(false)} run={async (fn, ok) => { await run(fn, ok); await load(); }} />}
    </>
  );
}

function PreisspiegelView({ sp, info, run }: { sp: Spiegel; info: ProjectInfo; run: Run }) {
  const { lv, angebote, preise, spiegel } = sp;
  const order = spiegel.rang.map((id) => angebote.findIndex((a) => a.id === id));
  const ep = (aIdx: number, pid: string) => preise[aIdx]?.preise[pid];
  if (!angebote.length) return <div className="card pad empty">Noch keine Angebote eingegangen.</div>;
  return (
    <>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table spiegel">
          <thead>
            <tr><th style={{ width: 90 }}>OZ</th><th>Leistung</th><th className="money">Menge</th>
              {order.map((i, r) => <th key={angebote[i]!.id} className="money" colSpan={2}>{r === 0 && '★ '}{angebote[i]!.company}<div className="sub">{formatDate(angebote[i]!.abgegeben_at)}</div></th>)}</tr>
            <tr><th /><th /><th />{order.map((i) => [<th key={`e${i}`} className="money sub">EP</th>, <th key={`g${i}`} className="money sub">GP</th>])}</tr>
          </thead>
          <tbody>
            {lv.positionen.map((p, pi) => {
              const z = spiegel.zeilen[pi]!;
              return (
                <tr key={p.id} style={{ cursor: 'default' }}>
                  <td className="num">{p.oz}</td><td>{p.kurztext}</td><td className="money">{num(p.menge)} {p.einheit}</td>
                  {order.map((i) => {
                    const best = z.guenstigster.includes(angebote[i]!.id);
                    const e = ep(i, p.id);
                    return [<td key={`e${i}`} className="money sub">{e != null ? formatEuro(e) : '–'}</td>,
                      <td key={`g${i}`} className={`money ${best ? 'best' : ''}`}>{z.gp[i] != null ? formatEuro(z.gp[i]!) : '–'}</td>];
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(['summe', 'nachlass', 'netto'] as const).map((k) => (
              <tr key={k}><td /><td><strong>{{ summe: 'Summe netto', nachlass: 'Nachlass', netto: 'Angebotssumme nach Nachlass' }[k]}</strong></td><td />
                {order.map((i, r) => {
                  const s = spiegel.summen.find((x) => x.angebot_id === angebote[i]!.id)!;
                  return <td key={i} colSpan={2} className={`money ${k === 'netto' && r === 0 ? 'best' : ''}`}>
                    {k === 'summe' ? formatEuro(s.summe) : k === 'nachlass' ? `${s.nachlass_prozent.toLocaleString('de-DE')} %` : <strong>{formatEuro(s.summe_nach_nachlass)}</strong>}
                    {k === 'netto' && s.fehlende_positionen > 0 && <div className="sub" style={{ color: 'var(--orange)' }}>{s.fehlende_positionen} Pos. ohne Preis</div>}
                  </td>;
                })}
              </tr>
            ))}
            <tr><td /><td /><td />
              {order.map((i) => (
                <td key={i} colSpan={2} className="money">
                  {angebote[i]!.has_pdf && <button className="btn small" onClick={() => void openPdf(`/angebote/${angebote[i]!.id}/pdf`)}>PDF</button>}{' '}
                  {info.role === 'bauleitung' && lv.status !== 'vergeben' && <button className="btn small filled" onClick={() => void run(() => api(`/lv/${lv.id}/vergeben`, { method: 'POST', body: { company_id: angebote[i]!.company_id } }), `Vergeben an ${angebote[i]!.company}`)}>Vergeben</button>}
                  {lv.vergeben_an === angebote[i]!.company_id && <span className="pill c-green">Vergeben</span>}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="footnote">★ = günstigstes Angebot nach Nachlass. Grün = günstigster Preis je Position. Bemerkungen der Bieter: {angebote.filter((a) => a.bemerkung).map((a) => `${a.company}: „${a.bemerkung}“`).join(' · ') || 'keine'}.</div>
    </>
  );
}

function PasteSheet({ onClose, onOk }: { onClose: () => void; onOk: (p: Pos[]) => void }) {
  const [text, setText] = useState('');
  const r = useMemo(() => parsePositionen(text), [text]);
  return (
    <Sheet title="Positionen einfügen" primary={`${r.positionen.length} übernehmen`} primaryDisabled={!r.positionen.length} wide onCancel={onClose}
      onPrimary={() => onOk(r.positionen.map((p) => ({ ...p, id: crypto.randomUUID() })))}>
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
  const summeNetto = d ? d.positionen.reduce((s, x) => s + (gp(x) ?? 0), 0) : 0;
  const filled = d ? d.positionen.filter((x) => gp(x) != null).length : 0;
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
            {d.positionen.map((x) => (
              <tr key={x.id} style={{ cursor: 'default' }}>
                <td className="num oz">{x.oz}</td><td>{x.kurztext}{x.langtext && <div className="sub">{x.langtext}</div>}<div className="sub oz-m">{x.oz}</div></td><td className="money">{num(x.menge)} {x.einheit}</td>
                <td className="money"><input className="ep" inputMode="decimal" disabled={!d.offen} value={ep[x.id] ?? ''} onChange={(e) => setEp({ ...ep, [x.id]: e.target.value })} placeholder="0,00" /></td>
                <td className="money gp">{gp(x) != null ? formatEuro(gp(x)!) : '–'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="oz" /><td colSpan={2}><strong>Summe netto</strong> <span className="sub">({filled} von {d.positionen.length} Positionen)</span></td><td colSpan={2} className="money"><strong>{formatEuro(summeNetto)}</strong></td></tr></tfoot>
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
            <summary>Notfall: Angebot als PDF hochladen</summary>
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
