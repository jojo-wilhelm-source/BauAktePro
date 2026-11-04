import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, MANGEL_STATUS, MANGEL_STATUS_LABELS, PRIORITIES, ROLE_LABELS, type MangelStatus, type Priority } from '@bap/domain';
import { api, ApiError, getToken, setToken, type Conflict, type Mangel, type Me, type ProjectInfo } from './api';
import { PlanView } from './PlanView';

const TEST_USERS = [
  ['bauleitung@example.test', 'Bea Bauleitung', 'Bauleitung'],
  ['polier@example.test', 'Paul Polier', 'Polier'],
  ['elektro@example.test', 'Erik Elektro', 'NU Elektro Blitz'],
  ['fliesen@example.test', 'Fiona Fliesen', 'NU Fliesen Fuchs'],
  ['bauherr@example.test', 'Hanna Bauherr', 'Bauherr'],
] as const;

const mNo = (n: number) => `M-${String(n).padStart(3, '0')}`;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    if (!getToken()) return setMe(null);
    try {
      const m = await api<Me>('/me');
      setMe(m);
      setProjectId((p) => p ?? m.projects[0]?.id ?? null);
    } catch {
      setMe(null);
    }
  }, []);
  useEffect(() => void loadMe(), [loadMe]);

  if (!me) return <Login onLogin={loadMe} />;
  return (
    <div className="app">
      <header>
        <strong>Bau Akte Pro</strong>
        <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value)}>
          {me.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span>
          {me.user.name} · {me.user.company}
        </span>
        <button
          onClick={() => {
            setToken(null);
            setMe(null);
            setProjectId(null);
          }}
        >
          Abmelden
        </button>
      </header>
      {projectId && <ProjectPage key={`${projectId}-${me.user.id}`} projectId={projectId} />}
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="login">
      <h1>Bau Akte Pro</h1>
      <p className="hint">Durchstich – Anmeldung als Testbenutzer (ohne Passwort, nur lokal).</p>
      {TEST_USERS.map(([email, name, role]) => (
        <button
          key={email}
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
          <strong>{name}</strong> <span>{role}</span>
        </button>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

type Tab = 'liste' | 'plan' | 'konflikte';

function ProjectPage({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [maengel, setMaengel] = useState<Mangel[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [tab, setTab] = useState<Tab>('liste');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: number; x: number; y: number } | null>(null);
  const [filter, setFilter] = useState<{ status: string; gewerk: string; ampel: string }>({ status: '', gewerk: '', ampel: '' });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [i, m] = await Promise.all([api<ProjectInfo>(`/projects/${projectId}`), api<Mangel[]>(`/projects/${projectId}/maengel`)]);
    setInfo(i);
    setMaengel(m);
    setConflicts(await api<Conflict[]>(`/projects/${projectId}/conflicts`));
  }, [projectId]);
  useEffect(() => void reload(), [reload]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage({ kind: 'ok', text: ok });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) });
    }
    await reload();
  };

  const visible = useMemo(
    () =>
      maengel.filter(
        (m) =>
          (!filter.status || m.status === filter.status) &&
          (!filter.gewerk || m.gewerk_id === filter.gewerk) &&
          (!filter.ampel || m.escalation.ampel === filter.ampel),
      ),
    [maengel, filter],
  );
  const current = maengel.find((m) => m.id === selected) ?? null;
  const plan = info?.plans[0];

  if (!info) return <p className="loading">Lade Projekt …</p>;
  const internal = info.role === 'bauleitung' || info.role === 'polier';

  return (
    <main>
      <div className="toolbar">
        <h2>
          {info.project.name} <small>{ROLE_LABELS[info.role]}</small>
        </h2>
        <nav>
          <button className={tab === 'liste' ? 'active' : ''} onClick={() => setTab('liste')}>
            Mängel ({maengel.length})
          </button>
          <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>
            Plan
          </button>
          <button className={tab === 'konflikte' ? 'active' : ''} onClick={() => setTab('konflikte')}>
            Konflikte {conflicts.length > 0 && <span className="badge">{conflicts.length}</span>}
          </button>
        </nav>
      </div>
      {message && (
        <p className={`message ${message.kind}`} onClick={() => setMessage(null)}>
          {message.text}
        </p>
      )}

      <div className="layout">
        <section className="content">
          {tab === 'liste' && (
            <>
              <div className="filters">
                <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
                  <option value="">Alle Status</option>
                  {MANGEL_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {MANGEL_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                <select value={filter.gewerk} onChange={(e) => setFilter({ ...filter, gewerk: e.target.value })}>
                  <option value="">Alle Gewerke</option>
                  {info.gewerke.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <select value={filter.ampel} onChange={(e) => setFilter({ ...filter, ampel: e.target.value })}>
                  <option value="">Alle Fristen</option>
                  <option value="rot">Überfällig</option>
                  <option value="gelb">Bald fällig</option>
                  <option value="gruen">Im Plan</option>
                </select>
              </div>
              <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nr.</th>
                    <th>Beschreibung</th>
                    <th>Ort</th>
                    <th>Gewerk</th>
                    <th>Nachunternehmer</th>
                    <th>Status</th>
                    <th>Frist</th>
                    <th>Eskalation</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((m) => (
                    <tr key={m.id} className={m.id === selected ? 'selected' : ''} onClick={() => setSelected(m.id)}>
                      <td>{mNo(m.number)}</td>
                      <td>
                        {m.priority === 'kritisch' && <span className="tag kritisch">kritisch</span>} {m.description}
                      </td>
                      <td>{m.location_name}</td>
                      <td>{m.gewerk_name}</td>
                      <td>
                        {m.assigned_company_name ?? '–'}
                        {m.assigned_company_id && !m.assignment_confirmed && <span className="tag">Vorschlag</span>}
                      </td>
                      <td>{MANGEL_STATUS_LABELS[m.status]}</td>
                      <td>{formatDate(m.nachfrist_date ?? m.due_date)}</td>
                      <td>
                        <span className={`ampel ampel-${m.escalation.ampel}`} /> {m.escalation.label}
                        {m.escalation.nachfristSuggestion && info.role === 'bauleitung' && (
                          <button
                            className="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              void run(
                                () => api(`/maengel/${m.id}/nachfrist`, { method: 'POST', body: { date: m.escalation.nachfristSuggestion, base_version: m.version } }),
                                `2. Nachfrist für ${mNo(m.number)} gesetzt`,
                              );
                            }}
                          >
                            2. Nachfrist {formatDate(m.escalation.nachfristSuggestion)} setzen
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={8} className="empty">
                        Keine Mängel
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </>
          )}

          {tab === 'plan' && plan && (
            <>
              <p className="hint">
                {plan.name} · Index {plan.plan_index} — Klick auf eine freie Stelle erfasst einen neuen Mangel.
              </p>
              <PlanView planId={plan.id} maengel={maengel} selectedId={selected} onSelect={setSelected} onPick={(p) => setDraft(p)} />
            </>
          )}

          {tab === 'konflikte' && (
            <div className="conflicts">
              {conflicts.length === 0 && <p className="empty">Keine offenen Konflikte.</p>}
              {conflicts.map((c) => (
                <div key={c.id} className={`conflict ${c.kind}`}>
                  <div>
                    <strong>{c.kind === 'conflict' ? 'Konflikt' : 'Abgelehnt'}</strong> {c.number != null && mNo(c.number)} · {c.actor_name} ·{' '}
                    {new Date(c.created_at).toLocaleString('de-DE')}
                  </div>
                  <p>{c.reason}</p>
                  <pre>{JSON.stringify(c.client_change, null, 2)}</pre>
                  {info.role === 'bauleitung' && (
                    <button onClick={() => run(() => api(`/conflicts/${c.id}/resolve`, { method: 'POST' }), 'Konflikt als geklärt markiert')}>
                      Als geklärt markieren
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside>
          {draft && (
            <NewMangel
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
          {!draft && current && (
            <Detail
              m={current}
              info={info}
              internal={internal}
              onTransition={(to, assigned) =>
                run(
                  () => api(`/maengel/${current.id}/transition`, { method: 'POST', body: { to, base_version: current.version, assigned_company_id: assigned } }),
                  `${mNo(current.number)}: ${MANGEL_STATUS_LABELS[to]}`,
                )
              }
            />
          )}
          {!draft && !current && <p className="hint">Mangel in der Liste oder im Plan auswählen.</p>}
        </aside>
      </div>
    </main>
  );
}

function Detail({ m, info, internal, onTransition }: { m: Mangel; info: ProjectInfo; internal: boolean; onTransition: (to: MangelStatus, assigned?: string) => void }) {
  const candidates = info.gewerkCompanies.filter((gc) => gc.gewerk_id === m.gewerk_id).map((gc) => info.companies.find((c) => c.id === gc.company_id)!).filter(Boolean);
  const [assign, setAssign] = useState(m.assigned_company_id ?? candidates[0]?.id ?? '');
  useEffect(() => setAssign(m.assigned_company_id ?? candidates[0]?.id ?? ''), [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="detail">
      <h3>
        {mNo(m.number)} <span className={`ampel ampel-${m.escalation.ampel}`} />
      </h3>
      <p>{m.description}</p>
      <dl>
        <dt>Status</dt>
        <dd>{MANGEL_STATUS_LABELS[m.status]}</dd>
        <dt>Ort</dt>
        <dd>{m.location_name}</dd>
        <dt>Gewerk</dt>
        <dd>{m.gewerk_name}</dd>
        <dt>Nachunternehmer</dt>
        <dd>
          {m.assigned_company_name ?? '–'} {m.assigned_company_id && !m.assignment_confirmed && '(Vorschlag, nicht bestätigt)'}
        </dd>
        <dt>Priorität</dt>
        <dd>{m.priority}</dd>
        <dt>Frist</dt>
        <dd>
          {formatDate(m.due_date)}
          {m.nachfrist_date && ` · 2. Nachfrist ${formatDate(m.nachfrist_date)}`}
        </dd>
        <dt>Eskalation</dt>
        <dd>{m.escalation.label}</dd>
        <dt>Erfasst von</dt>
        <dd>{m.created_by_name}</dd>
        {internal && (
          <>
            <dt>Für Bauherr sichtbar</dt>
            <dd>{m.visible_to_bauherr ? 'ja' : 'nein'}</dd>
          </>
        )}
      </dl>
      {m.allowed_transitions.includes('zugewiesen') && (
        <label>
          Nachunternehmer
          <select value={assign} onChange={(e) => setAssign(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="actions">
        {m.allowed_transitions.map((to) => (
          <button key={to} onClick={() => onTransition(to, to === 'zugewiesen' ? assign : undefined)}>
            → {MANGEL_STATUS_LABELS[to]}
          </button>
        ))}
        {m.allowed_transitions.length === 0 && <p className="hint">Keine Statuswechsel für Ihre Rolle möglich.</p>}
      </div>
      {internal && m.notes.length > 0 && (
        <div className="notes">
          <h4>Interne Notizen</h4>
          {m.notes.map((n, i) => (
            <p key={i}>{n.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function NewMangel({ info, pos, onCancel, onSave }: { info: ProjectInfo; pos: { page: number; x: number; y: number }; onCancel: () => void; onSave: (body: object) => void }) {
  const rooms = info.locations.filter((l) => l.kind === 'raum');
  const [f, setF] = useState({ description: '', location_id: rooms[0]?.id ?? '', gewerk_id: info.gewerke[0]?.id ?? '', priority: 'normal' as Priority });
  const proposal = info.gewerkCompanies.find((gc) => gc.gewerk_id === f.gewerk_id)?.company_id;
  return (
    <form
      className="detail"
      onSubmit={(e) => {
        e.preventDefault();
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
      }}
    >
      <h3>Neuer Mangel</h3>
      <label>
        Beschreibung *
        <textarea required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      <label>
        Ort *
        <select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Gewerk *
        <select value={f.gewerk_id} onChange={(e) => setF({ ...f, gewerk_id: e.target.value })}>
          {info.gewerke.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priorität
        <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <p className="hint">NU-Vorschlag aus Gewerk: {info.companies.find((c) => c.id === proposal)?.name ?? '–'}</p>
      <div className="actions">
        <button type="submit">Speichern</button>
        <button type="button" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
