/**
 * Bautagebuch (docs/fachkonzept/07): one report per day, prefilled from the day before, signed with the finger
 * or mouse, then locked (additions only as Nachtrag). The Bauleitung countersigns. On site the Polier writes it
 * in the app, also offline; the web is for the office and for countersigning.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { formatDate, isPlausibleSignature, TB_ABSCHNITT_LABELS, TB_ABSCHNITTE, wochentag, type Signature, type TbAbschnitt } from '@bap/domain';
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
  can_release?: boolean; can_bauherr_sign?: boolean; bauherr_freigabe?: boolean; bauherr_abschnitte?: TbAbschnitt[]; bauherr_signed_at?: string | null;
}
interface Vorlage { id: string; name: string; project_id: string | null; inhalt: Partial<Detail> }
interface Vorschlag { vorlagen: Vorlage[]; bereich: string | null; personal: Personal[]; geraete: { name: string; anzahl: number }[]; firmen: { id: string; name: string }[]; maengelHeute: string[] }

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const dt = (s: string) => new Date(s).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function BautagebuchPage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [list, setList] = useState<ListItem[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Detail | null>(null);
  const [firmen, setFirmen] = useState<{ id: string; name: string }[]>([]);
  const [hint, setHint] = useState<string[]>([]);
  const [sign, setSign] = useState<'unterschreiben' | 'gegenzeichnen' | 'bauherr' | null>(null);
  const [nachtrag, setNachtrag] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [vorlagen, setVorlagen] = useState<Vorlage[]>([]);
  const [vorlageSheet, setVorlageSheet] = useState(false);
  const [freigabe, setFreigabe] = useState(false);
  const leitung = info.role === 'bauleitung';
  const bauherr = info.role === 'bauherr';

  const reload = useCallback(async () => setList(await api<ListItem[]>(`/projects/${info.project.id}/tagesberichte`)), [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const open = useCallback(async (id: string) => {
    setSel(id);
    setDirty(false);
    setDraft(await api<Detail>(`/tagesberichte/${id}`));
  }, []);

  /** New day: prefilled from the last report (personnel, equipment, area). */
  const neu = async (datum: string, vorlage?: Vorlage) => {
    const existing = list.find((l) => l.datum === datum);
    if (existing) return open(existing.id);
    const v = await api<Vorschlag>(`/projects/${info.project.id}/tagesberichte/vorschlag?datum=${datum}`);
    setVorlagen(v.vorlagen);
    setFirmen(v.firmen);
    setHint(v.maengelHeute);
    setSel(null);
    setDirty(true);
    setDraft({
      id: crypto.randomUUID(), project_id: info.project.id, datum, bereich: v.bereich, wetter: {}, personal: v.personal, geraete: v.geraete, leistungen: [{ text: '' }],
      lieferungen: null, behinderungen: null, besonderheiten: null, status: 'entwurf', version: 0, signed_by_name: null, signed_at: null, countersigned_by_name: null,
      countersigned_at: null, nachtraege: [], can_edit: true, can_countersign: false, created_by_name: '',
      // A template fills in what it contains (on top of the Vortag-Übernahme).
      ...(vorlage?.inhalt ?? {}),
    });
  };
  useEffect(() => {
    if (!bauherr && firmen.length === 0) void api<Vorschlag>(`/projects/${info.project.id}/tagesberichte/vorschlag?datum=${today()}`).then((v) => { setFirmen(v.firmen); setVorlagen(v.vorlagen); });
  }, [bauherr, firmen.length, info.project.id]);

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
    if (kind === 'bauherr') {
      void run(async () => { await api(`/tagesberichte/${draft.id}/bauherr-gegenzeichnen`, { method: 'POST', body: { signature: s } }); await reload(); await open(draft.id); }, 'Gegengezeichnet');
      return;
    }
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
        action={!bauherr && <button className="btn filled" onClick={() => void neu(today())}><Icon name="plus" size={16} /> Heute</button>}>
        {!bauherr && <label className="field-inline">Anderer Tag <input type="date" max={today()} onChange={(e) => e.target.value && void neu(e.target.value)} /></label>}
        {!bauherr && vorlagen.length > 0 && (
          <select className="popup" value="" onChange={(e) => { const v = vorlagen.find((x) => x.id === e.target.value); if (v) void neu(today(), v); }}>
            <option value="">Heute aus Vorlage …</option>
            {vorlagen.map((v) => <option key={v.id} value={v.id}>{v.name}{v.project_id ? '' : ' (Firma)'}</option>)}
          </select>
        )}
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
                {!bauherr && <button className="btn plain" onClick={() => setVorlageSheet(true)}>Als Vorlage speichern</button>}
                {t.can_release && <button className="btn" onClick={() => setFreigabe(true)}>{t.bauherr_freigabe ? 'Bauherr-Freigabe ändern' : 'Für Bauherrn freigeben'}</button>}
                {bauherr && t.can_bauherr_sign && <button className="btn filled" onClick={() => setSign('bauherr')}><Icon name="stift" size={16} /> Gegenzeichnen</button>}
              </div>
              {t.bauherr_freigabe && <div className="footnote">Für den Bauherrn freigegeben: {(t.bauherr_abschnitte ?? []).map((a) => TB_ABSCHNITT_LABELS[a]).join(', ')}{t.bauherr_signed_at ? ` · vom Bauherrn gegengezeichnet am ${dt(t.bauherr_signed_at)}` : ''}</div>}
              {sel && <div className="footnote">Das PDF liegt automatisch unter Dokumente › Bautagebuch › Jahr › KW (neue Version bei Gegenzeichnung oder Nachtrag).</div>}
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
      {vorlageSheet && t && <VorlageSheet projectId={info.project.id} leitung={leitung} t={t} onClose={() => setVorlageSheet(false)}
        run={async (fn, ok) => { await run(fn, ok); const v = await api<Vorschlag>(`/projects/${info.project.id}/tagesberichte/vorschlag?datum=${today()}`); setVorlagen(v.vorlagen); }} />}
      {freigabe && t && <FreigabeSheet t={t} onClose={() => setFreigabe(false)} run={async (fn, ok) => { await run(fn, ok); await reload(); await open(t.id); }} />}
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

function VorlageSheet({ projectId, leitung, t, onClose, run }: { projectId: string; leitung: boolean; t: Detail; onClose: () => void; run: Run }) {
  const [name, setName] = useState('');
  const [firma, setFirma] = useState(false);
  const [teile, setTeile] = useState({ bereich: true, personal: true, geraete: true, leistungen: false, wetter: false });
  return (
    <Sheet title="Als Vorlage speichern" primary="Sichern" primaryDisabled={name.trim().length < 2} onCancel={onClose}
      onPrimary={() => run(async () => {
        const inhalt: Record<string, unknown> = {};
        if (teile.bereich) inhalt.bereich = t.bereich;
        if (teile.personal) inhalt.personal = t.personal;
        if (teile.geraete) inhalt.geraete = t.geraete;
        if (teile.leistungen) inhalt.leistungen = t.leistungen.filter((l) => l.text.trim());
        if (teile.wetter) inhalt.wetter = t.wetter;
        await api('/tagesbericht-vorlagen', { method: 'PUT', body: { id: crypto.randomUUID(), name: name.trim(), project_id: firma ? null : projectId, inhalt } });
        onClose();
      }, 'Vorlage gespeichert')}>
      <div className="group">
        <div className="row"><span className="k">Name</span><input autoFocus placeholder="z. B. Standard Rohbau" value={name} onChange={(e) => setName(e.target.value)} /></div>
        {leitung && <label className="row"><span className="k">Für die ganze Firma</span><input type="checkbox" className="switch" checked={firma} onChange={(e) => setFirma(e.target.checked)} /></label>}
      </div>
      <div className="group-title" style={{ marginTop: 16 }}>Übernehmen</div>
      <div className="group">
        {(Object.keys(teile) as (keyof typeof teile)[]).map((k) => (
          <label key={k} className="row"><span className="k">{{ bereich: 'Bereich', personal: 'Personal', geraete: 'Geräte', leistungen: 'Leistungen', wetter: 'Wetter' }[k]}</span>
            <input type="checkbox" className="switch" checked={teile[k]} onChange={(e) => setTeile({ ...teile, [k]: e.target.checked })} /></label>
        ))}
      </div>
      <div className="footnote">Vorlagen erscheinen beim Anlegen unter „Heute aus Vorlage …“ – im Web und in der App.</div>
    </Sheet>
  );
}

function FreigabeSheet({ t, onClose, run }: { t: Detail; onClose: () => void; run: Run }) {
  const [ab, setAb] = useState<Set<TbAbschnitt>>(new Set(t.bauherr_abschnitte ?? ['wetter', 'leistungen']));
  const send = (freigabe: boolean) => run(async () => {
    await api(`/tagesberichte/${t.id}/bauherr-freigabe`, { method: 'POST', body: { freigabe, abschnitte: [...ab] } });
    onClose();
  }, freigabe ? 'Für den Bauherrn freigegeben' : 'Freigabe zurückgenommen');
  return (
    <Sheet title="Für den Bauherrn freigeben" primary="Freigeben" primaryDisabled={ab.size === 0} onCancel={onClose} onPrimary={() => void send(true)}>
      <div className="group-title">Diese Abschnitte sieht der Bauherr</div>
      <div className="group">
        {TB_ABSCHNITTE.map((a) => (
          <label key={a} className="row"><span className="k">{TB_ABSCHNITT_LABELS[a]}</span>
            <input type="checkbox" className="switch" checked={ab.has(a)} onChange={(e) => { const n = new Set(ab); if (e.target.checked) n.add(a); else n.delete(a); setAb(n); }} /></label>
        ))}
      </div>
      {t.bauherr_freigabe && !t.bauherr_signed_at && <button className="btn plain destructive" style={{ marginTop: 12 }} onClick={() => void send(false)}>Freigabe zurücknehmen</button>}
      <div className="footnote">Der Bauherr sieht den Bericht im Portal nur mit den gewählten Abschnitten und kann ihn gegenzeichnen.</div>
    </Sheet>
  );
}
