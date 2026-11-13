/**
 * Role start pages (decided 13.11.2026, docs/fachkonzept/15): each role sees first what its day is about.
 * PolierCockpit: "Heute auf der Baustelle".
 */
import { useEffect, useState, type ReactNode } from 'react';
import { BANF_LABEL, FOTODOKU_LABEL, PUNKT_STATUS_LABELS, formatDate, type BanfStatus, type Escalation, type FotodokuKategorie, type PunktStatus } from '@bap/domain';
import { api, getToken, type ProjectInfo } from './api';
import { Icon, type IconName } from './ui/Icon';
import { PageHeader } from './ui/layout';
import { AmpelPill, mNo } from './ui/status';

export type Ziel = 'maengel' | 'bautagebuch' | 'besprechungen' | 'bestellungen' | 'fotodoku' | 'plaene';
interface MangelKurz { id: string; number: number; description: string; status: string; ort: string; firma: string | null; due: string | null; esc: Escalation }
interface PolierDaten {
  heute: { id: string; status: string } | null;
  berichte: { offen_alt: number; letzter: string | null };
  zahlen: { offen: number; ueberfaellig: number; pruefen: number; ohne_firma: number; punkte: number; fotos_woche: number };
  pruefen: MangelKurz[]; ueberfaellig: MangelKurz[];
  punkte: { id: string; no: string; text: string; status: PunktStatus; due: string; firma: string | null; ort: string | null }[];
  termin: { id: string; number: number; next_at: string } | null;
  lieferungen: { id: string; number: number; titel: string; status: BanfStatus; lieferant: string | null; liefertermin: string | null; benoetigt_am: string | null; meine: boolean }[];
  fotos: { id: string; titel: string | null; kategorie: FotodokuKategorie; ist_360: boolean; taken_at: string; hochgeladen: boolean; ort: string | null }[];
}

const heuteText = () => new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
const istHeute = (d: string | null) => !!d && d <= new Date().toISOString().slice(0, 10);

export function Kachel({ n, label, tone, onClick }: { n: number | string; label: string; tone?: string; onClick?: () => void }) {
  return (
    <button className="card kpi kpi-btn" onClick={onClick} disabled={!onClick}>
      <div className="kpi-n" style={{ color: n ? tone ?? 'var(--label)' : 'var(--label-3)' }}>{n}</div><div className="sub">{label}</div>
    </button>
  );
}
export function Abschnitt({ titel, mehr, onMehr, children }: { titel: string; mehr?: string; onMehr?: () => void; children: ReactNode }) {
  return (
    <section className="cockpit-sec">
      <div className="group-head"><h3>{titel}</h3>{onMehr && <button className="btn plain small" onClick={onMehr}>{mehr ?? 'Alle'}</button>}</div>
      <div className="group">{children}</div>
    </section>
  );
}
function Schnell({ icon, label, onClick, primary }: { icon: IconName; label: string; onClick: () => void; primary?: boolean }) {
  return <button className={`btn ${primary ? 'filled' : ''} schnell`} onClick={onClick}><Icon name={icon} size={18} />{label}</button>;
}
function Vorschau({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void fetch(`/api/fotodoku/${id}/datei?vorschau=1`, { headers: { authorization: `Bearer ${getToken()}` } }).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) setUrl((u = URL.createObjectURL(b))); });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id]);
  return url ? <img src={url} alt="" /> : null;
}

export function PolierCockpit({ info, onOpen, onMangel }: { info: ProjectInfo; onOpen: (z: Ziel, id?: string) => void; onMangel: (id: string) => void }) {
  const [d, setD] = useState<PolierDaten | null>(null);
  useEffect(() => void api<PolierDaten>(`/projects/${info.project.id}/cockpit/polier`).then(setD), [info.project.id]);
  if (!d) return <p className="loading">Wird geladen …</p>;
  const z = d.zahlen;
  const mangelZeile = (m: MangelKurz, hinweis: string) => (
    <button key={m.id} className="row action" style={{ color: 'var(--label)' }} onClick={() => onMangel(m.id)}>
      <span className="k"><strong className="tabular">{mNo(m.number)}</strong> {m.description}<div className="sub">{m.ort}{m.firma ? ` · ${m.firma}` : ''} · {hinweis}{m.due ? ` · Frist ${formatDate(m.due)}` : ''}</div></span>
      <AmpelPill e={m.esc} />
    </button>
  );
  return (
    <>
      <PageHeader eyebrow={`${info.project.name} · ${heuteText()}`} title="Heute auf der Baustelle" />
      <div className="list-pad cockpit">
        <div className="schnell-row">
          <Schnell primary icon="kalender" label={d.heute ? (d.heute.status === 'unterschrieben' ? 'Tagesbericht ansehen' : 'Tagesbericht weiterschreiben') : 'Tagesbericht beginnen'} onClick={() => onOpen('bautagebuch')} />
          <Schnell icon="mangel" label="Mangel erfassen" onClick={() => onOpen('plaene')} />
          <Schnell icon="kamera" label="Foto dokumentieren" onClick={() => onOpen('fotodoku')} />
          <Schnell icon="paket" label="Material anfordern" onClick={() => onOpen('bestellungen')} />
        </div>
        {(d.berichte.offen_alt > 0 || !d.heute) && (
          <div className="hinweis-band">
            <Icon name="hinweis" size={18} />
            {!d.heute && <span>Für heute gibt es noch keinen Tagesbericht.</span>}
            {d.berichte.offen_alt > 0 && <span>{d.berichte.offen_alt} ältere Tagesberichte sind noch nicht unterschrieben.</span>}
          </div>
        )}
        <div className="kpi-row">
          <Kachel n={z.pruefen} label="Mängel zur Abnahme prüfen" tone="var(--orange)" onClick={() => onOpen('maengel')} />
          <Kachel n={z.ueberfaellig} label="Mängel überfällig" tone="var(--red)" onClick={() => onOpen('maengel')} />
          <Kachel n={z.offen} label="Mängel offen" onClick={() => onOpen('maengel')} />
          <Kachel n={z.punkte} label="Punkte fällig (7 Tage)" tone="var(--orange)" onClick={() => onOpen('besprechungen')} />
          <Kachel n={z.fotos_woche} label="Fotos diese Woche" onClick={() => onOpen('fotodoku')} />
        </div>
        <div className="cockpit-grid">
          <Abschnitt titel="Zur Abnahme prüfen" onMehr={() => onOpen('maengel')}>
            {d.pruefen.map((m) => mangelZeile(m, 'als behoben gemeldet'))}
            {!d.pruefen.length && <div className="empty">Nichts zu prüfen.</div>}
          </Abschnitt>
          <Abschnitt titel="Überfällige Mängel" onMehr={() => onOpen('maengel')}>
            {d.ueberfaellig.map((m) => mangelZeile(m, 'überfällig'))}
            {!d.ueberfaellig.length && <div className="empty">Keine überfälligen Mängel.</div>}
          </Abschnitt>
          <Abschnitt titel={d.termin ? `Besprechungspunkte · nächste Besprechung ${new Date(d.termin.next_at).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Fällige Besprechungspunkte'} onMehr={() => onOpen('besprechungen')}>
            {d.punkte.map((p) => (
              <button key={p.id} className="row action" style={{ color: 'var(--label)' }} onClick={() => onOpen('besprechungen')}>
                <span className="k"><strong className="tabular">{p.no}</strong> {p.text}<div className="sub">{p.firma ?? 'Allgemein'}{p.ort ? ` · ${p.ort}` : ''} · {PUNKT_STATUS_LABELS[p.status]}</div></span>
                <span className="v" style={{ color: istHeute(p.due) ? 'var(--red)' : undefined }}>{formatDate(p.due)}</span>
              </button>
            ))}
            {!d.punkte.length && <div className="empty">Keine Punkte in den nächsten 7 Tagen fällig.</div>}
          </Abschnitt>
          <Abschnitt titel="Lieferungen & meine Anforderungen" onMehr={() => onOpen('bestellungen')}>
            {d.lieferungen.map((b) => (
              <button key={b.id} className="row action" style={{ color: 'var(--label)' }} onClick={() => onOpen('bestellungen', b.id)}>
                <span className="k">{b.titel}<div className="sub">Nr. {b.number} · {b.status === 'bestellt' ? `${b.lieferant ?? 'Lieferant offen'}` : BANF_LABEL[b.status]}{b.meine ? ' · von mir' : ''}</div></span>
                <span className="v">{b.status === 'bestellt' ? (b.liefertermin ? `Lieferung ${formatDate(b.liefertermin)}` : 'bestellt') : b.benoetigt_am ? `bis ${formatDate(b.benoetigt_am)}` : ''}</span>
              </button>
            ))}
            {!d.lieferungen.length && <div className="empty">Keine Lieferungen in den nächsten 7 Tagen.</div>}
          </Abschnitt>
        </div>
        {d.fotos.length > 0 && (
          <Abschnitt titel="Zuletzt dokumentiert" onMehr={() => onOpen('fotodoku')}>
            <div className="cockpit-fotos">
              {d.fotos.map((f) => (
                <button key={f.id} className="doku-kachel" onClick={() => onOpen('fotodoku')}>
                  {f.hochgeladen && <Vorschau id={f.id} />}
                  {f.ist_360 && <span className="doku-360">360°</span>}
                  <span className="doku-cap">{f.titel || FOTODOKU_LABEL[f.kategorie]}<small>{f.ort ? `${f.ort} · ` : ''}{formatDate(f.taken_at)}</small></span>
                </button>
              ))}
            </div>
          </Abschnitt>
        )}
      </div>
    </>
  );
}

interface LeitungProjekt {
  id: string; name: string; zu_tun: number; maengel_offen: number; maengel_ueberfaellig: number; maengel_pruefen: number; maengel_neu: number;
  berichte: number; einkaeufe: number; einreichungen: number; ueber_grenze: number; stunden: number; anforderungen: number;
  naechste_besprechung: string | null; letzter_bericht: string | null;
}
interface LeitungDaten { projekte: LeitungProjekt[]; summe: Record<string, number> }
export type LeitungZiel = 'maengel' | 'bautagebuch' | 'einkaeufe' | 'einreichungen' | 'stunden' | 'bestellungen' | 'besprechungen' | 'heute';

/** Bau-/Projektleitung: all own projects with what waits for a decision; a click opens the project at the right place. */
export function LeitungCockpit({ onOpen, onNeu }: { onOpen: (projectId: string, z: LeitungZiel) => void; onNeu?: () => void }) {
  const [d, setD] = useState<LeitungDaten | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => void api<LeitungDaten>('/cockpit/leitung').then(setD), []);
  if (!d) return <p className="loading">Wird geladen …</p>;
  const s = d.summe;
  const rows = d.projekte.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const zelle = (p: LeitungProjekt, n: number, z: LeitungZiel, tone = 'var(--orange)') => (
    <td className="money"><button className="zelle" disabled={!n} style={{ color: n ? tone : 'var(--label-3)' }} onClick={(e) => { e.stopPropagation(); onOpen(p.id, z); }}>{n || '–'}</button></td>
  );
  return (
    <>
      <PageHeader eyebrow={`${d.projekte.length} Projekte`} title="Übersicht" action={onNeu && <button className="btn" onClick={onNeu}><Icon name="plus" size={16} /> Neues Projekt</button>} />
      <div className="list-pad cockpit">
        <div className="kpi-row">
          <Kachel n={s.zu_tun ?? 0} label="Entscheidungen offen" tone="var(--accent)" />
          <Kachel n={s.maengel_pruefen ?? 0} label="Mängel abnehmen" tone="var(--orange)" />
          <Kachel n={s.berichte ?? 0} label="Tagesberichte gegenzeichnen" tone="var(--orange)" />
          <Kachel n={(s.einreichungen ?? 0) + (s.stunden ?? 0)} label="Nachträge, Rechnungen, Stunden prüfen" tone="var(--orange)" />
          <Kachel n={s.maengel_ueberfaellig ?? 0} label="Mängel überfällig" tone="var(--red)" />
        </div>
        {d.projekte.length > 6 && <label className="search" style={{ flex: 'none', maxWidth: 360 }}><Icon name="suche" size={16} /><input placeholder="Projekt suchen" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table leitung-table">
            <thead><tr>
              <th>Projekt</th><th className="money">Zu tun</th><th className="money">Mängel prüfen</th><th className="money">neu</th><th className="money">überfällig</th>
              <th className="money">Tages­berichte</th><th className="money">Einkäufe</th><th className="money">Nachträge / Rechn.</th><th className="money">Stunden</th><th className="money">Anforde­rungen</th><th>Nächste Besprechung</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} onClick={() => onOpen(p.id, 'heute')}>
                  <td><strong>{p.name}</strong><div className="sub">{p.maengel_offen} Mängel offen{p.letzter_bericht ? ` · letzter Bericht ${formatDate(p.letzter_bericht)}` : ''}{p.ueber_grenze ? ` · ${p.ueber_grenze} über Freigabegrenze` : ''}</div></td>
                  <td className="money">{p.zu_tun ? <span className="pill c-blue">{p.zu_tun}</span> : <span className="sub">–</span>}</td>
                  {zelle(p, p.maengel_pruefen, 'maengel')}
                  {zelle(p, p.maengel_neu, 'maengel', 'var(--accent)')}
                  {zelle(p, p.maengel_ueberfaellig, 'maengel', 'var(--red)')}
                  {zelle(p, p.berichte, 'bautagebuch')}
                  {zelle(p, p.einkaeufe, 'einkaeufe')}
                  {zelle(p, p.einreichungen, 'einreichungen')}
                  {zelle(p, p.stunden, 'stunden')}
                  {zelle(p, p.anforderungen, 'bestellungen', 'var(--accent)')}
                  <td>{p.naechste_besprechung ? <button className="zelle" onClick={(e) => { e.stopPropagation(); onOpen(p.id, 'besprechungen'); }}>{new Date(p.naechste_besprechung).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</button> : <span className="sub">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="footnote">Projekte mit offenen Entscheidungen stehen oben. Ein Klick auf eine Zahl öffnet das Projekt genau dort, ein Klick auf die Zeile „Heute im Projekt“.</div>
      </div>
    </>
  );
}
