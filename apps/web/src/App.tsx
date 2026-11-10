import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatDate, MANGEL_STATUS_LABELS, PRIORITIES, ROLE_LABELS, type MangelStatus, type Priority } from '@bap/domain';
import { api, ApiError, getToken, setToken, type Conflict, type Mangel, type Me, type ProjectInfo } from './api';
import { PlanView } from './PlanView';
import { Icon, type IconName } from './ui/Icon';
import { AmpelPill, initials, mNo, StatusPill } from './ui/status';

const TEST_USERS = [
  ['bauleitung@example.test', 'Bea Bauleitung', 'Bauleitung'],
  ['polier@example.test', 'Paul Polier', 'Polier'],
  ['elektro@example.test', 'Erik Elektro', 'NU Elektro Blitz'],
  ['fliesen@example.test', 'Fiona Fliesen', 'NU Fliesen Fuchs'],
  ['bauherr@example.test', 'Hanna Bauherr', 'Bauherr'],
] as const;

const PRIORITY_LABELS: Record<Priority, string> = { kritisch: 'Kritisch', normal: 'Normal', gering: 'Gering' };

type Module = 'maengel' | 'plaene' | 'hinweise';

/** Modules of the full product (CLAUDE.md, Umsetzungsreihenfolge) that are not built yet. */
const COMING: { icon: IconName; label: string }[] = [
  { icon: 'anzeige', label: 'Mangelanzeigen' },
  { icon: 'ordner', label: 'Dokumente' },
  { icon: 'besprechung', label: 'Besprechungen' },
  { icon: 'firmen', label: 'Nachunternehmer' },
  { icon: 'rechnung', label: 'Rechnungen' },
  { icon: 'kosten', label: 'Kosten' },
  { icon: 'einkauf', label: 'Einkäufe' },
  { icon: 'auto', label: 'Fahrtenbuch' },
];

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

  if (!checked) return null;
  if (!me) return <Login onLogin={loadMe} />;
  const logout = () => {
    setToken(null);
    setMe(null);
    setProjectId(null);
  };
  return projectId ? <ProjectShell key={`${projectId}-${me.user.id}`} me={me} projectId={projectId} onProject={setProjectId} onLogout={logout} /> : <p className="loading">Kein Projekt zugeordnet.</p>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="login">
      <div className="login-box">
        <div className="app-icon">BA</div>
        <h1>Bau Akte Pro</h1>
        <p>Als Testbenutzer anmelden (nur lokal, ohne Passwort)</p>
        <div className="group">
          {TEST_USERS.map(([email, name, role]) => (
            <button
              key={email}
              className="row action"
              onClick={async () => {
                try {
                  const r = await api<{ token: string }>('/auth/dev-login', { method: 'POST', body: { email } });
                  setToken(r.token);
                  onLogin();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <span className="avatar">{initials(name)}</span>
              <span className="who">
                {name}
                <small>{role}</small>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
        </div>
        {error && <p className="toast error">{error}</p>}
      </div>
    </div>
  );
}

function ProjectShell({ me, projectId, onProject, onLogout }: { me: Me; projectId: string; onProject: (id: string) => void; onLogout: () => void }) {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [maengel, setMaengel] = useState<Mangel[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [module, setModule] = useState<Module>('maengel');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: number; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<Toast>(null);

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
            <small>{info ? ROLE_LABELS[info.role] : ' '}</small>
          </div>
        </div>
        <div className="project-picker">
          <select value={projectId} onChange={(e) => onProject(e.target.value)} aria-label="Projekt">
            {me.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="side-section">Baustelle</div>
        {nav('maengel', 'mangel', 'Mängel', <span className="count">{open}</span>)}
        {nav('plaene', 'plan', 'Pläne', <span className="count">{info?.plans.length ?? ''}</span>)}
        {nav('hinweise', 'hinweis', 'Hinweise', conflicts.length > 0 ? <span className="badge">{conflicts.length}</span> : undefined)}
        <div className="side-section">In Vorbereitung</div>
        {COMING.map((c) => (
          <div key={c.label} className="side-item soon" title="Kommt in einem der nächsten Schritte">
            <Icon name={c.icon} />
            {c.label}
            <span className="soon-tag">bald</span>
          </div>
        ))}
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
            {module === 'maengel' && <MaengelPage info={info} maengel={maengel} selected={selected} onSelect={setSelected} run={run} />}
            {module === 'plaene' && (
              <PlanPage info={info} maengel={maengel} selected={selected} onSelect={setSelected} draft={draft} onPick={setDraft} run={run} />
            )}
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
      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.kind === 'ok' && <Icon name="haken" size={18} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      {children && <div className="toolbar">{children}</div>}
    </header>
  );
}

type Scope = 'offen' | 'ueberfaellig' | 'erledigt' | 'alle';
const SCOPES: [Scope, string][] = [
  ['offen', 'Offen'],
  ['ueberfaellig', 'Überfällig'],
  ['erledigt', 'Erledigt'],
  ['alle', 'Alle'],
];

function MaengelPage({ info, maengel, selected, onSelect, run }: { info: ProjectInfo; maengel: Mangel[]; selected: string | null; onSelect: (id: string) => void; run: Run }) {
  const [scope, setScope] = useState<Scope>('offen');
  const [gewerk, setGewerk] = useState('');
  const [q, setQ] = useState('');

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return maengel.filter(
      (m) =>
        (scope === 'alle' ||
          (scope === 'offen' && m.status !== 'abgenommen') ||
          (scope === 'erledigt' && m.status === 'abgenommen') ||
          (scope === 'ueberfaellig' && m.escalation.ampel === 'rot')) &&
        (!gewerk || m.gewerk_id === gewerk) &&
        (!needle || `${mNo(m.number)} ${m.description} ${m.location_name} ${m.assigned_company_name ?? ''}`.toLowerCase().includes(needle)),
    );
  }, [maengel, scope, gewerk, q]);
  const current = maengel.find((m) => m.id === selected) ?? null;

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
      </PageHeader>
      <div className="split">
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Mangel</th>
                <th>Nachunternehmer</th>
                <th>Status</th>
                <th>Frist</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id} className={m.id === selected ? 'selected' : ''} onClick={() => onSelect(m.id)}>
                  <td className="num">{mNo(m.number)}</td>
                  <td>
                    <div className="desc">
                      {m.priority === 'kritisch' && <span className="tag critical">Kritisch</span>}
                      {m.description}
                    </div>
                    <div className="sub">
                      {m.location_name} · {m.gewerk_name}
                    </div>
                  </td>
                  <td>
                    {m.assigned_company_name ?? <span className="sub">–</span>}
                    {m.assigned_company_id && !m.assignment_confirmed && <span className="tag">Vorschlag</span>}
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
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <div className="empty">Keine Mängel in dieser Ansicht</div>}
        </div>
        <Inspector m={current} info={info} run={run} />
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
  run: Run;
}) {
  const { info, maengel, selected } = props;
  const [planId, setPlanId] = useState(info.plans[0]?.id ?? '');
  const plan = info.plans.find((p) => p.id === planId);
  const current = maengel.find((m) => m.id === selected) ?? null;
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Pläne">
        <select className="popup" value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Plan">
          {info.plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · Index {p.plan_index}
            </option>
          ))}
        </select>
        <span className="sub" style={{ color: 'var(--label-2)', fontSize: 13 }}>
          Auf eine freie Stelle klicken, um einen Mangel zu erfassen
        </span>
      </PageHeader>
      <div className="split">
        <div className="card plan-card">
          {plan ? (
            <PlanView planId={plan.id} maengel={maengel} selectedId={selected} draft={props.draft} onSelect={props.onSelect} onPick={props.onPick} />
          ) : (
            <div className="empty">Kein Plan vorhanden</div>
          )}
        </div>
        <Inspector m={current} info={info} run={props.run} />
      </div>
    </>
  );
}

function Inspector({ m, info, run }: { m: Mangel | null; info: ProjectInfo; run: Run }) {
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
  const [f, setF] = useState({ description: '', location_id: rooms[0]?.id ?? '', gewerk_id: info.gewerke[0]?.id ?? '', priority: 'normal' as Priority });
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
            <div className="footnote">NU-Vorschlag aus dem Gewerk: {info.companies.find((c) => c.id === proposal)?.name ?? '–'}. Die Bauleitung bestätigt die Zuweisung.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
