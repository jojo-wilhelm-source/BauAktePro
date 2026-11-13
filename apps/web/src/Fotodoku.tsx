/**
 * Fotodokumentation on plans (docs/fachkonzept/16, decided 12.11.2026): photos before walls, shafts, raised floors or
 * ceilings are closed – placed on the plan, with category and room. 360° photos (Insta360 export) open in a panorama
 * viewer. A photo can become a Mangel at the same spot.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FOTODOKU_KATEGORIEN, FOTODOKU_LABEL as STANDARD_LABEL, PANO_JS, PRIORITIES, formatDate, type Einstellungen, type FotodokuKategorie } from '@bap/domain';
import { api, getToken, type ProjectInfo } from './api';
import { PlanView } from './PlanView';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

/** Category names from the company settings (administration); falls back to the defaults. */
let FOTODOKU_LABEL: Record<FotodokuKategorie, string> = { ...STANDARD_LABEL };
let AKTIV: FotodokuKategorie[] = [...FOTODOKU_KATEGORIEN];
let geladen: Promise<void> | null = null;
function useKategorien() {
  const [, setV] = useState(0);
  useEffect(() => {
    geladen ??= api<Einstellungen>('/einstellungen').then((e) => {
      FOTODOKU_LABEL = Object.fromEntries(FOTODOKU_KATEGORIEN.map((k) => [k, e.fotodoku.kategorien[k]?.label ?? STANDARD_LABEL[k]])) as Record<FotodokuKategorie, string>;
      AKTIV = FOTODOKU_KATEGORIEN.filter((k) => e.fotodoku.kategorien[k]?.aktiv !== false);
    }).catch(() => {});
    void geladen.then(() => setV((v) => v + 1));
  }, []);
}

export interface DokuFoto {
  id: string; project_id: string; plan_id: string | null; pin_page: number | null; pin_x: number | null; pin_y: number | null;
  location_id: string | null; ort: string | null; gewerk_id: string | null; kategorie: FotodokuKategorie; titel: string | null; notiz: string | null;
  ist_360: boolean; hochgeladen: boolean; width: number | null; height: number | null; taken_at: string; mangel_id: string | null; mangel_number: number | null;
  version: number; created_by: string; von: string; created_at: string;
}

/** Image from the API with the auth header (no token in URLs); preview size for lists. */
function useBild(id: string | null, vorschau: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let u: string | null = null;
    let cancel = false;
    void fetch(`/api/fotodoku/${id}/datei${vorschau ? '?vorschau=1' : ''}`, { headers: { authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b && !cancel) setUrl((u = URL.createObjectURL(b))); });
    return () => { cancel = true; if (u) URL.revokeObjectURL(u); };
  }, [id, vorschau]);
  return url;
}

function Kachel({ f, onOpen }: { f: DokuFoto; onOpen: () => void }) {
  const url = useBild(f.hochgeladen ? f.id : null, true);
  return (
    <button className="doku-kachel" onClick={onOpen} title={f.titel ?? FOTODOKU_LABEL[f.kategorie]}>
      {url ? <img src={url} alt="" loading="lazy" /> : <span className="sub">{f.hochgeladen ? '…' : 'wird hochgeladen'}</span>}
      {f.ist_360 && <span className="doku-360">360°</span>}
      <span className="doku-cap">{f.titel || FOTODOKU_LABEL[f.kategorie]}<small>{f.ort ? `${f.ort} · ` : ''}{formatDate(f.taken_at)}</small></span>
    </button>
  );
}

/** Panorama viewer (shared WebGL code from @bap/domain, also used in the app). */
export function Pano360({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    let stop: (() => void) | null = null;
    img.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      if (ref.current) stop = new Function('canvas', 'img', PANO_JS)(ref.current, img) as () => void;
    };
    img.src = url;
    return () => stop?.();
  }, [url]);
  return <canvas ref={ref} className="pano" />;
}

export function FotodokuPage({ info, run, onOpenMangel }: { info: ProjectInfo; run: Run; onOpenMangel: (id: string) => void }) {
  useKategorien();
  const plaene = info.plans.filter((p) => p.released);
  const [planId, setPlanId] = useState<string>(plaene[0]?.id ?? '');
  const [kat, setKat] = useState<FotodokuKategorie | ''>('');
  const [rows, setRows] = useState<DokuFoto[]>([]);
  const [setzen, setSetzen] = useState(false);
  const [neu, setNeu] = useState<{ x: number; y: number } | null | 'ohne'>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const load = useCallback(async () => setRows(await api<DokuFoto[]>(`/projects/${info.project.id}/fotodoku${kat ? `?kategorie=${kat}` : ''}`)), [info.project.id, kat]);
  useEffect(() => void load(), [load]);
  const runAndLoad: Run = async (fn, ok) => { await run(fn, ok); await load(); };
  const plan = plaene.find((p) => p.id === planId);
  const aufPlan = rows.filter((f) => f.plan_id === planId && f.pin_x != null && f.pin_y != null);
  const f = rows.find((x) => x.id === offen) ?? null;
  const zahl = useMemo(() => Object.fromEntries(FOTODOKU_KATEGORIEN.map((k) => [k, rows.filter((r) => r.kategorie === k).length])), [rows]);
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Fotodokumentation"
        action={<div className="meta-row">
          <button className="btn" onClick={() => setNeu('ohne')}>Fotos ohne Planposition …</button>
          <button className={`btn ${setzen ? 'filled' : ''}`} disabled={!plan} onClick={() => setSetzen(!setzen)}>{setzen ? 'Auf den Plan tippen …' : 'Foto auf Plan setzen'}</button>
        </div>}>
        <div className="meta-row">
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan">{plaene.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.plan_index})</option>)}</select>
          <select value={kat} onChange={(e) => setKat(e.target.value as FotodokuKategorie | '')} aria-label="Kategorie">
            <option value="">Alle Kategorien ({rows.length})</option>
            {FOTODOKU_KATEGORIEN.map((k) => <option key={k} value={k}>{FOTODOKU_LABEL[k]}{kat ? '' : ` (${zahl[k]})`}</option>)}
          </select>
        </div>
      </PageHeader>
      <div className="list-pad doku-split">
        <div className="card doku-plan">
          {plan ? (
            <PlanView planId={plan.id} planIndex={plan.plan_index} maengel={[]} selectedId={offen} onSelect={() => {}}
              draft={neu && neu !== 'ohne' ? { page: 1, ...neu } : null}
              onPick={setzen ? (pos) => { setNeu({ x: pos.x, y: pos.y }); setSetzen(false); } : undefined}
              extraPins={aufPlan.map((p) => ({ id: p.id, x: p.pin_x!, y: p.pin_y!, label: p.ist_360 ? '360' : '📷', title: p.titel ?? FOTODOKU_LABEL[p.kategorie], className: p.ist_360 ? 'doku pano-pin' : 'doku', onClick: () => setOffen(p.id) }))} />
          ) : <div className="empty">Noch kein freigegebener Plan – Fotos lassen sich trotzdem „ohne Planposition“ ablegen.</div>}
        </div>
        <div className="doku-galerie">
          <div className="group-title" style={{ marginTop: 0 }}>{plan ? `Auf diesem Plan (${aufPlan.length})` : 'Fotos'}</div>
          <div className="doku-grid">{(plan ? aufPlan : rows).map((x) => <Kachel key={x.id} f={x} onOpen={() => setOffen(x.id)} />)}</div>
          {plan && rows.length > aufPlan.length && (
            <>
              <div className="group-title">Weitere ({rows.length - aufPlan.length}, andere Pläne oder ohne Position)</div>
              <div className="doku-grid">{rows.filter((x) => !aufPlan.includes(x)).map((x) => <Kachel key={x.id} f={x} onOpen={() => setOffen(x.id)} />)}</div>
            </>
          )}
          {!rows.length && <div className="empty">Noch keine Fotos. „Foto auf Plan setzen“, auf die Stelle tippen und Fotos wählen – auch 360°-Fotos aus der Insta360-App.</div>}
        </div>
      </div>
      {neu && <HochladenSheet info={info} planId={neu === 'ohne' ? null : planId} pos={neu === 'ohne' ? null : neu} run={runAndLoad} onClose={() => setNeu(null)} />}
      {f && <FotoSheet f={f} info={info} run={runAndLoad} onClose={() => setOffen(null)} onOpenMangel={onOpenMangel} />}
    </>
  );
}

/** Upload one or more photos to a spot on the plan (or without a position). */
function HochladenSheet({ info, planId, pos, run, onClose }: { info: ProjectInfo; planId: string | null; pos: { x: number; y: number } | null; run: Run; onClose: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [kat, setKat] = useState<FotodokuKategorie>('geschlossene_wand');
  const [titel, setTitel] = useState('');
  const [notiz, setNotiz] = useState('');
  const [ort, setOrt] = useState('');
  const [fortschritt, setFortschritt] = useState<string | null>(null);
  return (
    <Sheet title={pos ? 'Fotos an dieser Stelle' : 'Fotos ohne Planposition'} primary={fortschritt ?? `${files.length || ''} Hochladen`} primaryDisabled={!files.length || !!fortschritt} onCancel={onClose}
      onPrimary={() => void run(async () => {
        let i = 0;
        for (const file of files) {
          setFortschritt(`${++i} von ${files.length} …`);
          const id = crypto.randomUUID();
          await api('/fotodoku', { method: 'POST', body: { id, project_id: info.project.id, plan_id: planId, pin_page: pos ? 1 : null, pin_x: pos?.x ?? null, pin_y: pos?.y ?? null,
            kategorie: kat, titel: titel.trim() || null, notiz: notiz.trim() || null, location_id: ort || null, taken_at: new Date(file.lastModified || Date.now()).toISOString() } });
          const fd = new FormData();
          fd.append('file', file);
          const r = await fetch(`/api/fotodoku/${id}/datei`, { method: 'POST', body: fd, headers: { authorization: `Bearer ${getToken()}` } });
          if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Hochladen fehlgeschlagen');
        }
        onClose();
      }, files.length > 1 ? `${files.length} Fotos abgelegt` : 'Foto abgelegt')}>
      <div className="group">
        <label className="row"><span className="k">Fotos</span><input type="file" accept="image/jpeg,image/png" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} /></label>
        <div className="row"><span className="k">Kategorie</span><select value={kat} onChange={(e) => setKat(e.target.value as FotodokuKategorie)}>{AKTIV.map((k) => <option key={k} value={k}>{FOTODOKU_LABEL[k]}</option>)}</select></div>
        <div className="row"><span className="k">Titel</span><input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="z. B. Bad Vorwand vor Beplankung" /></div>
        <div className="row"><span className="k">Ort</span><select value={ort} onChange={(e) => setOrt(e.target.value)}><option value="">{pos ? 'aus der Planposition' : '–'}</option>{info.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="row stack"><textarea rows={2} placeholder="Notiz (z. B. Leitungsführung, Abstände, Besonderheiten)" value={notiz} onChange={(e) => setNotiz(e.target.value)} /></div>
      </div>
      <div className="footnote">360°-Fotos: in der Insta360-App als 360°-Foto exportieren (JPG, Seitenverhältnis 2:1) – sie werden automatisch erkannt und als Rundumansicht gezeigt.</div>
    </Sheet>
  );
}

function FotoSheet({ f, info, run, onClose, onOpenMangel }: { f: DokuFoto; info: ProjectInfo; run: Run; onClose: () => void; onOpenMangel: (id: string) => void }) {
  const url = useBild(f.hochgeladen ? f.id : null, false);
  const [edit, setEdit] = useState(false);
  const [mangel, setMangel] = useState(false);
  const [d, setD] = useState({ kategorie: f.kategorie, titel: f.titel ?? '', notiz: f.notiz ?? '', ist_360: f.ist_360 });
  const [m, setM] = useState({ description: f.titel ?? '', gewerk_id: info.gewerke[0]?.id ?? '', due_date: '', priority: 'normal' as (typeof PRIORITIES)[number] });
  if (mangel) {
    return (
      <Sheet title="Mangel aus Foto" primary="Mangel anlegen" primaryDisabled={!m.description.trim() || !m.gewerk_id} onCancel={() => setMangel(false)}
        onPrimary={() => void run(async () => {
          const r = await api<{ mangel_id: string }>(`/fotodoku/${f.id}/mangel`, { method: 'POST', body: { ...m, description: m.description.trim(), due_date: m.due_date || null } });
          onClose(); onOpenMangel(r.mangel_id);
        }, 'Mangel angelegt – mit Foto und Planposition')}>
        <div className="group">
          <div className="row stack"><textarea autoFocus rows={3} placeholder="Beschreibung des Mangels" value={m.description} onChange={(e) => setM({ ...m, description: e.target.value })} /></div>
          <div className="row"><span className="k">Gewerk</span><select value={m.gewerk_id} onChange={(e) => setM({ ...m, gewerk_id: e.target.value })}>{info.gewerke.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div className="row"><span className="k">Frist</span><input type="date" value={m.due_date} onChange={(e) => setM({ ...m, due_date: e.target.value })} /></div>
          <div className="row"><span className="k">Priorität</span><select value={m.priority} onChange={(e) => setM({ ...m, priority: e.target.value as typeof m.priority })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
        </div>
        <div className="footnote">Der Mangel bekommt dieselbe Planposition und den Ort ({f.ort ?? 'bitte im Mangel ergänzen'}); das Foto wird angehängt.</div>
      </Sheet>
    );
  }
  return (
    <Sheet title={f.titel || FOTODOKU_LABEL[f.kategorie]} primary={edit ? 'Sichern' : 'Fertig'} wide onCancel={onClose}
      onPrimary={() => (edit ? void run(async () => { await api(`/fotodoku/${f.id}`, { method: 'PATCH', body: { ...d, titel: d.titel.trim() || null, notiz: d.notiz.trim() || null, base_version: f.version } }); setEdit(false); }, 'Gesichert') : onClose())}>
      <div className="doku-bild">
        {!url ? <p className="loading">{f.hochgeladen ? 'Foto wird geladen …' : 'Das Foto wird noch vom Gerät hochgeladen.'}</p>
          : f.ist_360 ? <Pano360 url={url} /> : <img src={url} alt={f.titel ?? ''} />}
      </div>
      {f.ist_360 && url && <div className="footnote">360°-Ansicht: ziehen zum Umsehen, Mausrad oder zwei Finger zum Zoomen.</div>}
      {edit ? (
        <div className="group" style={{ marginTop: 12 }}>
          <div className="row"><span className="k">Kategorie</span><select value={d.kategorie} onChange={(e) => setD({ ...d, kategorie: e.target.value as FotodokuKategorie })}>{FOTODOKU_KATEGORIEN.map((k) => <option key={k} value={k}>{FOTODOKU_LABEL[k]}</option>)}</select></div>
          <div className="row"><span className="k">Titel</span><input value={d.titel} onChange={(e) => setD({ ...d, titel: e.target.value })} /></div>
          <label className="row"><span className="k">360°-Foto</span><input type="checkbox" className="switch" checked={d.ist_360} onChange={(e) => setD({ ...d, ist_360: e.target.checked })} /></label>
          <div className="row stack"><textarea rows={3} value={d.notiz} onChange={(e) => setD({ ...d, notiz: e.target.value })} placeholder="Notiz" /></div>
        </div>
      ) : (
        <div className="group" style={{ marginTop: 12 }}>
          <div className="row"><span className="k">Kategorie</span><span>{FOTODOKU_LABEL[f.kategorie]}{f.ist_360 ? ' · 360°' : ''}</span></div>
          <div className="row"><span className="k">Ort</span><span>{f.ort ?? '–'}</span></div>
          <div className="row"><span className="k">Aufgenommen</span><span>{new Date(f.taken_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} · {f.von}</span></div>
          {f.notiz && <div className="row stack"><span className="sub" style={{ whiteSpace: 'pre-line' }}>{f.notiz}</span></div>}
          {f.mangel_id && <div className="row"><span className="k">Mangel</span><button className="btn small plain" onClick={() => { onClose(); onOpenMangel(f.mangel_id!); }}>M-{String(f.mangel_number ?? '').padStart(3, '0')} öffnen ›</button></div>}
        </div>
      )}
      {!edit && (
        <div className="meta-row" style={{ marginTop: 12 }}>
          {!f.mangel_id && <button className="btn filled" onClick={() => setMangel(true)}><Icon name="mangel" size={16} /> Mangel daraus machen</button>}
          <button className="btn" onClick={() => setEdit(true)}>Bearbeiten</button>
          {url && <a className="btn plain" href={url} download={`foto-${f.id}.jpg`}>Original laden</a>}
          <span className="spacer" />
          <button className="btn destructive" onClick={() => void run(async () => { await api(`/fotodoku/${f.id}`, { method: 'DELETE' }); onClose(); }, 'In den Papierkorb gelegt')}>Entfernen</button>
        </div>
      )}
    </Sheet>
  );
}
