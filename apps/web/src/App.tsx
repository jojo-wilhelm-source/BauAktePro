import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PUNKT_STATUS_LABELS as PUNKT_LABELS_WEB, PUNKT_TONE as PUNKT_TONE_WEB, anzeigeNo, canBePosition, formatDate, MANGEL_STATUS_LABELS, PRIORITIES, roomAt, ROLE_LABELS, MANGEL_GRUPPE_LABELS, MANGEL_SORT_LABELS, ordnerBaum, sortMaengel, type MangelGruppe, type MangelKey, type MangelOrdner, type MangelSort, type MangelStatus, type Priority } from '@bap/domain';
import { api, ApiError, ensureFreshToken, getToken, openPdf, signOut, type Conflict, type Mangel, type Me, type ProjectInfo, type Punkt } from './api';
import { AnzeigenPage, type AnzeigeStart } from './Anzeigen';
import { BesprechungenPage } from './Besprechungen';
import { DokumentePage } from './Dokumente';
import { EinreichungenPage } from './Einreichungen';
import { StundenPage } from './Stunden';
import { NachunternehmerPage } from './Nachunternehmer';
import { EinkaeufePage, FahrtenbuchPage } from './Betrieb';
import { KostenPage } from './Kosten';
import { AcceptInvitationPage, LoginPage, ResetPasswordPage } from './Anmeldung';
import { ZugaengePage } from './Zugaenge';
import { NewProjectSheet, StrukturPage } from './Struktur';
import { CheckPage, Planregister } from './Planregister';
import type { PunktPin } from './PlanView';
import { PlanView } from './PlanView';
import { Icon, type IconName } from './ui/Icon';
import { AmpelPill, initials, mNo, StatusPill } from './ui/status';
import { Foto } from './ui/Foto';
import { PageHeader, type Run } from './ui/layout';


const PRIORITY_LABELS: Record<Priority, string> = { kritisch: 'Kritisch', normal: 'Normal', gering: 'Gering' };

type Module = 'struktur' | 'zugaenge' | 'maengel' | 'anzeigen' | 'plaene' | 'besprechungen' | 'dokumente' | 'stunden' | 'einreichungen' | 'nachunternehmer' | 'einkaeufe' | 'fahrtenbuch' | 'kosten' | 'hinweise';


type Toast = { kind: 'ok' | 'error'; text: string } | null;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const setProjectId = (id: string | null) => {
    if (id) localStorage.setItem('bap.project', id);
    setProjectIdState(id);
  };
  const [checked, setChecked] = useState(false);

  const loadMe = useCallback(async () => {
    await ensureFreshToken();
    if (!getToken()) {
      setMe(null);
      return setChecked(true);
    }
    try {
      const m = await api<Me>('/me');
      setMe(m);
      const last = localStorage.getItem('bap.project');
      setProjectIdState((p) => p ?? m.projects.find((x) => x.id === last)?.id ?? m.projects[0]?.id ?? null);
    } catch {
      setMe(null);
    }
    setChecked(true);
  }, []);
  useEffect(() => void loadMe(), [loadMe]);
  // Keep the session alive in the background (access token 12 h, renewed via the refresh token).
  useEffect(() => {
    const t = setInterval(() => void ensureFreshToken().then((ok) => !ok && setMe(null)), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  if (!checked) return null;
  // Public pages: invitation link and password reset (work without being signed in).
  const invite = window.location.pathname.match(/^\/einladung\/([A-Za-z0-9_-]{20,})$/);
  if (invite) return <AcceptInvitationPage token={invite[1]!} onLogin={() => void loadMe()} />;
  if (window.location.pathname === '/passwort-neu') {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    return <ResetPasswordPage token={token} onDone={() => { window.history.replaceState(null, '', '/'); void loadMe(); }} />;
  }
  if (!me) return <LoginPage onLogin={loadMe} />;
  // QR code on a printed plan → /check/<revision id> (docs/fachkonzept/03). Login first, then the check.
  const check = window.location.pathname.match(/^\/check\/([0-9a-f-]{36})$/);
  if (check) return <CheckPage revisionId={check[1]!} />;
  const logout = () => {
    void signOut();
    setMe(null);
    setProjectId(null);
  };
  return projectId ? (
    <ProjectShell key={`${projectId}-${me.user.id}`} me={me} projectId={projectId} onProject={setProjectId} onLogout={logout} onMeReload={() => void loadMe()} />
  ) : (
    <p className="loading">Kein Projekt zugeordnet.</p>
  );
}

function ProjectShell({ me, projectId, onProject, onLogout, onMeReload }: { me: Me; projectId: string; onProject: (id: string) => void; onLogout: () => void; onMeReload: () => void }) {
  const [newProject, setNewProject] = useState(false);
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [maengel, setMaengel] = useState<Mangel[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [module, setModule] = useState<Module>('maengel');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: number; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [anzeigeStart, setAnzeigeStart] = useState<AnzeigeStart | null>(null);
  const [besprechungId, setBesprechungId] = useState<string | null>(null);
  // Placing a pin for a Besprechungspunkt: the plan opens in pick mode, then we return to the meeting.
  const [pinFor, setPinFor] = useState<{ punkt: Punkt; besprechungId: string } | null>(null);
  const [planFocus, setPlanFocus] = useState<{ meeting: number | null; punktId: string | null }>({ meeting: null, punktId: null });
  const [planVersion, setPlanVersion] = useState(0);
  const startAnzeige = (s: AnzeigeStart) => {
    setAnzeigeStart(s);
    setModule('anzeigen');
  };

  const reload = useCallback(async () => {
    const [i, m, c] = await Promise.all([
      api<ProjectInfo>(`/projects/${projectId}`),
      api<Mangel[]>(`/projects/${projectId}/maengel`),
      api<Conflict[]>(`/projects/${projectId}/conflicts`),
    ]);
    setInfo(i);
    setMaengel(m);
    setConflicts(c);
  }, [projectId]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setToast({ kind: 'ok', text: ok });
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) });
    }
    await reload();
  };

  const open = maengel.filter((m) => m.status !== 'abgenommen').length;
  const nav = (id: Module, icon: IconName, label: string, extra?: ReactNode) => (
    <button className={`side-item ${module === id ? 'active' : ''}`} onClick={() => setModule(id)}>
      <Icon name={icon} />
      {label}
      {extra}
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="app-icon">BA</div>
          <div>
            <strong>Bau Akte Pro</strong>
            <small>{info ? info.roleLabel : ' '}</small>
          </div>
        </div>
        <div className="project-picker">
          <select value={projectId} onChange={(e) => (e.target.value === '__neu' ? setNewProject(true) : onProject(e.target.value))} aria-label="Projekt">
            {me.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {me.canCreateProject && <option value="__neu">+ Neues Projekt …</option>}
          </select>
        </div>
        <div className="side-section">Baustelle</div>
        {nav('maengel', 'mangel', 'Mängel', <span className="count">{open}</span>)}
        {info && (info.role === 'bauleitung' || info.role === 'polier' || info.role === 'nu') && nav('anzeigen', 'anzeige', 'Mangelanzeigen')}
        {nav('besprechungen', 'besprechung', 'Besprechungen')}
        {nav('plaene', 'plan', 'Pläne', <span className="count">{info?.plans.length ?? ''}</span>)}
        {nav('dokumente', 'ordner', 'Dokumente')}
        {info && info.role !== 'bauherr' && info.role !== 'einkauf' && nav('nachunternehmer', 'firmen', 'Nachunternehmer')}
        {info && info.role !== 'bauherr' && info.role !== 'einkauf' && nav('stunden', 'kosten', 'Stundenzettel')}
        {info && (info.role === 'bauleitung' || info.role === 'nu') && nav('einreichungen', 'rechnung', 'Nachträge & Rechnungen')}
        {info && (info.role === 'bauleitung' || info.role === 'polier' || info.role === 'einkauf') && <div className="side-section">Geld und Betrieb</div>}
        {info && info.role === 'bauleitung' && nav('kosten', 'kosten', 'Kosten')}
        {info && (info.role === 'bauleitung' || info.role === 'polier' || info.role === 'einkauf') && nav('einkaeufe', 'einkauf', 'Einkäufe')}
        {info && (info.role === 'bauleitung' || info.role === 'polier') && nav('fahrtenbuch', 'auto', 'Fahrtenbuch')}
        {nav('hinweise', 'hinweis', 'Hinweise', conflicts.length > 0 ? <span className="badge">{conflicts.length}</span> : undefined)}
        {info && info.role === 'bauleitung' && (
          <>
            <div className="side-section">Projekt</div>
            {nav('struktur', 'firmen', 'Projekt & Struktur')}
            {nav('zugaenge', 'zugang', 'Zugänge')}
          </>
        )}
        <div className="sidebar-footer">
          <span className="avatar">{initials(me.user.name)}</span>
          <div className="who">
            <div>{me.user.name}</div>
            <small>{me.user.company}</small>
          </div>
          <button className="btn plain" onClick={onLogout} title="Abmelden" aria-label="Abmelden">
            <Icon name="abmelden" />
          </button>
        </div>
      </aside>

      <div className="content">
        {!info ? (
          <p className="loading">Projekt wird geladen …</p>
        ) : (
          <>
            {module === 'maengel' && <MaengelPage info={info} maengel={maengel} selected={selected} onSelect={setSelected} run={run} onAnzeige={startAnzeige} />}
            {module === 'anzeigen' && (
              <AnzeigenPage
                info={info}
                maengel={maengel}
                run={run}
                start={anzeigeStart}
                onStartHandled={() => setAnzeigeStart(null)}
                onOpenMangel={(id) => {
                  setSelected(id);
                  setModule('maengel');
                }}
              />
            )}
            {module === 'besprechungen' && (
              <BesprechungenPage
                info={info}
                maengel={maengel}
                run={run}
                openId={besprechungId}
                onOpen={setBesprechungId}
                onShowOnPlan={(meeting, punktId) => {
                  setPlanFocus({ meeting, punktId });
                  setModule('plaene');
                }}
                onPlacePin={(punkt, bId) => {
                  setPinFor({ punkt, besprechungId: bId });
                  setModule('plaene');
                }}
              />
            )}
            {module === 'plaene' && (
              <PlanPage
                key={planVersion}
                info={info}
                maengel={maengel}
                selected={selected}
                onSelect={setSelected}
                draft={draft}
                onPick={(pos) => {
                  if (!pinFor) return setDraft(pos);
                  const { punkt, besprechungId: bId } = pinFor;
                  void run(async () => {
                    await api(`/punkte/${punkt.id}`, {
                      method: 'PATCH',
                      body: { base_version: punkt.version, plan_id: info.plans[0]?.id, pin_page: pos.page, pin_x: pos.x, pin_y: pos.y },
                    });
                    setPinFor(null);
                    setBesprechungId(bId);
                    setModule('besprechungen');
                  }, `PIN für ${punkt.number ? `P-${String(punkt.number).padStart(3, '0')}` : 'Punkt'} gesetzt`);
                }}
                pinFor={pinFor?.punkt ?? null}
                onCancelPin={() => {
                  if (pinFor) setBesprechungId(pinFor.besprechungId);
                  setPinFor(null);
                  setModule('besprechungen');
                }}
                focus={planFocus}
                onPlanChanged={() => {
                  void reload();
                  setPlanVersion((v) => v + 1);
                }}
                onOpenPunkt={() => setModule('besprechungen')}
                run={run}
              />
            )}
            {module === 'dokumente' && <DokumentePage info={info} run={run} />}
            {module === 'stunden' && <StundenPage info={info} run={run} />}
            {module === 'einreichungen' && <EinreichungenPage info={info} run={run} />}
            {module === 'nachunternehmer' && <NachunternehmerPage info={info} run={run} onReload={() => void reload()} />}
            {module === 'einkaeufe' && <EinkaeufePage info={info} me={{ name: me.user.name }} run={run} />}
            {module === 'fahrtenbuch' && <FahrtenbuchPage info={info} run={run} />}
            {module === 'kosten' && <KostenPage info={info} run={run} />}
            {module === 'zugaenge' && <ZugaengePage info={info} run={run} />}
            {module === 'struktur' && <StrukturPage info={info} me={me} run={run} onReload={() => void reload()} onMeReload={onMeReload} />}
            {module === 'hinweise' && <HinweisePage info={info} conflicts={conflicts} run={run} />}
          </>
        )}
      </div>

      {draft && info && (
        <NewMangelSheet
          info={info}
          pos={draft}
          onCancel={() => setDraft(null)}
          onSave={(body) =>
            run(async () => {
              const r = await api<Mangel>('/maengel', { method: 'POST', body });
              setDraft(null);
              setSelected(r.id);
            }, 'Mangel erfasst')
          }
        />
      )}
      {newProject && (
        <NewProjectSheet
          me={me}
          current={projectId}
          run={run}
          onCancel={() => setNewProject(false)}
          onCreated={(id) => {
            setNewProject(false);
            onMeReload();
            onProject(id);
          }}
        />
      )}
      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.kind === 'ok' && <Icon name="haken" size={18} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

type Scope = 'offen' | 'ueberfaellig' | 'erledigt' | 'alle';
const SCOPES: [Scope, string][] = [
  ['offen', 'Offen'],
  ['ueberfaellig', 'Überfällig'],
  ['erledigt', 'Erledigt'],
  ['alle', 'Alle'],
];

function MaengelPage({ info, maengel, selected, onSelect, run, onAnzeige }: { info: ProjectInfo; maengel: Mangel[]; selected: string | null; onSelect: (id: string) => void; run: Run; onAnzeige: (s: AnzeigeStart) => void }) {
  const [scope, setScope] = useState<Scope>('offen');
  const [gewerk, setGewerk] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<MangelSort>('nummer');
  // List or folder view ("Unterordner"): folders by up to two levels, e.g. Firma › Monat.
  const [view, setView] = useState<'liste' | 'ordner'>('liste');
  const [ordner, setOrdner] = useState<MangelGruppe>('firma');
  const [unterordner, setUnterordner] = useState<MangelGruppe | ''>('monat');
  const [zu, setZu] = useState<Set<string>>(new Set()); // collapsed folders
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Geschoss of each room (for the folder level "Geschoss" and the sort by Ort).
  const geschossOf = useMemo(() => {
    const byId = new Map(info.locations.map((l) => [l.id, l]));
    return (id: string): string | null => {
      for (let l = byId.get(id); l; l = l.parent_id ? byId.get(l.parent_id) : undefined) if (l.kind === 'geschoss') return l.name;
      return null;
    };
  }, [info.locations]);
  const keyOf = useCallback(
    (m: Mangel): MangelKey => ({
      number: m.number, company: m.assigned_company_name, created_at: m.created_at, due: m.nachfrist_date ?? m.due_date,
      location: m.location_name, geschoss: geschossOf(m.location_id), gewerk: m.gewerk_name, status: m.status,
    }),
    [geschossOf],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = maengel.filter(
      (m) =>
        (scope === 'alle' ||
          (scope === 'offen' && m.status !== 'abgenommen') ||
          (scope === 'erledigt' && m.status === 'abgenommen') ||
          (scope === 'ueberfaellig' && m.escalation.ampel === 'rot')) &&
        (!gewerk || m.gewerk_id === gewerk) &&
        (!needle || `${mNo(m.number)} ${m.description} ${m.location_name} ${m.assigned_company_name ?? ''}`.toLowerCase().includes(needle)),
    );
    return sortMaengel(list, sort, keyOf);
  }, [maengel, scope, gewerk, q, sort, keyOf]);
  const levels: MangelGruppe[] = unterordner && unterordner !== ordner ? [ordner, unterordner] : [ordner];
  const tree = useMemo(() => (view === 'ordner' ? ordnerBaum(visible, levels, keyOf) : []), [view, visible, keyOf, ordner, unterordner]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = maengel.find((m) => m.id === selected) ?? null;

  // Selection only counts for Mängel that are still visible (filters may have hidden some).
  const sel = visible.filter((m) => checked.has(m.id));
  const toggle = (ids: string[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  const allIn = (f: MangelOrdner<Mangel>): Mangel[] => [...f.items, ...f.children.flatMap(allIn)];
  const berichtFor = (list: Mangel[]) => {
    const params = new URLSearchParams({ ids: list.map((m) => m.id).join(','), sort });
    if (view === 'ordner') params.set('gruppen', levels.join(','));
    return run(() => openPdf(`/projects/${info.project.id}/maengel/pdf?${params}`), 'Mängelbericht geöffnet');
  };

  const row = (m: Mangel, indent = 0) => (
    <tr key={m.id} className={m.id === selected ? 'selected' : ''} onClick={() => onSelect(m.id)}>
      <td className="check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" aria-label={`${mNo(m.number)} auswählen`} checked={checked.has(m.id)} onChange={(e) => toggle([m.id], e.target.checked)} />
      </td>
      <td className="num" style={indent ? { paddingLeft: 12 + indent * 22 } : undefined}>{mNo(m.number)}</td>
      <td>
        <div className="desc">
          {m.priority === 'kritisch' && <span className="tag critical">Kritisch</span>}
          {m.description}
        </div>
        <div className="sub">
          {m.location_name} · {m.gewerk_name} · erfasst {formatDate(m.created_at)}
        </div>
      </td>
      <td>
        {m.assigned_company_name ?? <span className="sub">–</span>}
        {m.assigned_company_id && !m.assignment_confirmed && <span className="tag">Vorschlag</span>}
        {m.anzeige_id && (
          <div className="sub">
            {m.anzeige_status === 'versendet' ? `${anzeigeNo(m.anzeige_number)} · ${formatDate(m.anzeige_sent_at)}` : 'In Mangelanzeige (Entwurf)'}
          </div>
        )}
      </td>
      <td>
        <StatusPill status={m.status} />
      </td>
      <td>
        <div className="tabular">{formatDate(m.nachfrist_date ?? m.due_date)}</div>
        <div style={{ marginTop: 4 }}>
          <AmpelPill e={m.escalation} />
        </div>
        {m.escalation.nachfristSuggestion && info.role === 'bauleitung' && (
          <button
            className="btn small"
            style={{ marginTop: 6 }}
            onClick={(e) => {
              e.stopPropagation();
              void run(
                () => api(`/maengel/${m.id}/nachfrist`, { method: 'POST', body: { date: m.escalation.nachfristSuggestion, base_version: m.version } }),
                `2. Nachfrist für ${mNo(m.number)} gesetzt`,
              );
            }}
          >
            2. Nachfrist {formatDate(m.escalation.nachfristSuggestion)}
          </button>
        )}
      </td>
    </tr>
  );

  const folderRows = (folders: MangelOrdner<Mangel>[], depth: number): ReactNode[] =>
    folders.flatMap((f) => {
      const items = allIn(f);
      const n = items.filter((m) => checked.has(m.id)).length;
      const open = !zu.has(f.path);
      return [
        <tr key={f.path} className="folder-row" onClick={() => setZu((prev) => { const next = new Set(prev); open ? next.add(f.path) : next.delete(f.path); return next; })}>
          <td className="check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              aria-label={`Ordner ${f.label} auswählen`}
              checked={n === items.length}
              ref={(el) => { if (el) el.indeterminate = n > 0 && n < items.length; }}
              onChange={(e) => toggle(items.map((m) => m.id), e.target.checked)}
            />
          </td>
          <td colSpan={5} style={{ paddingLeft: 12 + depth * 22 }}>
            <span className={`disclosure ${open ? 'open' : ''}`}><Icon name="chevron" size={13} /></span>
            <Icon name="ordner" size={16} />
            <span className="folder-name">{f.label}</span>
            <span className="sub">{f.count} {f.count === 1 ? 'Mangel' : 'Mängel'}</span>
            <button className="btn small folder-pdf" onClick={(e) => { e.stopPropagation(); void berichtFor(items); }} title="Mängelbericht nur für diesen Ordner">PDF</button>
          </td>
        </tr>,
        ...(open ? [...folderRows(f.children, depth + 1), ...f.items.map((m) => row(m, depth + 1))] : []),
      ];
    });

  const allChecked = visible.length > 0 && sel.length === visible.length;
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Mängel">
        <label className="search">
          <Icon name="suche" size={16} />
          <input placeholder="Suchen" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="segmented" role="tablist">
          {SCOPES.map(([id, label]) => (
            <button key={id} className={scope === id ? 'on' : ''} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
        </div>
        <select className="popup" value={gewerk} onChange={(e) => setGewerk(e.target.value)} aria-label="Gewerk">
          <option value="">Alle Gewerke</option>
          {info.gewerke.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <div className="segmented" role="tablist" aria-label="Ansicht">
          <button className={view === 'liste' ? 'on' : ''} onClick={() => setView('liste')}>Liste</button>
          <button className={view === 'ordner' ? 'on' : ''} onClick={() => setView('ordner')}>Ordner</button>
        </div>
      </PageHeader>
      <div className="list-toolbar">
        {view === 'ordner' && (
          <>
            <label className="field-inline">Ordner
              <select className="popup" value={ordner} onChange={(e) => setOrdner(e.target.value as MangelGruppe)}>
                {(Object.keys(MANGEL_GRUPPE_LABELS) as MangelGruppe[]).map((g) => <option key={g} value={g}>{MANGEL_GRUPPE_LABELS[g]}</option>)}
              </select>
            </label>
            <label className="field-inline">Unterordner
              <select className="popup" value={unterordner} onChange={(e) => setUnterordner(e.target.value as MangelGruppe | '')}>
                <option value="">keine</option>
                {(Object.keys(MANGEL_GRUPPE_LABELS) as MangelGruppe[]).filter((g) => g !== ordner).map((g) => <option key={g} value={g}>{MANGEL_GRUPPE_LABELS[g]}</option>)}
              </select>
            </label>
          </>
        )}
        <label className="field-inline">Sortieren
          <select className="popup" value={sort} onChange={(e) => setSort(e.target.value as MangelSort)}>
            {(Object.keys(MANGEL_SORT_LABELS) as MangelSort[]).map((k) => <option key={k} value={k}>{MANGEL_SORT_LABELS[k]}</option>)}
          </select>
        </label>
        <span className="spacer" />
        {sel.length > 0 && (
          <button className="btn small" onClick={() => setChecked(new Set())} title="Auswahl aufheben">
            Auswahl aufheben
          </button>
        )}
        <button
          className={`btn ${sel.length ? 'filled' : ''}`}
          disabled={visible.length === 0}
          onClick={() => void berichtFor(sel.length ? sel : visible)}
          title="PDF mit Übersicht, Foto und Planausschnitt je Mangel – in der Reihenfolge und Ordnung der Ansicht"
        >
          {sel.length ? `Mängelbericht (${sel.length} ausgewählt)` : `Mängelbericht (alle ${visible.length})`}
        </button>
      </div>
      <div className="split">
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th className="check">
                  <input type="checkbox" aria-label="Alle auswählen" checked={allChecked} ref={(el) => { if (el) el.indeterminate = sel.length > 0 && !allChecked; }}
                    onChange={(e) => toggle(visible.map((m) => m.id), e.target.checked)} />
                </th>
                <th>Nr.</th>
                <th>Mangel</th>
                <th>Nachunternehmer</th>
                <th>Status</th>
                <th>Frist</th>
              </tr>
            </thead>
            <tbody>{view === 'ordner' ? folderRows(tree, 0) : visible.map((m) => row(m))}</tbody>
          </table>
          {visible.length === 0 && <div className="empty">Keine Mängel in dieser Ansicht</div>}
        </div>
        <Inspector m={current} info={info} run={run} onAnzeige={onAnzeige} />
      </div>
    </>
  );
}

function PlanPage(props: {
  info: ProjectInfo;
  maengel: Mangel[];
  selected: string | null;
  onSelect: (id: string) => void;
  draft: { page: number; x: number; y: number } | null;
  onPick: (p: { page: number; x: number; y: number }) => void;
  pinFor: Punkt | null;
  onCancelPin: () => void;
  focus: { meeting: number | null; punktId: string | null };
  onPlanChanged: () => void;
  onOpenPunkt: () => void;
  run: Run;
}) {
  const { info, maengel, selected } = props;
  const [view, setView] = useState<'plan' | 'register'>('plan');
  const [planId, setPlanId] = useState(info.plans[0]?.id ?? '');
  const [punkte, setPunkte] = useState<(PunktPin & { besprechungen: number[] })[]>([]);
  // Filter: everything, only Mängel, only Punkte, or Punkte of one meeting ("Zeige alle PINs aus Besprechung Nr. 42").
  const [filter, setFilter] = useState<string>(props.focus.meeting ? `b${props.focus.meeting}` : 'alle');
  const [punktSel, setPunktSel] = useState<string | null>(props.focus.punktId);
  useEffect(() => {
    void api<(PunktPin & { besprechungen: number[] })[]>(`/projects/${info.project.id}/punkte-pins`).then(setPunkte, () => setPunkte([]));
  }, [info.project.id]);
  const plan = info.plans.find((p) => p.id === planId);
  const current = maengel.find((m) => m.id === selected) ?? null;
  const meetings = [...new Set(punkte.flatMap((p) => p.besprechungen))].sort((a, b) => a - b);
  const shownMaengel = filter === 'alle' || filter === 'maengel' ? maengel : [];
  const shownPunkte = filter === 'maengel' ? [] : filter.startsWith('b') ? punkte.filter((p) => p.besprechungen.includes(Number(filter.slice(1)))) : punkte;
  const selPunkt = punkte.find((p) => p.id === punktSel);
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Pläne">
        <div className="segmented">
          <button className={view === 'plan' ? 'on' : ''} onClick={() => setView('plan')}>
            Plan
          </button>
          <button className={view === 'register' ? 'on' : ''} onClick={() => setView('register')}>
            Planregister
          </button>
        </div>
        {view === 'plan' && (
          <>
            <select className="popup" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan">
              {[...new Set(info.plans.map((p) => p.folder_name ?? 'Ohne Ordner'))].map((folderName) => (
                <optgroup key={folderName} label={folderName}>
                  {info.plans
                    .filter((p) => (p.folder_name ?? 'Ohne Ordner') === folderName)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · Index {p.plan_index}
                        {p.released ? '' : ' (noch nicht freigegeben)'}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <select className="popup" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Anzeigen">
              <option value="alle">Mängel und Punkte</option>
              <option value="maengel">Nur Mängel</option>
              <option value="punkte">Nur Besprechungspunkte</option>
              {meetings.map((n) => (
                <option key={n} value={`b${n}`}>
                  Punkte aus Besprechung Nr. {n}
                </option>
              ))}
            </select>
            <span className="tokens" style={{ fontSize: 12 }}>
              <span className="chip c-red"><span className="dot" />Offen</span>
              <span className="chip c-orange"><span className="dot" />In Arbeit</span>
              <span className="chip c-green"><span className="dot" />Erledigt</span>
              <span className="chip c-blue"><span className="dot" />Info</span>
            </span>
          </>
        )}
      </PageHeader>
      {view === 'register' ? (
        <Planregister info={info} run={props.run} onChanged={props.onPlanChanged} />
      ) : (
        <div className="split">
          <div className="card plan-card">
            {props.pinFor && (
              <div className="row" style={{ background: 'var(--selection)', borderRadius: 10, marginBottom: 10 }}>
                <span>
                  <strong>PIN setzen:</strong> P-{String(props.pinFor.number ?? 0).padStart(3, '0')} {props.pinFor.text} – auf die Stelle im Plan klicken
                </span>
                <button className="btn small" onClick={props.onCancelPin}>
                  Abbrechen
                </button>
              </div>
            )}
            {plan ? (
              <PlanView
                planId={plan.id}
                planIndex={plan.plan_index}
                maengel={shownMaengel}
                punkte={shownPunkte}
                selectedId={punktSel ?? selected}
                draft={props.draft}
                onSelect={(id) => {
                  setPunktSel(null);
                  props.onSelect(id);
                }}
                onSelectPunkt={setPunktSel}
                onPick={props.onPick}
              />
            ) : (
              <div className="empty">Kein Plan vorhanden</div>
            )}
          </div>
          {selPunkt ? (
            <div className="inspector">
              <div>
                <div className="head">
                  <span className="num">P-{String(selPunkt.number ?? 0).padStart(3, '0')}</span>
                  <span className={`chip c-${PUNKT_TONE_WEB[selPunkt.status]}`}>
                    <span className="dot" />
                    {PUNKT_LABELS_WEB[selPunkt.status]}
                  </span>
                </div>
                <h2>{selPunkt.text}</h2>
              </div>
              <div className="group">
                <div className="row">
                  <span className="k">Besprechungen</span>
                  <span className="v">{selPunkt.besprechungen.map((n) => `Nr. ${n}`).join(', ')}</span>
                </div>
                <button className="row action" onClick={props.onOpenPunkt}>
                  Zu den Besprechungen
                  <Icon name="chevron" size={16} />
                </button>
              </div>
            </div>
          ) : (
            <Inspector m={current} info={info} run={props.run} />
          )}
        </div>
      )}
    </>
  );
}

function Inspector({ m, info, run, onAnzeige }: { m: Mangel | null; info: ProjectInfo; run: Run; onAnzeige?: (s: AnzeigeStart) => void }) {
  const candidates = m
    ? info.gewerkCompanies.filter((gc) => gc.gewerk_id === m.gewerk_id).map((gc) => info.companies.find((c) => c.id === gc.company_id)!).filter(Boolean)
    : [];
  const [assign, setAssign] = useState('');
  useEffect(() => setAssign(m?.assigned_company_id ?? candidates[0]?.id ?? ''), [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m)
    return (
      <div className="inspector">
        <div className="placeholder">
          <Icon name="mangel" size={40} />
          <div>Mangel auswählen</div>
        </div>
      </div>
    );

  const internal = info.role === 'bauleitung' || info.role === 'polier';
  const transition = (to: MangelStatus) =>
    run(
      () => api(`/maengel/${m.id}/transition`, { method: 'POST', body: { to, base_version: m.version, assigned_company_id: to === 'zugewiesen' ? assign : undefined } }),
      `${mNo(m.number)}: ${MANGEL_STATUS_LABELS[to]}`,
    );
  const negative = (to: MangelStatus) => to === 'nicht_behoben' || to === 'strittig';

  return (
    <div className="inspector">
      <div>
        <div className="head">
          <span className="num">{mNo(m.number)}</span>
          <StatusPill status={m.status} />
        </div>
        <h2>{m.description}</h2>
      </div>

      <div>
        <div className="group-title">Fotos</div>
        <div className="group">
          {m.fotos.length > 0 && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
              {m.fotos.map((f) => (
                <span key={f.id} style={{ position: 'relative' }}>
                  <Foto id={f.id} size={72} />
                  {f.kind === 'nachweis' && <span className="pill c-green" style={{ position: 'absolute', left: 4, bottom: 4 }}>Nachweis</span>}
                </span>
              ))}
            </div>
          )}
          <label className="row action" style={{ cursor: 'pointer' }}>
            Foto hinzufügen
            <input
              type="file"
              accept="image/jpeg,image/png"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                void run(async () => {
                  const fd = new FormData();
                  fd.set('id', crypto.randomUUID());
                  fd.set('taken_at', new Date(file.lastModified).toISOString());
                  fd.set('file', file);
                  const res = await fetch(`/api/maengel/${m.id}/fotos`, { method: 'POST', body: fd, headers: { authorization: `Bearer ${getToken()}` } });
                  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
                }, 'Foto hinzugefügt');
              }}
            />
            <Icon name="plus" size={16} />
          </label>
          <button className="row action" onClick={() => run(() => openPdf(`/projects/${info.project.id}/maengel/pdf?ids=${m.id}`), 'PDF geöffnet')}>
            Als PDF (Foto + Planausschnitt)
            <Icon name="anzeige" size={16} />
          </button>
        </div>
      </div>

      <div>
        <div className="group">
          <div className="row">
            <span className="k">Ort</span>
            <span className="v">{m.location_name}</span>
          </div>
          <div className="row">
            <span className="k">Gewerk</span>
            <span className="v">{m.gewerk_name}</span>
          </div>
          <div className="row">
            <span className="k">Nachunternehmer</span>
            <span className="v">
              {m.assigned_company_name ?? '–'}
              {m.assigned_company_id && !m.assignment_confirmed && <span className="tag">Vorschlag</span>}
            </span>
          </div>
          <div className="row">
            <span className="k">Priorität</span>
            <span className="v">{PRIORITY_LABELS[m.priority]}</span>
          </div>
        </div>
      </div>

      <div>
        <div className="group-title">Frist</div>
        <div className="group">
          <div className="row">
            <span className="k">Frist</span>
            <span className="v tabular">{formatDate(m.due_date)}</span>
          </div>
          {m.nachfrist_date && (
            <div className="row">
              <span className="k">2. Nachfrist</span>
              <span className="v tabular">{formatDate(m.nachfrist_date)}</span>
            </div>
          )}
          <div className="row">
            <span className="k">Eskalation</span>
            <AmpelPill e={m.escalation} />
          </div>
        </div>
      </div>

      {m.allowed_transitions.length > 0 && (
        <div>
          <div className="group-title">Status ändern</div>
          <div className="group">
            {m.allowed_transitions.includes('zugewiesen') && (
              <div className="row">
                <span className="k">Zuweisen an</span>
                <select value={assign} onChange={(e) => setAssign(e.target.value)}>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {m.allowed_transitions.map((to, i) => (
              <button key={to} className={`row action ${i === 0 ? 'primary' : ''} ${negative(to) ? 'destructive' : ''}`} onClick={() => transition(to)}>
                {MANGEL_STATUS_LABELS[to]}
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
        </div>
      )}

      {(m.anzeige_id || (onAnzeige && info.role === 'bauleitung' && m.assigned_company_id && canBePosition(m, m.assigned_company_id))) && (
        <div>
          <div className="group-title">Mangelanzeige</div>
          <div className="group">
            {m.anzeige_id && (
              <div className="row">
                <span className="k">{m.anzeige_status === 'versendet' ? anzeigeNo(m.anzeige_number) : 'Entwurf'}</span>
                <span className="v">{m.anzeige_status === 'versendet' ? `versendet ${formatDate(m.anzeige_sent_at)}` : 'noch nicht versendet'}</span>
              </div>
            )}
            {onAnzeige && info.role === 'bauleitung' && m.assigned_company_id && canBePosition(m, m.assigned_company_id) && (
              <button className="row action" onClick={() => onAnzeige({ companyId: m.assigned_company_id!, mangelIds: [m.id] })}>
                {m.anzeige_id ? 'Neue Mangelanzeige mit diesem Mangel' : 'Mangelanzeige erstellen'}
                <Icon name="chevron" size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="group-title">Protokoll</div>
        <div className="group">
          <div className="row">
            <span className="k">Erfasst von</span>
            <span className="v">{m.created_by_name}</span>
          </div>
          {internal && (
            <div className="row">
              <span className="k">Für Bauherr sichtbar</span>
              <span className="v">{m.visible_to_bauherr ? 'Ja' : 'Nein'}</span>
            </div>
          )}
        </div>
      </div>

      {internal && m.notes.length > 0 && (
        <div>
          <div className="group-title">Interne Notizen</div>
          <div className="group note">
            {m.notes.map((n, i) => (
              <div key={i} className="row">
                {n.text}
              </div>
            ))}
          </div>
          <div className="footnote">Nur für Bauleitung und Polier sichtbar.</div>
        </div>
      )}
    </div>
  );
}

function HinweisePage({ info, conflicts, run }: { info: ProjectInfo; conflicts: Conflict[]; run: Run }) {
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Hinweise" />
      <div className="list-pad">
        <div className="group-title">Konflikte und abgelehnte Änderungen aus dem Offline-Abgleich</div>
        <div className="card">
          {conflicts.length === 0 && (
            <div className="placeholder">
              <Icon name="haken" size={40} />
              <div>Alles abgeglichen</div>
            </div>
          )}
          {conflicts.map((c) => (
            <div key={c.id} className="conflict">
              <div>
                <span className={`pill ${c.kind === 'conflict' ? 'c-orange' : 'c-red'}`}>{c.kind === 'conflict' ? 'Konflikt' : 'Abgelehnt'}</span>{' '}
                <strong>{c.number != null && mNo(c.number)}</strong>
              </div>
              <div>{c.reason}</div>
              <div className="meta">
                {c.actor_name} · {new Date(c.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
              <details>
                <summary>Gesendete Änderung</summary>
                <pre>{JSON.stringify(c.client_change, null, 2)}</pre>
              </details>
              {info.role === 'bauleitung' && (
                <div>
                  <button className="btn small" onClick={() => run(() => api(`/conflicts/${c.id}/resolve`, { method: 'POST' }), 'Als geklärt markiert')}>
                    Als geklärt markieren
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function NewMangelSheet({ info, pos, onCancel, onSave }: { info: ProjectInfo; pos: { page: number; x: number; y: number }; onCancel: () => void; onSave: (body: object) => void }) {
  const rooms = info.locations.filter((l) => l.kind === 'raum');
  // Genaue Verortung: the room under the pin is suggested (docs/fachkonzept/04); the person can change it.
  const suggested = info.plans[0] ? roomAt(info.locationAreas, { plan_id: info.plans[0].id, page: pos.page, x: pos.x, y: pos.y }) : null;
  const [f, setF] = useState({ description: '', location_id: suggested ?? rooms[0]?.id ?? '', gewerk_id: info.gewerke[0]?.id ?? '', priority: 'normal' as Priority });
  const proposal = info.gewerkCompanies.find((gc) => gc.gewerk_id === f.gewerk_id)?.company_id;
  const save = () =>
    onSave({
      id: crypto.randomUUID(),
      project_id: info.project.id,
      ...f,
      plan_id: info.plans[0]?.id,
      pin_page: pos.page,
      pin_x: pos.x,
      pin_y: pos.y,
      assigned_company_id: proposal,
    });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Neuer Mangel">
        <div className="sheet-bar">
          <button className="btn plain" onClick={onCancel}>
            Abbrechen
          </button>
          <h3>Neuer Mangel</h3>
          <button className="btn plain right" style={{ fontWeight: 600 }} disabled={!f.description.trim()} onClick={save}>
            Sichern
          </button>
        </div>
        <div className="sheet-body">
          <div className="group">
            <div className="row stack">
              <textarea autoFocus placeholder="Was ist der Mangel?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </div>
          </div>
          <div>
            <div className="group">
              <div className="row">
                <span className="k">Ort</span>
                <select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <span className="k">Gewerk</span>
                <select value={f.gewerk_id} onChange={(e) => setF({ ...f, gewerk_id: e.target.value })}>
                  {info.gewerke.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <span className="k">Priorität</span>
                <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="footnote">
              {suggested ? (f.location_id === suggested ? 'Raum aus der Pin-Position übernommen. ' : 'Raum abweichend von der Pin-Position gewählt. ') : 'Kein Raum an dieser Stelle hinterlegt, bitte wählen. '}
              NU-Vorschlag aus dem Gewerk: {info.companies.find((c) => c.id === proposal)?.name ?? '–'}. Die Bauleitung bestätigt die Zuweisung.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
