/** Mangelanzeigen (docs/fachkonzept/04-maengel.md): list, draft, PDF preview, send (locks the Anzeige). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { anzeigeNo, ANZEIGE_STATUS_LABELS, canBePosition, formatDate, MANGEL_STATUS_LABELS, proposeDeadline } from '@bap/domain';
import { api, openPdf, type AnzeigeDetail, type AnzeigeListItem, type Mangel, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';
import { mNo, StatusPill } from './ui/status';
import { Foto } from './ui/Foto';

export interface AnzeigeStart {
  companyId: string;
  mangelIds?: string[];
}

export function AnzeigenPage(props: {
  info: ProjectInfo;
  maengel: Mangel[];
  run: Run;
  start: AnzeigeStart | null;
  onStartHandled: () => void;
  onOpenMangel: (id: string) => void;
}) {
  const { info, run } = props;
  const [list, setList] = useState<AnzeigeListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Opened from a Mangel ("Mangelanzeige erstellen"): the page mounts with the sheet already open.
  const [creating, setCreating] = useState<AnzeigeStart | null>(props.start);
  const isBauleitung = info.role === 'bauleitung';

  const reload = useCallback(async () => setList(await api<AnzeigeListItem[]>(`/projects/${info.project.id}/mangelanzeigen`)), [info.project.id]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    if (props.start) props.onStartHandled();
  }, [props.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAndReload: Run = async (fn, ok) => {
    await run(fn, ok);
    await reload();
  };

  return (
    <>
      <PageHeader
        eyebrow={info.project.name}
        title="Mangelanzeigen"
        action={
          isBauleitung && (
            <button className="btn filled" onClick={() => setCreating({ companyId: '' })}>
              <Icon name="plus" size={16} /> Neue Mangelanzeige
            </button>
          )
        }
      />
      <div className="split">
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Nachunternehmer</th>
                <th>Positionen</th>
                <th>Frist</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className={a.id === selected ? 'selected' : ''} onClick={() => setSelected(a.id)}>
                  <td className="num">{anzeigeNo(a.number)}</td>
                  <td>
                    <div className="desc">{a.company_name}</div>
                    <div className="sub">{a.recipient_email ?? 'keine E-Mail hinterlegt'}</div>
                  </td>
                  <td className="tabular">{a.positions}</td>
                  <td className="tabular">{formatDate(a.deadline)}</td>
                  <td>
                    <span className={`pill ${a.status === 'versendet' ? 'c-green' : 'c-orange'}`}>{ANZEIGE_STATUS_LABELS[a.status]}</span>
                    {a.sent_at && <div className="sub">{formatDate(a.sent_at)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && (
            <div className="placeholder">
              <Icon name="anzeige" size={40} />
              <div>Noch keine Mangelanzeigen</div>
              {isBauleitung && <div className="sub">Mängel eines Nachunternehmers zusammenfassen und als PDF verschicken.</div>}
            </div>
          )}
        </div>
        <AnzeigeInspector id={selected} info={info} run={runAndReload} onOpenMangel={props.onOpenMangel} />
      </div>
      {creating && (
        <NewAnzeigeSheet
          info={info}
          maengel={props.maengel}
          start={creating}
          onCancel={() => setCreating(null)}
          onSave={(body) =>
            runAndReload(async () => {
              await api('/mangelanzeigen', { method: 'POST', body });
              setCreating(null);
              setSelected(body.id);
            }, 'Entwurf gespeichert')
          }
        />
      )}
    </>
  );
}

function AnzeigeInspector({ id, info, run, onOpenMangel }: { id: string | null; info: ProjectInfo; run: Run; onOpenMangel: (id: string) => void }) {
  const [a, setA] = useState<AnzeigeDetail | null>(null);
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(async () => setA(id ? await api<AnzeigeDetail>(`/mangelanzeigen/${id}`) : null), [id]);
  useEffect(() => void load(), [load]);

  if (!a)
    return (
      <div className="inspector">
        <div className="placeholder">
          <Icon name="anzeige" size={40} />
          <div>Mangelanzeige auswählen</div>
        </div>
      </div>
    );
  const draft = a.status === 'entwurf';
  const to = a.recipient_email ?? a.company_email;
  return (
    <div className="inspector">
      <div>
        <div className="head">
          <span className="num">{a.anzeige_no}</span>
          <span className={`pill ${draft ? 'c-orange' : 'c-green'}`}>{ANZEIGE_STATUS_LABELS[a.status]}</span>
        </div>
        <h2>{a.company_name}</h2>
      </div>
      <div className="group">
        <div className="row">
          <span className="k">Frist</span>
          <span className="v tabular">{formatDate(a.deadline)}</span>
        </div>
        <div className="row">
          <span className="k">Empfänger</span>
          <span className="v">{to ?? '–'}</span>
        </div>
        <div className="row">
          <span className="k">Erstellt von</span>
          <span className="v">{a.created_by_name}</span>
        </div>
        {a.sent_at && (
          <div className="row">
            <span className="k">Versendet</span>
            <span className="v">
              {new Date(a.sent_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} · {a.sent_by_name}
            </span>
          </div>
        )}
      </div>
      {a.note && (
        <div>
          <div className="group-title">Hinweis im Schreiben</div>
          <div className="group">
            <div className="row">{a.note}</div>
          </div>
        </div>
      )}
      <div>
        <div className="group-title">Positionen</div>
        <div className="group">
          {a.positions.map((p) => (
            <button key={p.mangel_id} className="row action" style={{ color: 'var(--label)' }} onClick={() => onOpenMangel(p.mangel_id)}>
              <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', minWidth: 0 }}>
                <strong className="tabular">{p.pos}.</strong>
                <span>
                  {p.description}
                  <div className="sub">
                    {mNo(p.number)} · {p.location_name}
                  </div>
                </span>
              </span>
              <StatusPill status={p.status} />
            </button>
          ))}
        </div>
      </div>
      {!draft && <FreimeldungenSection anzeigeId={a.id} info={info} run={run} onChanged={load} />}
      {!draft && info.role === 'bauleitung' && <LinkSection anzeigeId={a.id} run={run} />}
      <div className="group">
        <button className="row action" onClick={() => run(() => openPdf(`/mangelanzeigen/${a.id}/pdf`), draft ? 'Vorschau geöffnet' : 'PDF geöffnet')}>
          {draft ? 'PDF-Vorschau' : 'PDF öffnen'}
          <Icon name="anzeige" size={18} />
        </button>
        {draft && info.role === 'bauleitung' && (
          <button className="row action primary" disabled={!to} onClick={() => setConfirm(true)}>
            Versenden …
            <Icon name="chevron" size={16} />
          </button>
        )}
      </div>
      <div className="footnote">
        {draft
          ? 'Entwurf: noch änderbar. Nach dem Versand ist die Anzeige gesperrt; Korrekturen werden eine neue Anzeige.'
          : 'Versendet und gesperrt. Die Frist wurde für alle Positionen übernommen.'}
      </div>
      {confirm && (
        <Sheet
          title="Mangelanzeige versenden"
          primary="Versenden"
          onCancel={() => setConfirm(false)}
          onPrimary={() =>
            run(async () => {
              await api(`/mangelanzeigen/${a.id}/send`, { method: 'POST', body: { base_version: a.version } });
              setConfirm(false);
              await load();
            }, `Mangelanzeige an ${to} versendet`)
          }
        >
          <div className="group">
            <div className="row">
              <span className="k">An</span>
              <span className="v">{to}</span>
            </div>
            <div className="row">
              <span className="k">Positionen</span>
              <span className="v">{a.positions.length}</span>
            </div>
            <div className="row">
              <span className="k">Frist</span>
              <span className="v">{formatDate(a.deadline)}</span>
            </div>
          </div>
          <div className="footnote">
            Die Anzeige bekommt eine Nummer, wird als PDF per E-Mail verschickt und danach gesperrt. Die Frist gilt dann für alle Positionen. Der Versand wird
            im Protokoll festgehalten.
          </div>
        </Sheet>
      )}
    </div>
  );
}

function NewAnzeigeSheet(props: {
  info: ProjectInfo;
  maengel: Mangel[];
  start: AnzeigeStart;
  onCancel: () => void;
  onSave: (body: { id: string; project_id: string; company_id: string; mangel_ids: string[]; deadline: string; recipient_email: string | null; note: string | null }) => void;
}) {
  const { info, maengel } = props;
  const nus = info.companies.filter((c) => c.kind === 'nu');
  const [companyId, setCompanyId] = useState(props.start.companyId || nus[0]?.id || '');
  const company = nus.find((c) => c.id === companyId);
  const eligible = useMemo(() => maengel.filter((m) => canBePosition(m, companyId)), [maengel, companyId]);
  const [picked, setPicked] = useState<Set<string>>(new Set(props.start.mangelIds ?? []));
  const [deadline, setDeadline] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');

  // New NU: preselect all its open Mängel (unless the sheet was opened for specific ones), propose deadline and address.
  useEffect(() => {
    const ids = props.start.mangelIds?.length && companyId === props.start.companyId ? props.start.mangelIds : eligible.map((m) => m.id);
    setPicked(new Set(ids));
    setDeadline(proposeDeadline(eligible.filter((m) => ids.includes(m.id)).map((m) => m.nachfrist_date ?? m.due_date)));
    setEmail(company?.email ?? '');
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const ids = eligible.filter((m) => picked.has(m.id)).map((m) => m.id); // keeps the list order as position order

  return (
    <Sheet
      title="Neue Mangelanzeige"
      primary="Als Entwurf sichern"
      primaryDisabled={!companyId || ids.length === 0 || !deadline}
      onCancel={props.onCancel}
      onPrimary={() =>
        props.onSave({
          id: crypto.randomUUID(),
          project_id: info.project.id,
          company_id: companyId,
          mangel_ids: ids,
          deadline,
          recipient_email: email.trim() || null,
          note: note.trim() || null,
        })
      }
    >
      <div className="group">
        <div className="row">
          <span className="k">Nachunternehmer</span>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {nus.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span className="k">E-Mail</span>
          <input type="email" value={email} placeholder="adresse@firma.de" onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="row">
          <span className="k">Frist</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <div>
        <div className="group-title">Positionen ({ids.length})</div>
        <div className="group">
          {eligible.map((m) => (
            <label key={m.id} className="row" style={{ cursor: 'pointer', justifyContent: 'flex-start' }}>
              <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} style={{ maxWidth: 'none' }} />
              <span style={{ flex: 1 }}>
                {m.description}
                <div className="sub">
                  {mNo(m.number)} · {m.location_name} · {MANGEL_STATUS_LABELS[m.status]} · Frist {formatDate(m.nachfrist_date ?? m.due_date)}
                </div>
              </span>
            </label>
          ))}
          {eligible.length === 0 && <div className="row sub">Keine offenen, bestätigt zugewiesenen Mängel für diesen Nachunternehmer.</div>}
        </div>
        <div className="footnote">Reihenfolge = Positionsnummer. Nur offene Mängel, die diesem Nachunternehmer bestätigt zugewiesen sind.</div>
      </div>
      <div>
        <div className="group-title">Zusätzlicher Hinweis (optional)</div>
        <div className="group">
          <div className="row stack">
            <textarea value={note} placeholder="z. B. Arbeiten mit dem Polier abstimmen" onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}

interface FM { id: string; kind: 'behoben' | 'rueckfrage'; melder_name: string; melder_firma: string; kommentar: string | null; foto_id: string | null; created_at: string; mangel_id: string; pos: number; number: number; status: string; version: number }

/** Reports that came in via the QR link; the Bauleitung accepts or rejects right here (normal status chain). */
function FreimeldungenSection({ anzeigeId, info, run, onChanged }: { anzeigeId: string; info: ProjectInfo; run: Run; onChanged: () => Promise<void> }) {
  const [list, setList] = useState<FM[] | null>(null);
  const load = useCallback(async () => setList(await api<FM[]>(`/mangelanzeigen/${anzeigeId}/freimeldungen`)), [anzeigeId]);
  useEffect(() => void load(), [load]);
  if (!list || list.length === 0) return null;
  const decide = (f: FM, to: 'abgenommen' | 'nicht_behoben') =>
    run(async () => {
      await api(`/maengel/${f.mangel_id}/transition`, { method: 'POST', body: { to, base_version: f.version } });
      await load();
      await onChanged();
    }, to === 'abgenommen' ? `${mNo(f.number)} abgenommen` : `${mNo(f.number)} nicht behoben – Frist läuft weiter`);
  return (
    <div>
      <div className="group-title">Freimeldungen per QR-Link</div>
      <div className="group">
        {list.map((f) => (
          <div key={f.id} className="row stack fm-row">
            <span className="k">
              <strong>Pos. {f.pos} · {mNo(f.number)}</strong> – {f.kind === 'behoben' ? 'behoben gemeldet' : 'Rückfrage'}
              <div className="sub">{f.melder_name} ({f.melder_firma}) · {new Date(f.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            </span>
            {f.kommentar && <div>„{f.kommentar}“</div>}
            {f.foto_id && <Foto id={f.foto_id} size={90} />}
            {f.kind === 'behoben' && f.status === 'behoben_gemeldet' && info.role === 'bauleitung' && (
              <span className="actions">
                <button className="btn small filled" onClick={() => void decide(f, 'abgenommen')}>Abnehmen</button>
                <button className="btn small destructive" onClick={() => void decide(f, 'nicht_behoben')}>Nicht behoben</button>
              </span>
            )}
            {f.status !== 'behoben_gemeldet' && <span className="sub">Stand jetzt: {MANGEL_STATUS_LABELS[f.status as keyof typeof MANGEL_STATUS_LABELS]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

interface LinkInfo { exists: boolean; url?: string; active?: boolean; qr?: string }

/** QR link of a sent Anzeige: show/print, lock/unlock, regenerate (old link stops working). */
function LinkSection({ anzeigeId, run }: { anzeigeId: string; run: Run }) {
  const [l, setL] = useState<LinkInfo | null>(null);
  const load = useCallback(async () => setL(await api<LinkInfo>(`/mangelanzeigen/${anzeigeId}/link`)), [anzeigeId]);
  useEffect(() => void load(), [load]);
  const change = (action: 'sperren' | 'freigeben' | 'neu', ok: string) =>
    run(async () => setL(await api<LinkInfo>(`/mangelanzeigen/${anzeigeId}/link`, { method: 'POST', body: { action } })), ok);
  if (!l) return null;
  return (
    <div>
      <div className="group-title">Freimelde-Link (QR-Code)</div>
      <div className="group">
        {l.exists ? (
          <>
            <div className="row qr-row">
              <img src={l.qr} alt="QR-Code zur Freimeldung" className={l.active ? '' : 'qr-off'} />
              <span className="k">
                <span className={`pill ${l.active ? 'c-green' : 'c-red'}`}>{l.active ? 'Aktiv – ohne Ablauf' : 'Gesperrt'}</span>
                <div className="sub" style={{ wordBreak: 'break-all', marginTop: 6 }}>{l.url}</div>
              </span>
            </div>
            <button className="row action" onClick={() => void run(async () => navigator.clipboard.writeText(l.url!), 'Link kopiert')}>Link kopieren</button>
            {l.active ? (
              <button className="row action destructive" onClick={() => void change('sperren', 'Link gesperrt')}>Link sperren</button>
            ) : (
              <button className="row action" onClick={() => void change('freigeben', 'Link wieder freigegeben')}>Link wieder freigeben</button>
            )}
            <button className="row action" onClick={() => void change('neu', 'Neuer Link erzeugt – der alte funktioniert nicht mehr')}>Neuen Link erzeugen</button>
          </>
        ) : (
          <button className="row action" onClick={() => void change('neu', 'Link erzeugt')}>Freimelde-Link erzeugen</button>
        )}
      </div>
      <div className="footnote">Wer den Link oder QR-Code hat, sieht nur diese Anzeige und kann je Position mit Foto freimelden. Ein neuer Link macht den alten (auch auf dem PDF) ungültig.</div>
    </div>
  );
}
