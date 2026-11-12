/** Zugänge (docs/fachkonzept/01): invite people into the project, open invitations, remove access. Leitung only. */
import { useCallback, useEffect, useState } from 'react';
import { formatDate, MODUL_LABELS, MODULE_JE_ROLLE, roleLabel, type Modul, type ProjectRole as BaseRole, type Rolle } from '@bap/domain';

/** Project roles incl. Projektleitung (same rights as Bauleitung, stored as its own role). */
type ProjectRole = BaseRole | 'projektleitung';
import { api, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface Data {
  mitglieder: ({ id: string; role: ProjectRole; user_id: string; name: string; email: string; company: string; company_kind: string; ich: boolean } & Partial<Record<`m_${Modul}`, boolean>>)[];
  einladungen: { id: string; email: string; name: string | null; role: ProjectRole; created_at: string; expires_at: string; company: string; invited_by: string }[];
  firmen: { id: string; name: string; kind: 'nu' | 'bauherr' }[];
  /** NU firm admin: only own firm, invites always as Nachunternehmer. */
  firmAdmin?: boolean;
}

const ROLES: [ProjectRole, string][] = [
  ['polier', 'Polier'],
  ['bauleitung', 'Bauleitung'],
  ['projektleitung', 'Projektleitung'],
  ['einkauf', 'Einkauf'],
  ['nu', 'Nachunternehmer'],
  ['bauherr', 'Bauherr'],
];
const KIND_LABEL: Record<string, string> = { own: 'Eigene Firma', nu: 'Nachunternehmer', bauherr: 'Bauherr' };

export function ZugaengePage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [d, setD] = useState<Data | null>(null);
  const [inviting, setInviting] = useState(false);
  const [remove, setRemove] = useState<Data['mitglieder'][number] | null>(null);
  const [rechte, setRechte] = useState<Data['mitglieder'][number] | null>(null);
  const load = useCallback(async () => setD(await api<Data>(`/projects/${info.project.id}/zugaenge`)), [info.project.id]);
  useEffect(() => void load(), [load]);
  const runAndLoad: Run = async (fn, ok) => {
    await run(fn, ok);
    await load();
  };
  if (!d) return <p className="loading">Zugänge werden geladen …</p>;
  const groups = ['own', 'nu', 'bauherr'].map((k) => [k, d.mitglieder.filter((m) => m.company_kind === k)] as const).filter(([, l]) => l.length);

  return (
    <>
      <PageHeader eyebrow={info.project.name} title={d.firmAdmin ? 'Mitarbeiter meiner Firma' : 'Zugänge'} action={<button className="btn filled" onClick={() => setInviting(true)}><Icon name="plus" size={16} /> Person einladen</button>} />
      <div className="list-pad" style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {d.einladungen.length > 0 && (
          <div>
            <div className="group-title">Offene Einladungen</div>
            <div className="group">
              {d.einladungen.map((e) => (
                <div key={e.id} className="row">
                  <span className="k">
                    {e.name ? `${e.name} · ` : ''}{e.email}
                    <div className="sub">{roleLabel(e.role)} · {e.company} · eingeladen {formatDate(e.created_at)} von {e.invited_by} · gültig bis {formatDate(e.expires_at)}</div>
                  </span>
                  <button className="btn small destructive" onClick={() => runAndLoad(() => api(`/einladungen/${e.id}/zurueckziehen`, { method: 'POST' }), 'Einladung zurückgezogen')}>Zurückziehen</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {groups.map(([kind, list]) => (
          <div key={kind}>
            <div className="group-title">{KIND_LABEL[kind]}</div>
            <div className="group">
              {list.map((m) => (
                <div key={m.id} className="row">
                  <span className="k">
                    {m.name}{m.ich ? ' (Sie)' : ''}
                    <div className="sub">{m.email}{kind !== 'own' ? ` · ${m.company}` : ''}</div>
                  </span>
                  <span className="actions">
                    <span className="v">{roleLabel(m.role)}</span>
                    {!m.ich && <button className="btn small" onClick={() => setRechte(m)}>Rechte</button>}
                    {!m.ich && <button className="btn small destructive" onClick={() => setRemove(m)}>Zugang entziehen</button>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {rechte && <RechteSheet m={rechte} firmAdmin={!!d.firmAdmin} onClose={() => setRechte(null)} run={runAndLoad} />}
        <div className="footnote">Die Rolle legt fest, was jemand darf; einzelne Bereiche lassen sich pro Person abschalten. Eingeladene bekommen eine E-Mail mit einem Link (14 Tage gültig) und wählen ihr Passwort selbst. Wer schon einen Zugang hat, wird direkt hinzugefügt. Jede Änderung steht im Protokoll.</div>
      </div>
      {inviting && <InviteSheet info={info} firmen={d.firmen} firmAdmin={!!d.firmAdmin} run={runAndLoad} onClose={() => setInviting(false)} />}
      {remove && (
        <Sheet title="Zugang entziehen" primary="Entziehen" destructive onCancel={() => setRemove(null)}
          onPrimary={() => runAndLoad(async () => { await api(`/mitglieder/${remove.id}`, { method: 'DELETE' }); setRemove(null); }, `Zugang von ${remove.name} entzogen`)}>
          <p>{remove.name} ({roleLabel(remove.role)}) hat danach keinen Zugriff mehr auf „{info.project.name}“. Auf seinen Geräten verschwindet das Projekt beim nächsten Abgleich. Was er erfasst hat, bleibt erhalten.</p>
        </Sheet>
      )}
    </>
  );
}

function InviteSheet({ info, firmen, firmAdmin, run, onClose }: { info: ProjectInfo; firmen: Data['firmen']; firmAdmin: boolean; run: Run; onClose: () => void }) {
  const [f, setF] = useState({ email: '', name: '', role: (firmAdmin ? 'nu' : 'polier') as ProjectRole, company_id: firmAdmin ? (firmen[0]?.id ?? '') : '' });
  const [link, setLink] = useState<string | null>(null);
  const needsCompany = f.role === 'nu' || f.role === 'bauherr';
  const options = firmen.filter((c) => (f.role === 'nu' ? c.kind === 'nu' : c.kind === 'bauherr'));
  return (
    <Sheet title="Person einladen" primary={link ? 'Fertig' : 'Einladen'} primaryDisabled={!link && (!/^\S+@\S+\.\S+$/.test(f.email) || (needsCompany && !f.company_id))} onCancel={onClose}
      onPrimary={() => (link ? onClose() : run(async () => {
        const r = await api<{ status: string; devLink?: string }>('/einladungen', { method: 'POST', body: { project_id: info.project.id, email: f.email, name: f.name || null, role: f.role, company_id: needsCompany ? f.company_id : null } });
        if (r.status === 'hinzugefuegt') onClose();
        else setLink(r.devLink ?? 'gesendet');
      }, f.email ? `Einladung an ${f.email}` : 'Eingeladen'))}>
      {link ? (
        <div className="group">
          <div className="row stack">
            <span className="k">Die Einladung ist per E-Mail unterwegs.</span>
            {link !== 'gesendet' && <div className="sub" style={{ wordBreak: 'break-all' }}>Lokale Entwicklung – Link: <a href={link}>{link}</a></div>}
          </div>
        </div>
      ) : (
        <>
          <div className="group">
            <div className="row"><span className="k">E-Mail</span><input type="email" autoFocus placeholder="name@firma.de" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="row"><span className="k">Name</span><input placeholder="optional" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            {firmAdmin ? (
              <div className="row"><span className="k">Für</span><span className="v">{firmen[0]?.name} (Nachunternehmer)</span></div>
            ) : (
            <div className="row">
              <span className="k">Rolle</span>
              <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as ProjectRole, company_id: '' })}>
                {ROLES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
              </select>
            </div>
            )}
            {needsCompany && !firmAdmin && (
              <div className="row">
                <span className="k">{f.role === 'nu' ? 'Nachunternehmer' : 'Bauherr (Firma)'}</span>
                <select value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}>
                  <option value="">– wählen –</option>
                  {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
          {needsCompany && options.length === 0 && (
            <div className="footnote">{f.role === 'nu' ? 'Noch kein Nachunternehmer im Projekt – zuerst unter „Nachunternehmer“ anlegen.' : 'Noch keine Bauherren-Firma im Projekt.'}</div>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Role and switchable areas of one person (Leitung: everyone; NU firm admin: own staff, role stays NU). */
function RechteSheet({ m, firmAdmin, onClose, run }: { m: Data['mitglieder'][number]; firmAdmin: boolean; onClose: () => void; run: Run }) {
  const [role, setRole] = useState<ProjectRole>(m.role);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(MODUL_LABELS).map((k) => [k, m[`m_${k as Modul}`] !== false])));
  const roles = ROLES.filter(([r]) => (m.company_kind === 'own' ? ['polier', 'bauleitung', 'projektleitung', 'einkauf'].includes(r) : r === m.company_kind));
  const erlaubt = (MODULE_JE_ROLLE[role as Rolle] ?? []).filter((x) => !firmAdmin || (x !== 'kosten' && x !== 'bautagebuch'));
  return (
    <Sheet title={`Rechte · ${m.name}`} primary="Sichern" onCancel={onClose}
      onPrimary={() => run(async () => {
        const body: Record<string, unknown> = Object.fromEntries(erlaubt.map((x) => [`m_${x}`, on[x]]));
        if (role !== m.role) body.role = role;
        await api(`/mitglieder/${m.id}`, { method: 'PATCH', body });
        onClose();
      }, 'Rechte gespeichert')}>
      {!firmAdmin && roles.length > 1 && (
        <div className="group" style={{ marginBottom: 16 }}>
          <div className="row"><span className="k">Rolle</span>
            <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>{roles.map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select>
          </div>
        </div>
      )}
      <div className="group-title">Bereiche</div>
      <div className="group">
        {erlaubt.map((x) => (
          <label key={x} className="row" style={{ cursor: 'pointer' }}>
            <span className="k">{MODUL_LABELS[x]}</span>
            <input type="checkbox" className="switch" checked={on[x]} onChange={(e) => setOn({ ...on, [x]: e.target.checked })} />
          </label>
        ))}
      </div>
      <div className="footnote">Mängel sieht jede Rolle im eigenen Rahmen. Abgeschaltete Bereiche verschwinden in Web und App; der Server liefert sie nicht mehr aus. Die Änderung steht im Protokoll.</div>
    </Sheet>
  );
}
