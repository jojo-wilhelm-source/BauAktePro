/** Administration: all users and projects of the company; lock/unlock, admin and firm-admin rights. */
import { useCallback, useEffect, useState } from 'react';
import { formatDate, roleLabel } from '@bap/domain';
import { api } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, type Run } from './ui/layout';

interface User {
  id: string; name: string; email: string; active: boolean; is_admin: boolean; company_admin: boolean;
  company: string; company_kind: 'own' | 'nu' | 'bauherr'; last_seen: string | null; projekte: { project: string; role: string }[];
}
interface Project { id: string; name: string; created_at: string; mitglieder: number; maengel_offen: number }
const KIND: Record<string, string> = { own: 'Eigene Firma', nu: 'Nachunternehmer', bauherr: 'Bauherr' };

export function AdminPage({ meId, run, onOpenProject }: { meId: string; run: Run; onOpenProject: (id: string) => void }) {
  const [d, setD] = useState<{ users: User[]; projects: Project[] } | null>(null);
  const [q, setQ] = useState('');
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
        <div className="footnote">Sperren meldet die Person auf allen Geräten ab; sie kann sich nicht mehr anmelden. Alle Änderungen stehen im Protokoll.</div>
      </div>
    </>
  );
}
