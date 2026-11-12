/**
 * Contacts of the firms on site (Vorarbeiter, Monteure). Internal roles see all firms of the project and call them
 * directly; a NU maintains the contacts of his own firm.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface Kontakt { id: string; company_id: string; company: string; name: string; funktion: string | null; telefon: string | null; email: string | null }

export function KontaktePage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [rows, setRows] = useState<Kontakt[]>([]);
  const [edit, setEdit] = useState<Partial<Kontakt> | null>(null);
  const nu = info.role === 'nu';
  const load = useCallback(async () => setRows(await api<Kontakt[]>(`/kontakte?project=${info.project.id}`)), [info.project.id]);
  useEffect(() => void load(), [load]);
  const firms = nu ? [{ id: info.companyId, name: 'Meine Firma' }] : info.companies.filter((c) => c.kind === 'nu');
  const byFirm = [...new Set(rows.map((r) => r.company))].map((f) => [f, rows.filter((r) => r.company === f)] as const);
  return (
    <>
      <PageHeader eyebrow={info.project.name} title={nu ? 'Kontakte meiner Firma' : 'Kontakte'}
        action={(nu || info.role === 'bauleitung') && <button className="btn filled" onClick={() => setEdit({ company_id: firms[0]?.id })}><Icon name="plus" size={16} /> Kontakt</button>} />
      <div className="list-pad" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {byFirm.map(([firma, list]) => (
          <div key={firma}>
            <div className="group-title">{firma}</div>
            <div className="group">
              {list.map((k) => (
                <div key={k.id} className="row">
                  <span className="k">{k.name}<div className="sub">{[k.funktion, k.email].filter(Boolean).join(' · ')}</div></span>
                  <span className="actions">
                    {k.telefon && <a className="btn small" href={`tel:${k.telefon.replace(/[^+0-9]/g, '')}`}>{k.telefon}</a>}
                    {(nu || info.role === 'bauleitung') && <button className="btn small" onClick={() => setEdit(k)}>Bearbeiten</button>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="card pad empty">Noch keine Kontakte{nu ? ' – bitte Vorarbeiter und Monteure auf der Baustelle eintragen.' : '.'}</div>}
        <div className="footnote">{nu ? 'Bitte Vorarbeiter und Monteure eintragen, die auf der Baustelle sind – Bauleitung und Polier rufen sie direkt aus der App an.' : 'Die Nachunternehmer pflegen ihre Kontakte selbst im Portal; auf dem iPhone direkt anrufbar.'}</div>
      </div>
      {edit && (
        <KontaktSheet k={edit} firms={firms} onClose={() => setEdit(null)} run={async (fn, ok) => { await run(fn, ok); await load(); }} />
      )}
    </>
  );
}

function KontaktSheet({ k, firms, onClose, run }: { k: Partial<Kontakt>; firms: { id: string; name: string }[]; onClose: () => void; run: Run }) {
  const [f, setF] = useState({ company_id: k.company_id ?? firms[0]?.id ?? '', name: k.name ?? '', funktion: k.funktion ?? '', telefon: k.telefon ?? '', email: k.email ?? '' });
  return (
    <Sheet title={k.id ? 'Kontakt bearbeiten' : 'Neuer Kontakt'} primary="Sichern" primaryDisabled={f.name.trim().length < 2 || !f.company_id} onCancel={onClose}
      onPrimary={() => run(async () => { await api('/kontakte', { method: 'PUT', body: { id: k.id ?? crypto.randomUUID(), ...f } }); onClose(); }, 'Kontakt gespeichert')}>
      <div className="group">
        {firms.length > 1 && <div className="row"><span className="k">Firma</span><select value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}>{firms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <div className="row"><span className="k">Name</span><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="row"><span className="k">Funktion</span><input placeholder="z. B. Vorarbeiter" value={f.funktion} onChange={(e) => setF({ ...f, funktion: e.target.value })} /></div>
        <div className="row"><span className="k">Telefon</span><input type="tel" placeholder="+49 …" value={f.telefon} onChange={(e) => setF({ ...f, telefon: e.target.value })} /></div>
        <div className="row"><span className="k">E-Mail</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      </div>
      {k.id && <button className="btn plain destructive" style={{ marginTop: 12 }} onClick={() => void run(async () => { await api(`/kontakte/${k.id}`, { method: 'DELETE' }); onClose(); }, 'Kontakt entfernt')}>Kontakt entfernen</button>}
    </Sheet>
  );
}
