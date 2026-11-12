/**
 * Projekt & Struktur (docs/fachkonzept/01, 02): new project (optionally from an earlier one), take over the
 * structure of another project later, edit Orte and Gewerke, see the team. Bau-/Projektleitung only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, roleLabel, type ProjectRole } from '@bap/domain';
import { api, type Me, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

type Teil = 'orte' | 'gewerke' | 'ordner' | 'nachunternehmer' | 'team';
const TEILE: [Teil, string, string][] = [
  ['orte', 'Orte', 'Gebäude, Geschosse, Abschnitte, Räume'],
  ['gewerke', 'Gewerke', 'z. B. Elektro, Fliesen'],
  ['ordner', 'Ordnerstruktur', 'Ordner der Dateiablage mit Sichtbarkeit, ohne Dateien'],
  ['nachunternehmer', 'Nachunternehmer', 'Firmen mit ihren Gewerken, ohne Verträge, Preise und Zugänge'],
  ['team', 'Eigenes Team', 'Polier, Einkauf … mit denselben Rollen'],
];
const KIND_LABEL: Record<string, string> = { gebaeude: 'Gebäude', geschoss: 'Geschoss', abschnitt: 'Abschnitt', raum: 'Raum' };
const KINDS = ['gebaeude', 'geschoss', 'abschnitt', 'raum'] as const;

interface Loc { id: string; parent_id: string | null; kind: string; name: string; sort: number; maengel: number; plaene: number }
interface Struktur {
  project: { id: string; name: string; address: string | null; created_at: string };
  locations: Loc[];
  gewerke: { id: string; name: string; maengel: number; firmen: string[] }[];
  team: { id: string; name: string; email: string; role: ProjectRole; company: string; company_kind: string }[];
}

function TeileRows({ teile, setTeile }: { teile: Teil[]; setTeile: (t: Teil[]) => void }) {
  return (
    <div className="group">
      {TEILE.map(([k, label, hint]) => (
        <label key={k} className="row" style={{ cursor: 'pointer' }}>
          <span className="k">
            {label}
            <div className="sub">{hint}</div>
          </span>
          <input type="checkbox" checked={teile.includes(k)} onChange={(e) => setTeile(e.target.checked ? [...teile, k] : teile.filter((x) => x !== k))} />
        </label>
      ))}
    </div>
  );
}

/** New project; the structure of an earlier project can be taken over and changed afterwards. */
export function NewProjectSheet({ me, current, onCancel, onCreated, run }: { me: Me; current: string; onCancel: () => void; onCreated: (id: string) => void; run: Run }) {
  const leitung = me.projects.filter((p) => p.role !== 'nu' && p.role !== 'bauherr');
  const [f, setF] = useState({ name: '', address: '', vorlage: leitung.some((p) => p.id === current) ? current : (leitung[0]?.id ?? '') });
  const [teile, setTeile] = useState<Teil[]>(['orte', 'gewerke', 'ordner', 'nachunternehmer', 'team']);
  return (
    <Sheet title="Neues Projekt" primary="Anlegen" primaryDisabled={!f.name.trim()} onCancel={onCancel}
      onPrimary={() =>
        run(async () => {
          const id = crypto.randomUUID();
          await api('/projects', { method: 'POST', body: { id, name: f.name, address: f.address || null, vorlage_id: f.vorlage || null, teile: f.vorlage ? teile : [] } });
          onCreated(id);
        }, `Projekt „${f.name}“ angelegt`)
      }>
      <div className="group">
        <div className="row"><span className="k">Name</span><input autoFocus placeholder="z. B. Wohnanlage Lindenhof BA 2" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="row"><span className="k">Adresse</span><input placeholder="optional" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div className="row">
          <span className="k">Struktur übernehmen von</span>
          <select value={f.vorlage} onChange={(e) => setF({ ...f, vorlage: e.target.value })}>
            <option value="">– leer beginnen –</option>
            {leitung.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      {f.vorlage && (
        <div>
          <div className="group-title">Übernehmen</div>
          <TeileRows teile={teile} setTeile={setTeile} />
          <div className="footnote">Nicht übernommen werden Mängel, Pläne, Dokumente, Verträge und Preise. Danach lässt sich alles unter „Projekt &amp; Struktur“ ändern.</div>
        </div>
      )}
      <div className="footnote">Du wirst Bauleitung des neuen Projekts. Zugänge für Nachunternehmer und Bauherr kommen separat dazu.</div>
    </Sheet>
  );
}

export function StrukturPage({ info, me, run, onReload, onMeReload }: { info: ProjectInfo; me: Me; run: Run; onReload: () => void; onMeReload: () => void }) {
  const [s, setS] = useState<Struktur | null>(null);
  const [adding, setAdding] = useState<{ parent: Loc | null } | null>(null);
  const [rename, setRename] = useState<{ kind: 'location' | 'gewerk' | 'project'; id: string; name: string; address?: string } | null>(null);
  const [takeOver, setTakeOver] = useState(false);
  const [gw, setGw] = useState('');
  const [zu, setZu] = useState<Set<string>>(new Set());
  const load = useCallback(async () => setS(await api<Struktur>(`/projects/${info.project.id}/struktur`)), [info.project.id]);
  useEffect(() => void load(), [load]);
  const runAndLoad: Run = async (fn, ok) => {
    await run(fn, ok);
    await load();
    onReload();
  };
  const children = useMemo(() => {
    const m = new Map<string | null, Loc[]>();
    for (const l of s?.locations ?? []) m.set(l.parent_id, [...(m.get(l.parent_id) ?? []), l]);
    return m;
  }, [s]);
  if (!s) return <p className="loading">Struktur wird geladen …</p>;

  const tree = (parent: string | null, depth: number): React.ReactNode[] =>
    (children.get(parent) ?? []).flatMap((l) => {
      const kids = children.get(l.id) ?? [];
      const open = !zu.has(l.id);
      const used = l.maengel + l.plaene;
      return [
        <div key={l.id} className="row tree-row" style={{ paddingLeft: 16 + depth * 22 }}>
          <span className="k">
            <button className={`disclosure ${open ? 'open' : ''}`} style={{ visibility: kids.length ? 'visible' : 'hidden' }} aria-label={open ? 'Zuklappen' : 'Aufklappen'}
              onClick={() => setZu((p) => { const n = new Set(p); open ? n.add(l.id) : n.delete(l.id); return n; })}>
              <Icon name="chevron" size={12} />
            </button>
            <span className="kind">{KIND_LABEL[l.kind]}</span> {l.name}
            {used > 0 && <span className="sub"> · {l.maengel ? `${l.maengel} Mängel` : ''}{l.maengel && l.plaene ? ', ' : ''}{l.plaene ? `${l.plaene} Pläne` : ''}</span>}
          </span>
          <span className="actions">
            {l.kind !== 'raum' && <button className="btn small" onClick={() => setAdding({ parent: l })}>+ Unterort</button>}
            <button className="btn small" onClick={() => setRename({ kind: 'location', id: l.id, name: l.name })}>Umbenennen</button>
            <button className="btn small destructive" disabled={used > 0 || kids.length > 0} title={used || kids.length ? 'Wird noch verwendet' : 'Löschen'}
              onClick={() => runAndLoad(() => api(`/locations/${l.id}`, { method: 'DELETE' }), `„${l.name}“ gelöscht`)}>Löschen</button>
          </span>
        </div>,
        ...(open ? tree(l.id, depth + 1) : []),
      ];
    });

  return (
    <>
      <PageHeader eyebrow={`angelegt ${formatDate(s.project.created_at)}`} title="Projekt & Struktur"
        action={<div className="meta-row">
          <button className="btn" onClick={() => setRename({ kind: 'project', id: s.project.id, name: s.project.name, address: s.project.address ?? '' })}><Icon name="stift" size={16} /> Projekt umbenennen</button>
          <button className="btn filled" onClick={() => setTakeOver(true)}>Struktur übernehmen …</button>
        </div>} />
      <div className="list-pad struktur">
        <div>
          <div className="group-head"><h3>Orte</h3><span className="sub">{s.locations.length} Einträge</span></div>
          <div className="group">
            {tree(null, 0)}
            {s.locations.length === 0 && <div className="empty">Noch keine Orte</div>}
            <button className="row action" onClick={() => setAdding({ parent: null })}>Gebäude oder Geschoss hinzufügen <Icon name="plus" size={16} /></button>
          </div>
          <div className="footnote">Orte, an denen Mängel oder Pläne hängen, lassen sich umbenennen, aber nicht löschen.</div>
        </div>
        <div>
          <div className="group-head"><h3>Gewerke</h3><span className="sub">{s.gewerke.length}</span></div>
          <div className="group">
            {s.gewerke.map((g) => (
              <div key={g.id} className="row">
                <span className="k">{g.name}<div className="sub">{g.firmen.join(', ') || 'noch keine Firma'}{g.maengel ? ` · ${g.maengel} Mängel` : ''}</div></span>
                <span className="actions">
                  <button className="btn small" onClick={() => setRename({ kind: 'gewerk', id: g.id, name: g.name })}>Umbenennen</button>
                  <button className="btn small destructive" disabled={g.maengel > 0} title={g.maengel ? 'Wird noch verwendet' : 'Löschen'}
                    onClick={() => runAndLoad(() => api(`/gewerke/${g.id}`, { method: 'DELETE' }), `Gewerk „${g.name}“ gelöscht`)}>Löschen</button>
                </span>
              </div>
            ))}
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (gw.trim()) void runAndLoad(async () => { await api('/gewerke', { method: 'POST', body: { id: crypto.randomUUID(), project_id: info.project.id, name: gw } }); setGw(''); }, `Gewerk „${gw}“ angelegt`); }}>
              <input style={{ textAlign: 'left', maxWidth: 'none', flex: 1, color: 'var(--label)' }} placeholder="Neues Gewerk, z. B. Trockenbau" value={gw} onChange={(e) => setGw(e.target.value)} />
              <button className="btn small" disabled={!gw.trim()}>Hinzufügen</button>
            </form>
          </div>
          <div className="group-head" style={{ marginTop: 24 }}><h3>Team</h3><span className="sub">{s.team.length} Zugänge</span></div>
          <div className="group">
            {s.team.map((t) => (
              <div key={t.id} className="row"><span className="k">{t.name}<div className="sub">{t.company}</div></span><span className="v">{roleLabel(t.role)}</span></div>
            ))}
          </div>
          <div className="footnote">Nachunternehmer verwaltest du unter „Nachunternehmer“ (auch aus anderen Projekten übernehmen).</div>
        </div>
      </div>

      {adding && (
        <AddLocationSheet parent={adding.parent} onCancel={() => setAdding(null)}
          onSave={(kind, name) => runAndLoad(async () => {
            await api('/locations', { method: 'POST', body: { id: crypto.randomUUID(), project_id: info.project.id, parent_id: adding.parent?.id ?? null, kind, name } });
            setAdding(null);
          }, `${KIND_LABEL[kind]} „${name}“ angelegt`)} />
      )}
      {rename && (
        <Sheet title={rename.kind === 'project' ? 'Projekt' : 'Umbenennen'} primary="Sichern" primaryDisabled={!rename.name.trim()} onCancel={() => setRename(null)}
          onPrimary={() => runAndLoad(async () => {
            if (rename.kind === 'project') {
              await api(`/projects/${rename.id}`, { method: 'PATCH', body: { name: rename.name, address: rename.address || null } });
              onMeReload();
            } else await api(`/${rename.kind === 'location' ? 'locations' : 'gewerke'}/${rename.id}`, { method: 'PATCH', body: { name: rename.name } });
            setRename(null);
          }, 'Gespeichert')}>
          <div className="group">
            <div className="row"><span className="k">Name</span><input autoFocus value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} /></div>
            {rename.kind === 'project' && <div className="row"><span className="k">Adresse</span><input value={rename.address ?? ''} onChange={(e) => setRename({ ...rename, address: e.target.value })} /></div>}
          </div>
        </Sheet>
      )}
      {takeOver && <TakeOverSheet info={info} me={me} onCancel={() => setTakeOver(false)} run={runAndLoad} />}
    </>
  );
}

function AddLocationSheet({ parent, onCancel, onSave }: { parent: Loc | null; onCancel: () => void; onSave: (kind: string, name: string) => void }) {
  const allowed = parent ? KINDS.slice(KINDS.indexOf(parent.kind as (typeof KINDS)[number]) + 1) : KINDS.slice(0, 2);
  const [kind, setKind] = useState<string>(allowed[0]!);
  const [name, setName] = useState('');
  return (
    <Sheet title={parent ? `Unterort in „${parent.name}“` : 'Neuer Ort'} primary="Anlegen" primaryDisabled={!name.trim()} onCancel={onCancel} onPrimary={() => onSave(kind, name.trim())}>
      <div className="segmented">
        {allowed.map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
      </div>
      <div className="group">
        <div className="row"><span className="k">Name</span><input autoFocus placeholder={kind === 'raum' ? 'z. B. Bad 1.03' : kind === 'geschoss' ? 'z. B. OG 2' : 'z. B. Haus B'} value={name} onChange={(e) => setName(e.target.value)} /></div>
      </div>
    </Sheet>
  );
}

/** Merge the structure of another project into this one (no duplicates; existing entries stay). */
function TakeOverSheet({ info, me, onCancel, run }: { info: ProjectInfo; me: Me; onCancel: () => void; run: Run }) {
  const others = me.projects.filter((p) => p.id !== info.project.id);
  const [from, setFrom] = useState(others[0]?.id ?? '');
  const [teile, setTeile] = useState<Teil[]>(['orte', 'gewerke', 'ordner']);
  return (
    <Sheet title="Struktur übernehmen" primary="Übernehmen" primaryDisabled={!from || !teile.length} onCancel={onCancel}
      onPrimary={() => run(async () => {
        const r = await api<Record<Teil, number>>(`/projects/${info.project.id}/struktur-uebernehmen`, { method: 'POST', body: { from, teile } });
        onCancel();
        const parts = TEILE.filter(([k]) => r[k]).map(([k, l]) => `${r[k]} ${l}`);
        if (!parts.length) throw new Error('Nichts Neues: alles war schon vorhanden');
      }, 'Struktur übernommen')}>
      <div className="group">
        <div className="row">
          <span className="k">Aus Projekt</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <TeileRows teile={teile} setTeile={setTeile} />
      <div className="footnote">Was es hier schon gibt (gleicher Name an gleicher Stelle), bleibt unverändert; nur Fehlendes kommt dazu.</div>
    </Sheet>
  );
}
