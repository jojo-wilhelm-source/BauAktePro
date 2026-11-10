/** Nachunternehmer-Verzeichnis: contacts, Gewerke, contracts, and at a glance Mängel, Punkte, hours, money (Leitung). */
import { useCallback, useEffect, useState } from 'react';
import { formatDate, formatEuro } from '@bap/domain';
import { api, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface Nu {
  id: string; name: string; email: string | null; phone: string | null; contact_person: string | null; address: string | null;
  gewerke: string[]; gewerk_ids: string[]; zugaenge: number; maengel_offen: number; maengel_ueberfaellig: number; stunden_anerkannt: number; punkte_offen: number;
  vertraege: { id: string; title: string; amount: number; signed_on: string | null; gewerk_name: string | null }[];
  auftrag: number | null; nachtraege_beauftragt: number | null; nachtraege_offen: number | null; abgerechnet: number | null;
}

export function NachunternehmerPage({ info, run, onReload }: { info: ProjectInfo; run: Run; onReload: () => void }) {
  const [list, setList] = useState<Nu[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Nu | 'new' | null>(null);
  const [vertrag, setVertrag] = useState<Nu | null>(null);
  const [q, setQ] = useState('');
  const leitung = info.role === 'bauleitung';
  const reload = useCallback(async () => setList((await api<{ nu: Nu[] }>(`/projects/${info.project.id}/nachunternehmer`)).nu), [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const runAndReload: Run = async (fn, ok) => {
    await run(fn, ok);
    await reload();
    onReload();
  };
  const shown = list.filter((n) => !q || `${n.name} ${n.gewerke.join(' ')} ${n.contact_person ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const cur = list.find((n) => n.id === sel) ?? null;

  return (
    <>
      <PageHeader
        eyebrow={info.project.name}
        title="Nachunternehmer"
        action={leitung && <button className="btn filled" onClick={() => setEdit('new')}><Icon name="plus" size={16} /> Nachunternehmer</button>}
      >
        <label className="search"><Icon name="suche" size={16} /><input placeholder="Suchen" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </PageHeader>
      <div className="split">
        <div className="card">
          <table className="table">
            <thead><tr><th>Firma</th><th>Gewerk</th><th>Mängel</th><th>Punkte</th>{leitung && <th className="money">Auftrag + NT</th>}</tr></thead>
            <tbody>
              {shown.map((n) => (
                <tr key={n.id} className={n.id === sel ? 'selected' : ''} onClick={() => setSel(n.id)}>
                  <td><div className="desc">{n.name}</div><div className="sub">{n.contact_person ?? '–'}{n.zugaenge ? '' : ' · ohne Zugang'}</div></td>
                  <td>{n.gewerke.join(', ') || <span className="sub">–</span>}</td>
                  <td>{n.maengel_offen} offen{n.maengel_ueberfaellig > 0 && <span className="pill c-red" style={{ marginLeft: 6 }}>{n.maengel_ueberfaellig} überfällig</span>}</td>
                  <td className="tabular">{n.punkte_offen}</td>
                  {leitung && <td className="money">{formatEuro((n.auftrag ?? 0) + (n.nachtraege_beauftragt ?? 0))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">Keine Nachunternehmer</div>}
        </div>
        <div className="inspector">
          {!cur ? (
            <div className="placeholder"><Icon name="firmen" size={40} /><div>Nachunternehmer auswählen</div></div>
          ) : (
            <>
              <div><div className="head"><span className="num">{cur.gewerke.join(' · ')}</span></div><h2>{cur.name}</h2></div>
              <div className="group">
                <div className="row"><span className="k">Ansprechpartner</span><span className="v">{cur.contact_person ?? '–'}</span></div>
                <div className="row"><span className="k">Telefon</span><span className="v">{cur.phone ? <a href={`tel:${cur.phone}`}>{cur.phone}</a> : '–'}</span></div>
                <div className="row"><span className="k">E-Mail</span><span className="v">{cur.email ? <a href={`mailto:${cur.email}`}>{cur.email}</a> : '–'}</span></div>
                <div className="row"><span className="k">Adresse</span><span className="v">{cur.address ?? '–'}</span></div>
                <div className="row"><span className="k">Zugänge</span><span className="v">{cur.zugaenge || 'noch keiner'}</span></div>
              </div>
              <div>
                <div className="group-title">Auf der Baustelle</div>
                <div className="group">
                  <div className="row"><span className="k">Offene Mängel</span><span className="v">{cur.maengel_offen} ({cur.maengel_ueberfaellig} überfällig)</span></div>
                  <div className="row"><span className="k">Offene Besprechungspunkte</span><span className="v">{cur.punkte_offen}</span></div>
                  <div className="row"><span className="k">Anerkannte Stunden</span><span className="v">{cur.stunden_anerkannt.toLocaleString('de-DE')} h</span></div>
                </div>
              </div>
              {leitung && (
                <div>
                  <div className="group-title">Verträge und Geld (netto)</div>
                  <div className="group">
                    {cur.vertraege.map((v) => (
                      <div key={v.id} className="row"><span className="k">{v.title}<div className="sub">{v.gewerk_name ?? ''}{v.signed_on ? ` · ${formatDate(v.signed_on)}` : ''}</div></span><span className="v money">{formatEuro(v.amount)}</span></div>
                    ))}
                    <div className="row"><span className="k">Nachträge beauftragt</span><span className="v money">{formatEuro(cur.nachtraege_beauftragt ?? 0)}</span></div>
                    <div className="row"><span className="k">Nachträge offen</span><span className="v money">{formatEuro(cur.nachtraege_offen ?? 0)}</span></div>
                    <div className="row"><span className="k">Abgerechnet (freigegeben)</span><span className="v money">{formatEuro(cur.abgerechnet ?? 0)}</span></div>
                    <button className="row action" onClick={() => setVertrag(cur)}>Vertrag erfassen <Icon name="plus" size={16} /></button>
                  </div>
                </div>
              )}
              {leitung && <div className="group"><button className="row action" onClick={() => setEdit(cur)}>Kontaktdaten bearbeiten <Icon name="stift" size={16} /></button></div>}
            </>
          )}
        </div>
      </div>
      {edit && <NuSheet info={info} nu={edit === 'new' ? null : edit} run={runAndReload} onClose={() => setEdit(null)} />}
      {vertrag && <VertragSheet info={info} nu={vertrag} run={runAndReload} onClose={() => setVertrag(null)} />}
    </>
  );
}

function NuSheet({ info, nu, run, onClose }: { info: ProjectInfo; nu: Nu | null; run: Run; onClose: () => void }) {
  const [f, setF] = useState({ name: nu?.name ?? '', contact_person: nu?.contact_person ?? '', phone: nu?.phone ?? '', email: nu?.email ?? '', address: nu?.address ?? '', gewerk_ids: nu?.gewerk_ids ?? [] as string[] });
  const field = (k: 'name' | 'contact_person' | 'phone' | 'email' | 'address', label: string, ph = '') => (
    <div className="row"><span className="k">{label}</span><input placeholder={ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <Sheet title={nu ? nu.name : 'Neuer Nachunternehmer'} primary="Sichern" primaryDisabled={!f.name.trim()} onCancel={onClose}
      onPrimary={() => run(async () => { await api('/nachunternehmer', { method: 'PUT', body: { ...f, id: nu?.id ?? crypto.randomUUID(), project_id: info.project.id } }); onClose(); }, 'Nachunternehmer gespeichert')}>
      <div className="group">
        {field('name', 'Firma', 'z. B. Maler Meier GmbH')}
        {field('contact_person', 'Ansprechpartner')}
        {field('phone', 'Telefon')}
        {field('email', 'E-Mail', 'für Mangelanzeigen und Protokolle')}
        {field('address', 'Adresse')}
      </div>
      <div>
        <div className="group-title">Gewerke</div>
        <div className="group"><div className="row tokens">
          {info.gewerke.map((g) => (
            <button key={g.id} className={`token ${f.gewerk_ids.includes(g.id) ? 'on' : ''}`} onClick={() => setF({ ...f, gewerk_ids: f.gewerk_ids.includes(g.id) ? f.gewerk_ids.filter((x) => x !== g.id) : [...f.gewerk_ids, g.id] })}>{g.name}</button>
          ))}
        </div></div>
        <div className="footnote">Über das Gewerk wird der Nachunternehmer bei neuen Mängeln vorgeschlagen. Einen Zugang zum Portal bekommt er separat.</div>
      </div>
    </Sheet>
  );
}

function VertragSheet({ info, nu, run, onClose }: { info: ProjectInfo; nu: Nu; run: Run; onClose: () => void }) {
  const [f, setF] = useState({ title: '', amount: '', gewerk_id: nu.gewerk_ids[0] ?? '', signed_on: '' });
  const amount = Number(f.amount.replace(/\./g, '').replace(',', '.'));
  return (
    <Sheet title={`Vertrag ${nu.name}`} primary="Sichern" primaryDisabled={!f.title.trim() || !(amount >= 0) || f.amount === ''} onCancel={onClose}
      onPrimary={() => run(async () => { await api('/vertraege', { method: 'POST', body: { project_id: info.project.id, company_id: nu.id, title: f.title, amount_net: amount, gewerk_id: f.gewerk_id || null, signed_on: f.signed_on || null } }); onClose(); }, 'Vertrag erfasst')}>
      <div className="group">
        <div className="row"><span className="k">Bezeichnung</span><input placeholder="z. B. Malerarbeiten Haus A" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="row"><span className="k">Auftragssumme netto (€)</span><input inputMode="decimal" placeholder="0,00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div className="row"><span className="k">Gewerk</span><select value={f.gewerk_id} onChange={(e) => setF({ ...f, gewerk_id: e.target.value })}><option value="">–</option>{info.gewerke.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        <div className="row"><span className="k">Unterschrieben am</span><input type="date" value={f.signed_on} onChange={(e) => setF({ ...f, signed_on: e.target.value })} /></div>
      </div>
    </Sheet>
  );
}
