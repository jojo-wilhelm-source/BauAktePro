/**
 * Bautagebuch (docs/fachkonzept/07): one report per day, prefilled from the day before, signed with the finger
 * or mouse, then locked (additions only as Nachtrag). The Bauleitung countersigns. On site the Polier writes it
 * in the app, also offline; the web is for the office and for countersigning.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { formatDate, isPlausibleSignature, wochentag, type Signature } from '@bap/domain';
import { api, openPdf, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface ListItem { id: string; datum: string; bereich: string | null; status: 'entwurf' | 'unterschrieben'; signed_at: string | null; countersigned_at: string | null; personen: number; leistungen: number; signed_by_name: string | null; countersigned_by_name: string | null; nachtraege: number; wetter: Wetter }
interface Wetter { text?: string; temp_min?: number | null; temp_max?: number | null; niederschlag?: string; wind?: string }
interface Personal { firma: string; company_id?: string | null; anzahl: number; taetigkeit?: string }
interface Detail {
  id: string; project_id: string; datum: string; bereich: string | null; wetter: Wetter; personal: Personal[]; geraete: { name: string; anzahl: number }[];
  leistungen: { text: string; ort?: string; gewerk?: string }[]; lieferungen: string | null; behinderungen: string | null; besonderheiten: string | null;
  status: 'entwurf' | 'unterschrieben'; version: number; signed_by_name: string | null; signed_at: string | null; countersigned_by_name: string | null; countersigned_at: string | null;
  nachtraege: { id: string; text: string; created_at: string; name: string }[]; can_edit: boolean; can_countersign: boolean; created_by_name: string;
}
interface Vorschlag { bereich: string | null; personal: Personal[]; geraete: { name: string; anzahl: number }[]; firmen: { id: string; name: string }[]; maengelHeute: string[] }

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const dt = (s: string) => new Date(s).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function BautagebuchPage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [list, setList] = useState<ListItem[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Detail | null>(null);
  const [firmen, setFirmen] = useState<{ id: string; name: string }[]>([]);
  const [hint, setHint] = useState<string[]>([]);
  const [sign, setSign] = useState<'unterschreiben' | 'gegenzeichnen' | null>(null);
  const [nachtrag, setNachtrag] = useState(false);
  const [dirty, setDirty] = useState(false);
  const leitung = info.role === 'bauleitung';

  const reload = useCallback(async () => setList(await api<ListItem[]>(`/projects/${info.project.id}/tagesberichte`)), [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const open = useCallback(async (id: string) => {
    setSel(id);
    setDirty(false);
    setDraft(await api<Detail>(`/tagesberichte/${id}`));
  }, []);

  /** New day: prefilled from the last report (personnel, equipment, area). */
  const neu = async (datum: string) => {
    const existing = list.find((l) => l.datum === datum);
    if (existing) return open(existing.id);
    const v = await api<Vorschlag>(`/projects/${info.project.id}/tagesberichte/vorschlag?datum=${datum}`);
    setFirmen(v.firmen);
    setHint(v.maengelHeute);
    setSel(null);
    setDirty(true);
    setDraft({
      id: crypto.randomUUID(), project_id: info.project.id, datum, bereich: v.bereich, wetter: {}, personal: v.personal, geraete: v.geraete, leistungen: [{ text: '' }],
      lieferungen: null, behinderungen: null, besonderheiten: null, status: 'entwurf', version: 0, signed_by_name: null, signed_at: null, countersigned_by_name: null,
      countersigned_at: null, nachtraege: [], can_edit: true, can_countersign: false, created_by_name: '',
    });
  };
  useEffect(() => {
    if (draft && firmen.length === 0) void api<Vorschlag>(`/projects/${info.project.id}/tagesberichte/vorschlag?datum=${draft.datum}`).then((v) => setFirmen(v.firmen));
  }, [draft, firmen.length, info.project.id]);

  const set = (patch: Partial<Detail>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };
  const save = async () => {
    if (!draft) return;
    await run(async () => {
      const body = { ...draft, leistungen: draft.leistungen.filter((l) => l.text.trim()), personal: draft.personal.filter((p) => p.firma.trim()), geraete: draft.geraete.filter((g) => g.name.trim()), version: draft.version || undefined };
      await api('/tagesberichte', { method: 'PUT', body });
      await reload();
      await open(draft.id);
    }, 'Gespeichert');
  };
  const doSign = (s: Signature) => {
    if (!draft || !sign) return;
    const kind = sign;
    setSign(null);
    void run(async () => {
      if (dirty && kind === 'unterschreiben') await api('/tagesberichte', { method: 'PUT', body: { ...draft, leistungen: draft.leistungen.filter((l) => l.text.trim()), version: draft.version || undefined } });
      const cur = await api<Detail>(`/tagesberichte/${draft.id}`);
      await api(`/tagesberichte/${draft.id}/${kind}`, { method: 'POST', body: { signature: s, base_version: cur.version } });
      await reload();
      await open(draft.id);
    }, kind === 'unterschreiben' ? 'Unterschrieben – der Bericht ist jetzt gesperrt' : 'Gegengezeichnet');
  };

  const t = draft;
  const ro = !t?.can_edit;
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Bautagebuch"
        action={<button className="btn filled" onClick={() => void neu(today())}><Icon name="plus" size={16} /> Heute</button>}>
        <label className="field-inline">Anderer Tag <input type="date" max={today()} onChange={(e) => e.target.value && void neu(e.target.value)} /></label>
        {leitung && <span className="sub" style={{ fontSize: 13 }}>{list.filter((l) => l.status === 'unterschrieben' && !l.countersigned_at).length} zum Gegenzeichnen</span>}
      </PageHeader>
      <div className="split tb">
        <div>
          {t ? (
            <div className="tb-form">
              <div className="group-head">
                <h3>{wochentag(t.datum)}, {formatDate(t.datum)}</h3>
                <span className={`pill ${t.status === 'entwurf' ? 'c-orange' : t.countersigned_at ? 'c-green' : 'c-blue'}`}>
                  {t.status === 'entwurf' ? 'Entwurf' : t.countersigned_at ? 'Gegengezeichnet' : 'Unterschrieben'}
                </span>
              </div>
              <div className="group">
                <div className="row"><span className="k">Bereich</span><input disabled={ro} placeholder="z. B. Bauteil A, 1.–3. OG" value={t.bereich ?? ''} onChange={(e) => set({ bereich: e.target.value })} /></div>
                <div className="row"><span className="k">Wetter</span><input disabled={ro} placeholder="z. B. sonnig, bewölkt, Regen" value={t.wetter.text ?? ''} onChange={(e) => set({ wetter: { ...t.wetter, text: e.target.value } })} /></div>
                <div className="row"><span className="k">Temperatur °C</span>
                  <span className="tb-pair">
                    <input disabled={ro} inputMode="decimal" placeholder="min" value={t.wetter.temp_min ?? ''} onChange={(e) => set({ wetter: { ...t.wetter, temp_min: num(e.target.value) } })} />
                    <span>bis</span>
                    <input disabled={ro} inputMode="decimal" placeholder="max" value={t.wetter.temp_max ?? ''} onChange={(e) => set({ wetter: { ...t.wetter, temp_max: num(e.target.value) } })} />
                  </span>
                </div>
                <div className="row"><span className="k">Niederschlag</span><input disabled={ro} placeholder="keiner" value={t.wetter.niederschlag ?? ''} onChange={(e) => set({ wetter: { ...t.wetter, niederschlag: e.target.value } })} /></div>
                <div className="row"><span className="k">Wind</span><input disabled={ro} placeholder="schwach" value={t.wetter.wind ?? ''} onChange={(e) => set({ wetter: { ...t.wetter, wind: e.target.value } })} /></div>
              </div>

              <div className="group-title tb-title">Personal auf der Baustelle · {t.personal.reduce((s, p) => s + (Number(p.anzahl) || 0), 0)} Personen</div>
              <div className="group">
                {t.personal.map((p, i) => (
                  <div className="row" key={i}>
                    {ro ? <span className="k">{p.firma}{p.taetigkeit ? <div className="sub">{p.taetigkeit}</div> : null}</span> : (
                      <span className="k tb-grow">
                        <input list="tb-firmen" placeholder="Firma" value={p.firma} onChange={(e) => { const f = firmen.find((x) => x.name === e.target.value); set({ personal: t.personal.map((x, j) => (j === i ? { ...x, firma: e.target.value, company_id: f?.id ?? null } : x)) }); }} />
                        <input placeholder="Tätigkeit" value={p.taetigkeit ?? ''} onChange={(e) => set({ personal: t.personal.map((x, j) => (j === i ? { ...x, taetigkeit: e.target.value } : x)) })} />
                      </span>
                    )}
                    <span className="tb-pair">
                      <input disabled={ro} className="tb-n" type="number" min={0} value={p.anzahl} onChange={(e) => set({ personal: t.personal.map((x, j) => (j === i ? { ...x, anzahl: Number(e.target.value) } : x)) })} />
                      {!ro && <button className="btn plain small destructive" aria-label="Entfernen" onClick={() => set({ personal: t.personal.filter((_, j) => j !== i) })}>✕</button>}
                    </span>
                  </div>
                ))}
                {!ro && <button className="row action" onClick={() => set({ personal: [...t.personal, { firma: '', anzahl: 1 }] })}>+ Firma hinzufügen</button>}
                <datalist id="tb-firmen">{firmen.map((f) => <option key={f.id} value={f.name} />)}</datalist>
              </div>

              <div className="group-title tb-title">Geräte</div>
              <div className="group">
                {t.geraete.map((g, i) => (
                  <div className="row" key={i}>
                    <input disabled={ro} className="tb-left" placeholder="z. B. Turmdrehkran" value={g.name} onChange={(e) => set({ geraete: t.geraete.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <span className="tb-pair">
                      <input disabled={ro} className="tb-n" type="number" min={1} value={g.anzahl} onChange={(e) => set({ geraete: t.geraete.map((x, j) => (j === i ? { ...x, anzahl: Number(e.target.value) } : x)) })} />
                      {!ro && <button className="btn plain small destructive" aria-label="Entfernen" onClick={() => set({ geraete: t.geraete.filter((_, j) => j !== i) })}>✕</button>}
                    </span>
                  </div>
                ))}
                {t.geraete.length === 0 && ro && <div className="row"><span className="k sub">keine</span></div>}
                {!ro && <button className="row action" onClick={() => set({ geraete: [...t.geraete, { name: '', anzahl: 1 }] })}>+ Gerät hinzufügen</button>}
              </div>

              <div className="group-title tb-title">Ausgeführte Leistungen</div>
              <div className="group">
                {t.leistungen.map((l, i) => (
                  <div className="row" key={i}>
                    <input disabled={ro} className="tb-left" placeholder="z. B. Estrich 1. OG Nord eingebracht" value={l.text} onChange={(e) => set({ leistungen: t.leistungen.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                    {!ro && <button className="btn plain small destructive" aria-label="Entfernen" onClick={() => set({ leistungen: t.leistungen.filter((_, j) => j !== i) })}>✕</button>}
                  </div>
                ))}
                {!ro && <button className="row action" onClick={() => set({ leistungen: [...t.leistungen, { text: '' }] })}>+ Leistung hinzufügen</button>}
              </div>
              {hint.length > 0 && !ro && <div className="footnote">Heute erfasste Mängel: {hint.join(' · ')}</div>}

              {(['lieferungen', 'behinderungen', 'besonderheiten'] as const).map((k) => (
                <div key={k}>
                  <div className="group-title tb-title">{{ lieferungen: 'Lieferungen', behinderungen: 'Behinderungen', besonderheiten: 'Besonderheiten / Unfälle / Besuche' }[k]}</div>
                  <div className="group"><div className="row stack"><textarea disabled={ro} rows={2} placeholder={ro ? '–' : ''} value={t[k] ?? ''} onChange={(e) => set({ [k]: e.target.value })} /></div></div>
                </div>
              ))}
              {t.behinderungen && t.status === 'unterschrieben' && <div className="footnote">Behinderung vermerkt – die förmliche Behinderungsanzeige an den Bauherrn folgt als eigenes Schreiben.</div>}

              {t.nachtraege.length > 0 && (
                <>
                  <div className="group-title tb-title">Nachträge</div>
                  <div className="group">{t.nachtraege.map((n) => <div key={n.id} className="row"><span className="k">{n.text}<div className="sub">{n.name} · {dt(n.created_at)}</div></span></div>)}</div>
                </>
              )}

              <div className="tb-actions">
                {t.can_edit && <button className="btn" disabled={!dirty} onClick={() => void save()}>Entwurf speichern</button>}
                {t.can_edit && <button className="btn filled" onClick={() => setSign('unterschreiben')}><Icon name="stift" size={16} /> Unterschreiben</button>}
                {t.status === 'unterschrieben' && <button className="btn" onClick={() => setNachtrag(true)}><Icon name="plus" size={16} /> Nachtrag</button>}
                {t.can_countersign && <button className="btn filled" onClick={() => setSign('gegenzeichnen')}><Icon name="stift" size={16} /> Gegenzeichnen</button>}
                {sel && <button className="btn" onClick={() => void openPdf(`/tagesberichte/${t.id}/pdf`)}><Icon name="anzeige" size={16} /> PDF</button>}
              </div>
              {t.signed_at && <div className="footnote">Unterschrieben von {t.signed_by_name} am {dt(t.signed_at)}{t.countersigned_at ? ` · gegengezeichnet von ${t.countersigned_by_name} am ${dt(t.countersigned_at)}` : ''}. Gesperrt – Ergänzungen nur als Nachtrag.</div>}
            </div>
          ) : (
            <div className="card pad empty">Wählen Sie einen Tag oder legen Sie den Bericht für heute an – Personal, Geräte und Bereich werden vom letzten Bericht übernommen.</div>
          )}
        </div>
        <aside>
          <div className="group-title">Berichte</div>
          <div className="group tb-list">
            {list.map((l) => (
              <button key={l.id} className={`row action ${l.id === sel ? 'sel' : ''}`} style={{ color: 'var(--label)' }} onClick={() => void open(l.id)}>
                <span className="k">
                  <strong>{wochentag(l.datum).slice(0, 2)}, {formatDate(l.datum)}</strong>
                  <div className="sub">{l.personen} Pers. · {l.leistungen} Leistungen{l.wetter?.text ? ` · ${l.wetter.text}` : ''}{l.nachtraege ? ` · ${l.nachtraege} Nachtr.` : ''}</div>
                </span>
                <span className={`pill ${l.status === 'entwurf' ? 'c-orange' : l.countersigned_at ? 'c-green' : 'c-blue'}`}>{l.status === 'entwurf' ? 'Entwurf' : l.countersigned_at ? 'Gegengez.' : 'Unterschr.'}</span>
              </button>
            ))}
            {list.length === 0 && <div className="empty">Noch keine Berichte</div>}
          </div>
          <div className="footnote">Unterschriften dienen der Dokumentation; ob sie rechtsverbindlich sind, ist noch zu klären.</div>
        </aside>
      </div>
      {sign && <SignatureSheet title={sign === 'unterschreiben' ? 'Tagesbericht unterschreiben' : 'Gegenzeichnen'} onCancel={() => setSign(null)} onDone={doSign} />}
      {nachtrag && t && <NachtragSheet onCancel={() => setNachtrag(false)} onOk={(text) => { setNachtrag(false); void run(async () => { await api(`/tagesberichte/${t.id}/nachtrag`, { method: 'POST', body: { text } }); await open(t.id); await reload(); }, 'Nachtrag gespeichert'); }} />}
    </>
  );
}

function NachtragSheet({ onCancel, onOk }: { onCancel: () => void; onOk: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Sheet title="Nachtrag" primary="Speichern" primaryDisabled={text.trim().length < 3} onCancel={onCancel} onPrimary={() => onOk(text.trim())}>
      <div className="group"><div className="row stack"><textarea autoFocus rows={4} placeholder="Was wird ergänzt oder korrigiert?" value={text} onChange={(e) => setText(e.target.value)} /></div></div>
      <div className="footnote">Der unterschriebene Bericht bleibt unverändert; der Nachtrag wird mit Name und Zeit angehängt.</div>
    </Sheet>
  );
}

/** Signature pad: pointer strokes, stored normalised (0..1) so the PDF can redraw them at any size. */
export function SignatureSheet({ title, onCancel, onDone }: { title: string; onCancel: () => void; onDone: (s: Signature) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<[number, number][][]>([]);
  const [count, setCount] = useState(0);
  const W = 520;
  const H = 200;
  const draw = () => {
    const c = ref.current!.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = getComputedStyle(ref.current!).color;
    for (const s of strokes.current) {
      c.beginPath();
      s.forEach(([x, y], i) => (i ? c.lineTo(x * W, y * H) : c.moveTo(x * W, y * H)));
      c.stroke();
    }
  };
  const pos = (e: RPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const sig = (): Signature => ({ w: W, h: H, strokes: strokes.current.filter((s) => s.length >= 2).slice(0, 60).map((s) => s.slice(0, 2000)) });
  const ok = count > 0 && strokes.current.some((s) => s.length >= 2) && isPlausibleSignature(sig());
  return (
    <Sheet title={title} primary="Fertig" primaryDisabled={!ok} onCancel={onCancel} onPrimary={() => onDone(sig())}>
      <canvas ref={ref} width={W} height={H} className="sig-pad"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); strokes.current.push([pos(e)]); }}
        onPointerMove={(e) => { if (e.buttons === 0 && e.pointerType === 'mouse') return; const s = strokes.current.at(-1); if (s && e.currentTarget.hasPointerCapture(e.pointerId)) { s.push(pos(e)); draw(); } }}
        onPointerUp={() => setCount((n) => n + 1)} />
      <div className="tb-sig-foot">
        <span className="footnote" style={{ padding: 0 }}>Mit Finger, Stift oder Maus unterschreiben. Danach ist der Bericht gesperrt.</span>
        <button className="btn plain small" onClick={() => { strokes.current = []; setCount(0); draw(); }}>Löschen</button>
      </div>
    </Sheet>
  );
}
