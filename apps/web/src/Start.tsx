/** "Was ist zu tun?" – start page of the NU-Portal (docs/fachkonzept/08): everything waiting for the own firm. */
import { useEffect, useState } from 'react';
import { formatDate, formatEuro, MANGEL_STATUS_LABELS, PUNKT_STATUS_LABELS, type MangelStatus, type PunktStatus } from '@bap/domain';
import { api, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader } from './ui/layout';
import { AmpelPill, mNo } from './ui/status';

interface Start {
  role: string;
  maengel: { id: string; number: number; description: string; status: MangelStatus; location: string; due: string | null; esc: { ampel: 'gruen' | 'gelb' | 'rot' | 'grau'; label: string; stage: string; nachfristSuggestion: string | null }; todo: string }[];
  anzeigen: { id: string; no: string; deadline: string; offen: number; positionen: number; sent_at: string }[];
  punkte: { id: string; no: string; text: string; status: PunktStatus; due: string | null; location_name: string | null }[];
  einreichungen: { id: string; kind: 'nachtrag' | 'rechnung'; number: number; title: string; status: string; amount: number }[];
  stunden: { id: string; number: number; period_from: string; period_to: string; status: string }[];
  counts: { ueberfaellig: number; offen: number; punkte: number };
}
const EIN_STATUS: Record<string, string> = { eingereicht: 'Eingereicht', in_pruefung: 'In Prüfung', freigegeben: 'Freigegeben', gf_erforderlich: 'Freigabe GF', abgelehnt: 'Abgelehnt', zurueckgezogen: 'Zurückgezogen' };

export function StartPage({ info, onOpen, onMangel }: { info: ProjectInfo; onOpen: (module: 'maengel' | 'anzeigen' | 'besprechungen' | 'einreichungen' | 'stunden') => void; onMangel: (id: string) => void }) {
  const [d, setD] = useState<Start | null>(null);
  useEffect(() => void api<Start>(`/projects/${info.project.id}/start`).then(setD), [info.project.id]);
  if (!d) return <p className="loading">Wird geladen …</p>;
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Was ist zu tun?" />
      <div className="list-pad start">
        <div className="kpis">
          <div className={`kpi ${d.counts.ueberfaellig ? 'red' : ''}`}><strong>{d.counts.ueberfaellig}</strong><span>überfällige Mängel</span></div>
          <div className="kpi"><strong>{d.counts.offen}</strong><span>Mängel zu beheben</span></div>
          <div className="kpi"><strong>{d.counts.punkte}</strong><span>offene Besprechungspunkte</span></div>
        </div>
        <section>
          <div className="group-head"><h3>Mängel</h3><button className="btn plain small" onClick={() => onOpen('maengel')}>Alle anzeigen</button></div>
          <div className="group">
            {d.maengel.map((m) => (
              <button key={m.id} className="row action" style={{ color: 'var(--label)' }} onClick={() => onMangel(m.id)}>
                <span className="k">
                  <strong className="tabular">{mNo(m.number)}</strong> {m.description}
                  <div className="sub">{m.location} · {MANGEL_STATUS_LABELS[m.status]} · <strong>{m.todo}</strong>{m.due ? ` · Frist ${formatDate(m.due)}` : ''}</div>
                </span>
                <AmpelPill e={m.esc} />
              </button>
            ))}
            {d.maengel.length === 0 && <div className="empty">Keine offenen Mängel – sehr gut.</div>}
          </div>
        </section>
        {d.anzeigen.length > 0 && (
          <section>
            <div className="group-head"><h3>Mangelanzeigen</h3><button className="btn plain small" onClick={() => onOpen('anzeigen')}>Öffnen</button></div>
            <div className="group">
              {d.anzeigen.map((a) => (
                <div key={a.id} className="row"><span className="k">{a.no}<div className="sub">erhalten {formatDate(a.sent_at)} · Frist {formatDate(a.deadline)}</div></span><span className="v">{a.offen} von {a.positionen} offen</span></div>
              ))}
            </div>
          </section>
        )}
        <section>
          <div className="group-head"><h3>Besprechungspunkte</h3><button className="btn plain small" onClick={() => onOpen('besprechungen')}>Besprechungen</button></div>
          <div className="group">
            {d.punkte.map((p) => (
              <div key={p.id} className="row"><span className="k"><strong className="tabular">{p.no}</strong> {p.text}<div className="sub">{p.location_name ?? 'Allgemein'} · {PUNKT_STATUS_LABELS[p.status]}</div></span><span className="v">{p.due ? formatDate(p.due) : '–'}</span></div>
            ))}
            {d.punkte.length === 0 && <div className="empty">Keine offenen Punkte</div>}
          </div>
        </section>
        {d.role === 'nu' && (
          <section>
            <div className="group-head"><h3>Meine Einreichungen</h3><button className="btn plain small" onClick={() => onOpen('einreichungen')}><Icon name="plus" size={14} /> Nachtrag / Rechnung</button></div>
            <div className="group">
              {d.einreichungen.map((e) => (
                <div key={e.id} className="row"><span className="k">{e.kind === 'nachtrag' ? 'NT' : 'RE'}-{String(e.number).padStart(3, '0')} · {e.title}<div className="sub">{formatEuro(e.amount)}</div></span><span className="v">{EIN_STATUS[e.status] ?? e.status}</span></div>
              ))}
              {d.stunden.map((z) => (
                <button key={z.id} className="row action" style={{ color: 'var(--label)' }} onClick={() => onOpen('stunden')}>
                  <span className="k">Stundenzettel {formatDate(z.period_from)} – {formatDate(z.period_to)}</span><span className="v">{z.status}</span>
                </button>
              ))}
              {d.einreichungen.length + d.stunden.length === 0 && <div className="empty">Noch nichts eingereicht</div>}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
