/** Administration: all users and projects of the company; lock/unlock, admin and firm-admin rights. */
import { useCallback, useEffect, useState } from 'react';
import { formatDate, roleLabel } from '@bap/domain';
import { api } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface User {
  id: string; name: string; email: string; active: boolean; is_admin: boolean; company_admin: boolean; fahrtenbuch: boolean;
  company: string; company_kind: 'own' | 'nu' | 'bauherr'; last_seen: string | null; projekte: { project_id: string; member_id: string; project: string; role: string }[];
}
interface Project { id: string; name: string; created_at: string; mitglieder: number; maengel_offen: number }
const KIND: Record<string, string> = { own: 'Eigene Firma', nu: 'Nachunternehmer', bauherr: 'Bauherr' };

export function AdminPage({ meId, run, onOpenProject }: { meId: string; run: Run; onOpenProject: (id: string) => void }) {
  const [d, setD] = useState<{ users: User[]; projects: Project[] } | null>(null);
  const [q, setQ] = useState('');
  const [assign, setAssign] = useState<User | null>(null);
  const load = useCallback(async () => setD(await api(`/admin`)), []);
  useEffect(() => void load(), [load]);
  const patch = (u: User, body: Partial<User>, ok: string) => run(async () => { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); await load(); }, ok);
  if (!d) return <p className="loading">Wird geladen …</p>;
  const users = d.users.filter((u) => !q || `${u.name} ${u.email} ${u.company}`.toLowerCase().includes(q.toLowerCase()));
  const groups = ['own', 'nu', 'bauherr'].map((k) => [k, users.filter((u) => u.company_kind === k)] as const).filter(([, l]) => l.length);
  return (
    <>
      <PageHeader eyebrow="Gesamte App" title="Administration">
        <label className="search"><Icon name="suche" size={16} /><input placeholder="Person oder Firma suchen" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </PageHeader>
      <div className="list-pad admin">
        <div>
          <div className="group-title">Projekte ({d.projects.length})</div>
          <div className="group">
            {d.projects.map((p) => (
              <button key={p.id} className="row action" style={{ color: 'var(--label)' }} onClick={() => onOpenProject(p.id)}>
                <span className="k">{p.name}<div className="sub">angelegt {formatDate(p.created_at)} · {p.mitglieder} Zugänge · {p.maengel_offen} offene Mängel</div></span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
          <div className="footnote">Als Administrator haben Sie in jedem Projekt die Rechte der Bauleitung, auch ohne eingetragen zu sein.</div>
        </div>
        {groups.map(([k, list]) => (
          <div key={k}>
            <div className="group-title">{KIND[k]} ({list.length})</div>
            <div className="group">
              {list.map((u) => (
                <div key={u.id} className={`row ${u.active ? '' : 'inactive'}`}>
                  <span className="k">
                    {u.name}{u.id === meId ? ' (Sie)' : ''}
                    {u.is_admin && <span className="pill c-purple" style={{ marginLeft: 6 }}>Admin</span>}
                    {u.company_admin && <span className="pill c-teal" style={{ marginLeft: 6 }}>Firmen-Admin</span>}
                    {!u.active && <span className="pill c-red" style={{ marginLeft: 6 }}>Gesperrt</span>}
                    <div className="sub">
                      {u.email}{k !== 'own' ? ` · ${u.company}` : ''} · {u.projekte.length ? u.projekte.map((p) => `${p.project} (${roleLabel(p.role)})`).join(', ') : 'keinem Projekt zugeordnet'}
                      {u.last_seen ? ` · zuletzt aktiv ${formatDate(u.last_seen)}` : ''}
                    </div>
                  </span>
                  {u.id !== meId && (
                    <span className="actions">
                      <button className="btn small" onClick={() => setAssign(u)}>Projekte</button>
                      {k === 'own' && (
                        <button className="btn small" onClick={() => void patch(u, { fahrtenbuch: !u.fahrtenbuch }, u.fahrtenbuch ? 'Fahrtenbuch abgeschaltet' : 'Fahrtenbuch freigeschaltet')}>
                          {u.fahrtenbuch ? 'Fahrtenbuch ✓' : 'Fahrtenbuch'}
                        </button>
                      )}
                      {k === 'own' && (
                        <button className="btn small" onClick={() => void patch(u, { is_admin: !u.is_admin }, u.is_admin ? `${u.name} ist kein Admin mehr` : `${u.name} ist jetzt Admin`)}>
                          {u.is_admin ? 'Admin entziehen' : 'Zum Admin'}
                        </button>
                      )}
                      {k === 'nu' && (
                        <button className="btn small" onClick={() => void patch(u, { company_admin: !u.company_admin }, u.company_admin ? 'Firmen-Admin entzogen' : 'Ist jetzt Firmen-Admin')}>
                          {u.company_admin ? 'Firmen-Admin entziehen' : 'Zum Firmen-Admin'}
                        </button>
                      )}
                      <button className={`btn small ${u.active ? 'destructive' : ''}`} onClick={() => void patch(u, { active: !u.active }, u.active ? `${u.name} gesperrt – alle Geräte abgemeldet` : `${u.name} entsperrt`)}>
                        {u.active ? 'Sperren' : 'Entsperren'}
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {assign && <AssignSheet u={d.users.find((x) => x.id === assign.id) ?? assign} projects={d.projects} onClose={() => setAssign(null)}
          run={async (fn, ok) => { await run(fn, ok); await load(); }} />}
        <div className="footnote">Jede Person sieht nur die Projekte, denen sie zugeordnet ist – mit der dort vergebenen Rolle. Einzelne Bereiche schaltet die Bauleitung des Projekts unter „Zugänge“ ab. Sperren meldet die Person auf allen Geräten ab; sie kann sich nicht mehr anmelden. Alle Änderungen stehen im Protokoll.</div>
      </div>
    </>
  );
}

const ROLLEN_OWN: [string, string][] = [['bauleitung', 'Bauleitung'], ['projektleitung', 'Projektleitung'], ['polier', 'Polier'], ['einkauf', 'Einkauf']];

/** Assign a person to projects with a role; remove from a project. */
function AssignSheet({ u, projects, onClose, run }: { u: User; projects: Project[]; onClose: () => void; run: Run }) {
  const roles: [string, string][] = u.company_kind === 'own' ? ROLLEN_OWN : [[u.company_kind, u.company_kind === 'nu' ? 'Nachunternehmer' : 'Bauherr']];
  const [role, setRole] = useState(roles[0]![0]);
  const frei = projects.filter((p) => !u.projekte.some((x) => x.project_id === p.id));
  const [pid, setPid] = useState(frei[0]?.id ?? '');
  return (
    <Sheet title={`Projekte · ${u.name}`} primary="Fertig" onCancel={onClose} onPrimary={onClose}>
      <div className="group-title">Zugeordnet</div>
      <div className="group">
        {u.projekte.map((p) => (
          <div key={p.member_id} className="row">
            <span className="k">{p.project}</span>
            <span className="actions">
              {roles.length > 1 ? (
                <select value={p.role} onChange={(e) => void run(() => api(`/admin/users/${u.id}/projekte`, { method: 'POST', body: { project_id: p.project_id, role: e.target.value } }), 'Rolle geändert')}>
                  {roles.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
                </select>
              ) : <span className="v">{roleLabel(p.role)}</span>}
              <button className="btn small destructive" onClick={() => void run(() => api(`/mitglieder/${p.member_id}`, { method: 'DELETE' }), 'Aus dem Projekt entfernt')}>Entfernen</button>
            </span>
          </div>
        ))}
        {u.projekte.length === 0 && <div className="row"><span className="k sub">noch keinem Projekt zugeordnet</span></div>}
      </div>
      {frei.length > 0 && (
        <>
          <div className="group-title" style={{ marginTop: 16 }}>Zu Projekt hinzufügen</div>
          <div className="group">
            <div className="row"><span className="k">Projekt</span><select value={pid} onChange={(e) => setPid(e.target.value)}>{frei.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="row"><span className="k">Rolle</span><select value={role} onChange={(e) => setRole(e.target.value)}>{roles.map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select></div>
            <button className="row action primary" disabled={!pid} onClick={() => void run(() => api(`/admin/users/${u.id}/projekte`, { method: 'POST', body: { project_id: pid, role } }), 'Zugeordnet')}>Hinzufügen</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
