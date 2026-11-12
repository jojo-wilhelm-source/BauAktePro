/** Bau- und NU-Besprechung (docs/fachkonzept/09): list, protocol view, attendance, remarks, next date, status chips, send, follow-up. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { besprechungNo, BESPRECHUNG_FORMATE, formatDate, kalenderwoche, MAIL_VORLAGEN, punktNo, punktUeberfaellig, PUNKT_STATUS, PUNKT_STATUS_ICON, PUNKT_STATUS_LABELS, PUNKT_TONE, VERTEILER_KATEGORIEN, type MailVorlage, type PunktStatus } from '@bap/domain';
import { api, downloadFile, openPdf, type BesprechungDetail, type BesprechungListItem, type Mangel, type ProjectInfo, type Punkt } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';
import { mNo } from './ui/status';
import { Foto } from './ui/Foto';
import { SignatureSheet } from './Bautagebuch';
import { getToken, ApiError } from './api';

async function uploadPunktFoto(punktId: string, file: File) {
  const fd = new FormData();
  fd.set('id', crypto.randomUUID());
  fd.set('file', file);
  const res = await fetch(`/api/besprechung-punkte/${punktId}/fotos`, { method: 'POST', body: fd, headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
}

type Group = 'ort' | 'firma' | 'status';

export function StatusChip({ status, onClick }: { status: PunktStatus; onClick?: () => void }) {
  const cls = `chip c-${PUNKT_TONE[status]}`;
  if (!onClick)
    return (
      <span className={cls}>
        <span className="dot" />
        {PUNKT_STATUS_LABELS[status]}
      </span>
    );
  return (
    <button className={cls} onClick={onClick} title="Status ändern">
      <span className="dot" />
      {PUNKT_STATUS_LABELS[status]}
    </button>
  );
}

/** Status as a menu with the five values of the concept (Blockiert, Wichtig, In Arbeit, Erledigt, Nicht fällig). */
export function StatusSelect({ status, onChange }: { status: PunktStatus; onChange: (s: PunktStatus) => void }) {
  return (
    <select className={`chip status-select c-${PUNKT_TONE[status]}`} value={status} onChange={(e) => onChange(e.target.value as PunktStatus)} title="Status ändern">
      {PUNKT_STATUS.map((s) => <option key={s} value={s}>{PUNKT_STATUS_ICON[s]} {PUNKT_STATUS_LABELS[s]}</option>)}
    </select>
  );
}

/** Number of Punkte per firm (or per Gewerk), most first – shown in the head of a collapsible area. */
function zaehle(punkte: Punkt[], nach: 'firma' | 'gewerk'): [string, number][] {
  const m = new Map<string, number>();
  for (const p of punkte) {
    const k = nach === 'firma' ? (p.responsible_name ?? 'Allgemein') : (p.gewerk_name ?? 'ohne Gewerk');
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'));
}

const KIND_LABEL = { bau: 'Baubesprechung', nu: 'NU-Besprechung' } as const;
/** ISO → value of <input type="datetime-local"> (local time). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function BesprechungenPage(props: {
  info: ProjectInfo;
  maengel: Mangel[];
  run: Run;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onShowOnPlan: (besprechungNumber: number, punktId: string) => void;
  onPlacePin: (punkt: Punkt, besprechungId: string) => void;
}) {
  const { info, run } = props;
  const [list, setList] = useState<BesprechungListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<'alle' | 'bau' | 'nu'>('alle');
  const internal = info.role === 'bauleitung' || info.role === 'polier';
  const reload = useCallback(async () => setList(await api<BesprechungListItem[]>(`/projects/${info.project.id}/besprechungen`)), [info.project.id]);
  useEffect(() => void reload(), [reload, props.openId]);

  if (props.openId) return <Detail id={props.openId} {...props} onBack={() => props.onOpen(null)} />;

  return (
    <>
      <PageHeader
        eyebrow={info.project.name}
        title="Besprechungen"
        action={
          internal && (
            <button className="btn filled" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} /> Neue Besprechung
            </button>
          )
        }
      >
        <div className="segmented">
          {(
            [
              ['alle', 'Alle'],
              ['bau', 'Baubesprechung'],
              ['nu', 'NU-Besprechung'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1000 }}>
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Besprechung</th>
                <th>Punkte</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.filter((b) => kind === 'alle' || b.kind === kind).map((b) => (
                <tr key={b.id} onClick={() => props.onOpen(b.id)}>
                  <td className="num">{besprechungNo(b.number)}</td>
                  <td>
                    <div className="desc">{b.title}</div>
                    <div className="sub">
                      {KIND_LABEL[b.kind]} · {fmtDateTime(b.held_at)}
                      {b.place ? ` · ${b.place}` : ''}
                      {b.next_at && !b.has_next ? ` · nächster Termin ${fmtDateTime(b.next_at)}` : ''}
                    </div>
                  </td>
                  <td className="tabular">
                    {b.offen} offen <span className="sub">von {b.punkte}</span>
                  </td>
                  <td>
                    <span className={`pill ${b.status === 'versendet' ? 'c-green' : 'c-orange'}`}>{b.status === 'versendet' ? 'Versendet' : 'Entwurf'}</span>
                    {b.sent_at && <div className="sub">{formatDate(b.sent_at)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.filter((b) => kind === 'alle' || b.kind === kind).length === 0 && <div className="empty">Noch keine Besprechungen</div>}
        </div>
      </div>
      {creating && (
        <NewBesprechungSheet
          info={info}
          onCancel={() => setCreating(false)}
          onSave={(body) =>
            run(async () => {
              await api('/besprechungen', { method: 'POST', body });
              setCreating(false);
              props.onOpen(body.id);
            }, 'Besprechung angelegt')
          }
        />
      )}
    </>
  );
}

function Detail(props: Parameters<typeof BesprechungenPage>[0] & { id: string; onBack: () => void }) {
  const { info, run, id } = props;
  const [d, setD] = useState<BesprechungDetail | null>(null);
  const [group, setGroup] = useState<Group>('ort');
  const [adding, setAdding] = useState<{ location_id: string | null } | null>(null);
  const [editing, setEditing] = useState<Punkt | null>(null);
  const [sign, setSign] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [listFor, setListFor] = useState('');
  const [own, setOwn] = useState('Eigen');
  // Collapsed areas (concept: sections can be folded; the head shows the number of Punkte per firm / Gewerk).
  const [zu, setZu] = useState<Set<string>>(new Set());
  const [verteiler, setVerteiler] = useState(false);
  useEffect(() => void api<{ kurzname: string | null; name: string } | null>('/firma').then((f) => f && setOwn(f.kurzname ?? f.name)).catch(() => undefined), []);
  // A meeting that no longer exists (deleted, or no access any more) leads back to the list instead of an empty page.
  const load = useCallback(async () => {
    try {
      setD(await api<BesprechungDetail>(`/besprechungen/${id}`));
    } catch {
      props.onBack();
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [load]);
  const runAndLoad: Run = async (fn, ok) => {
    await run(fn, ok);
    await load();
  };

  const groups = useMemo(() => {
    if (!d) return [];
    const shown = (p: Punkt): PunktStatus => (d.status === 'versendet' ? (p.status_snapshot ?? p.status) : p.status);
    const key = (p: Punkt) =>
      group === 'ort' ? (p.location_path || p.location_name || 'Allgemein') : group === 'firma' ? (p.responsible_name ?? 'Ohne Verantwortlichen') : PUNKT_STATUS_LABELS[shown(p)];
    const order = (k: string) =>
      group === 'ort' ? (k === 'Allgemein' ? '0' : `1${String(d.punkte.find((p) => (p.location_path || p.location_name) === k) ? d.punkte.findIndex((p) => (p.location_path || p.location_name) === k) : 999).padStart(4, '0')}${k}`) : group === 'status' ? String(PUNKT_STATUS.map((s) => PUNKT_STATUS_LABELS[s]).indexOf(k)) : k;
    const map = new Map<string, Punkt[]>();
    // Concept: active Punkte by area, done ones go to the history at the end (not in the grouping).
    const active = group === 'status' ? d.punkte : d.punkte.filter((p) => shown(p) !== 'erledigt');
    // Within an area: Allgemeine Punkte first, then per firm.
    const sorted = [...active].sort((a, b) => (a.responsible_name ? 1 : 0) - (b.responsible_name ? 1 : 0) || (a.responsible_name ?? '').localeCompare(b.responsible_name ?? '', 'de') || (a.number ?? 0) - (b.number ?? 0));
    for (const p of sorted) map.set(key(p), [...(map.get(key(p)) ?? []), p]);
    if (group === 'ort' && d.can_edit) {
      // Empty Geschosse can be filled during the meeting.
      for (const l of info.locations.filter((x) => x.kind === 'geschoss')) if (![...map.keys()].some((k) => k.endsWith(l.name))) map.set(l.name, []);
      if (!map.has('Allgemein')) map.set('Allgemein', []);
    }
    return [...map.entries()].sort(([a], [b]) => order(a).localeCompare(order(b), 'de'));
  }, [d, group, info.locations]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <p className="loading">Besprechung wird geladen …</p>;
  const internal = info.role === 'bauleitung' || info.role === 'polier';
  const sent = d.status === 'versendet';
  // In a sent protocol the frozen state is shown; the current state appears as a hint when it changed since.
  function shown(p: Punkt): PunktStatus {
    return sent ? (p.status_snapshot ?? p.status) : p.status;
  }
  const nus = d.teilnehmer.filter((t) => t.kind === 'nu');
  const erledigt = d.punkte.filter((p) => shown(p) === 'erledigt');

  return (
    <>
      <PageHeader
        eyebrow={`${info.project.name} · ${fmtDateTime(d.held_at)}${d.place ? ` · ${d.place}` : ''}`}
        title={`${d.title} ${besprechungNo(d.number)}`}
        action={
          <div className="meta-row">
            <button className="btn" onClick={props.onBack}>
              Alle Besprechungen
            </button>
            <button className="btn" onClick={() => run(() => openPdf(`/besprechungen/${id}/pdf`), 'Protokoll geöffnet')}>
              {sent ? 'Protokoll (PDF)' : 'PDF-Vorschau'}
            </button>
            {d.can_release && (
              <button className={`btn ${d.bauherr_freigabe ? '' : 'filled'}`} disabled={!!d.bauherr_signed_at}
                onClick={() => runAndLoad(() => api(`/besprechungen/${id}/bauherr-freigabe`, { method: 'POST', body: { freigabe: !d.bauherr_freigabe } }), d.bauherr_freigabe ? 'Freigabe zurückgenommen' : 'Für den Bauherrn freigegeben – er wurde benachrichtigt')}>
                {d.bauherr_freigabe ? 'Bauherr-Freigabe zurücknehmen' : 'Für Bauherrn freigeben'}
              </button>
            )}
            {d.can_countersign && <button className="btn filled" onClick={() => setSign(true)}>Gegenzeichnen</button>}
            {d.can_send && (
              <button className="btn filled" onClick={() => setConfirm(true)}>
                Versenden …
              </button>
            )}
            {sent && internal && (
              <button
                className="btn filled"
                onClick={() =>
                  run(async () => {
                    const r = await api<{ id: string }>('/besprechungen', {
                      method: 'POST',
                      body: { id: crypto.randomUUID(), project_id: info.project.id, kind: d.kind, title: d.title, held_at: d.next_at ?? new Date(Date.now() + 7 * 86400000).toISOString(), place: d.place, previous_id: d.id },
                    });
                    props.onOpen(r.id);
                  }, 'Folgesitzung vorbereitet: offene Punkte übernommen, erledigte archiviert')
                }
              >
                Folgesitzung vorbereiten
              </button>
            )}
          </div>
        }
      >
        <div className="segmented">
          {(
            [
              ['ort', 'Nach Ort'],
              ['firma', 'Nach Firma'],
              ['status', 'Nach Status'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={group === k ? 'on' : ''} onClick={() => setGroup(k)}>
              {l}
            </button>
          ))}
        </div>
        <span className={`pill ${sent ? 'c-green' : 'c-orange'}`}>{sent ? `Versendet ${formatDate(d.sent_at)} · gesperrt` : 'Entwurf'}</span>
        {d.bauherr_freigabe && <span className="pill c-blue">{d.bauherr_signed_at ? `Vom Bauherrn gegengezeichnet ${formatDate(d.bauherr_signed_at)}` : 'Für Bauherrn freigegeben'}</span>}
        <div className="tokens">
          {(d.can_edit ? info.companies : d.teilnehmer).map((c) => {
            const on = d.teilnehmer.some((t) => t.id === c.id);
            return d.can_edit ? (
              <button
                key={c.id}
                className={`token ${on ? 'on' : ''}`}
                title="Teilnehmer an/aus"
                onClick={() =>
                  runAndLoad(
                    () =>
                      api(`/besprechungen/${id}/teilnehmer`, {
                        method: 'PUT',
                        body: { company_ids: on ? d.teilnehmer.filter((t) => t.id !== c.id).map((t) => t.id) : [...d.teilnehmer.map((t) => t.id), c.id] },
                      }),
                    on ? `${c.name} entfernt` : `${c.name} nimmt teil`,
                  )
                }
              >
                {c.name}
              </button>
            ) : (
              <span key={c.id} className="token">
                {c.name}
              </span>
            );
          })}
        </div>
        {nus.length > 0 && (
          <select
            className="popup"
            value={listFor}
            onChange={(e) => {
              setListFor('');
              if (e.target.value) void run(() => openPdf(`/besprechungen/${id}/pdf?company=${e.target.value}`), 'Aufgabenliste geöffnet');
            }}
          >
            <option value="">Aufgabenliste je NU …</option>
            {nus.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </PageHeader>

      <div className="protocol">
        <ProtokollKopf d={d} id={id} run={runAndLoad} />
        <KopfCard d={d} id={id} run={runAndLoad} />
        <AllgemeinCard d={d} id={id} run={runAndLoad} />
        {groups.length > 1 && (
          <div className="meta-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn small plain" onClick={() => setZu(new Set(groups.map(([n]) => n)))}>Alle einklappen</button>
            <button className="btn small plain" onClick={() => setZu(new Set())}>Alle aufklappen</button>
          </div>
        )}
        {groups.map(([name, punkte]) => (
          <div key={name}>
            <button className="group-head collapsible" onClick={() => setZu((z) => { const n = new Set(z); if (n.has(name)) n.delete(name); else n.add(name); return n; })}>
              <span className={`arrow ${zu.has(name) ? '' : 'open'}`}>▶</span>
              <h3>{name}</h3>
              <span className="sub">{punkte.length} {punkte.length === 1 ? 'Punkt' : 'Punkte'}</span>
              <span className="zaehler">
                {zaehle(punkte, group === 'firma' ? 'gewerk' : 'firma').map(([k, n]) => <span key={k} className="token small">{k} {n}</span>)}
              </span>
            </button>
            {!zu.has(name) && <div className="card">
              <table className="table">
                {punkte.length > 0 && (
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Nr.</th>
                      <th style={{ width: 110 }}>Gewerk</th>
                      <th>Aufgabe</th>
                      <th style={{ width: 220 }}>Verantwortlich / Zuarbeit</th>
                      <th style={{ width: 96 }}>Frist</th>
                      <th style={{ width: 120 }}>Status</th>
                      <th style={{ width: 96 }}>Plan</th>
                    </tr>
                  </thead>
                )}
                <tbody>
                  {punkte.map((p, idx) => {
                    const st = shown(p);
                    const overdue = punktUeberfaellig({ status: st, due_date: p.due_date });
                    // Sub-heading per firm inside the area (group "Nach Ort"): Allgemeine Punkte first, then each firm; foldable.
                    const firm = p.responsible_name ?? 'Allgemeine Punkte';
                    const firmKey = `${name}|${firm}`;
                    const firstOfFirm = group === 'ort' && (idx === 0 || (punkte[idx - 1]!.responsible_name ?? 'Allgemeine Punkte') !== firm);
                    const head = firstOfFirm ? (
                      <tr key={`h-${firmKey}`} className="firm-head" onClick={() => setZu((z) => { const n = new Set(z); if (n.has(firmKey)) n.delete(firmKey); else n.add(firmKey); return n; })}>
                        <td colSpan={7}><span className={`arrow ${zu.has(firmKey) ? '' : 'open'}`}>▶</span> {firm}{p.kontakt ? ` | ${p.kontakt}` : ''} <span className="sub">· {punkte.filter((x) => (x.responsible_name ?? 'Allgemeine Punkte') === firm).length}</span></td>
                      </tr>
                    ) : null;
                    if (group === 'ort' && zu.has(firmKey)) return head;
                    return [head, (
                      <tr key={p.id} className={p.mine ? 'mine' : ''} style={{ cursor: 'default' }}>
                        <td className="num">
                          {punktNo(p.number)}
                          {p.carried && <span className="badge-w" title="Aus der vorigen Besprechung übernommen">W</span>}
                        </td>
                        <td>{p.gewerk_name ?? <span className="sub">–</span>}</td>
                        <td>
                          {sent ? (p.text_snapshot ?? p.text) : p.text}
                          {p.internal && <span className="tag critical" style={{ marginLeft: 6 }}>nur intern</span>}
                          {p.mine && <span className="tag" style={{ marginLeft: 6 }}>Ihr Punkt</span>}
                          {p.notiz && <div className="sub">Notiz: {p.notiz}</div>}
                          {p.eigen_anteil && <div className="sub eigen">{own}-Anteil: {p.eigen_anteil}</div>}
                          {p.kontrolle && <div className="sub eigen">{own}-Kontrolle / Freigabe: {p.kontrolle}</div>}
                          {(p.teilaufgaben?.length ?? 0) > 0 && (
                            <div className="teilaufgaben">
                              {p.teilaufgaben!.map((t) => (
                                <div key={t.id}><span className={`dot-s c-${PUNKT_TONE[t.status]}`} /> <strong>{t.company}</strong>: {t.text}{t.due_date ? <span className="sub"> · fällig {formatDate(t.due_date)}</span> : null}</div>
                              ))}
                            </div>
                          )}
                          {(p.fotos?.length ?? 0) > 0 && (
                            <div className="punkt-fotos">{p.fotos!.map((f) => <Foto key={f.id} id={f.id} src={`/api/besprechung-fotos/${f.id}`} size={48} />)}</div>
                          )}
                          {internal && (
                            <div className="punkt-actions">
                              {d.can_edit && <button className="btn small plain" onClick={() => setEditing(p)}>Bearbeiten</button>}
                              <label className="btn small plain">Foto<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) void runAndLoad(() => uploadPunktFoto(p.id, f), 'Foto hinzugefügt'); }} /></label>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="who">{p.responsible_name ?? 'Allgemein'}</div>
                          {p.kontakt && <div className="sub">{p.kontakt}</div>}
                        </td>
                        <td className="tabular" style={overdue ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
                          {p.due_date ? formatDate(p.due_date) : <span className="sub">ohne Termin</span>}
                          {overdue && <div className="sub" style={{ color: 'var(--red)', fontWeight: 600 }}>⚠ überfällig</div>}
                        </td>
                        <td>
                          {d.can_edit ? (
                            <StatusSelect status={st} onChange={(to) => runAndLoad(() => api(`/punkte/${p.id}`, { method: 'PATCH', body: { base_version: p.version, status: to } }), `${punktNo(p.number)}: ${PUNKT_STATUS_LABELS[to]}`)} />
                          ) : <StatusChip status={st} />}
                          {sent && p.status !== st && <div className="sub">jetzt: {PUNKT_STATUS_LABELS[p.status]}</div>}
                        </td>
                        <td>
                          {p.plan_id && p.pin_x != null ? (
                            <button className="btn small" onClick={() => props.onShowOnPlan(d.number, p.id)}>
                              Auf Plan
                            </button>
                          ) : internal ? (
                            <button className="btn small plain" onClick={() => props.onPlacePin(p, d.id)}>
                              PIN setzen
                            </button>
                          ) : (
                            <span className="sub">–</span>
                          )}
                        </td>
                      </tr>
                    )];
                  })}
                </tbody>
              </table>
              {d.can_edit && group === 'ort' && (
                <div className="add-row" onClick={() => setAdding({ location_id: info.locations.find((l) => l.name === name.split(' / ').pop())?.id ?? null })}>
                  + Punkt in „{name}“
                </div>
              )}
              {punkte.length === 0 && !d.can_edit && <div className="empty">Keine Punkte</div>}
            </div>}
          </div>
        ))}

        {group !== 'status' && erledigt.length > 0 && (
          <details className="historie">
            <summary>Erledigte Punkte / Historie ({erledigt.length})</summary>
            <div className="card">
              {erledigt.map((p) => (
                <div key={p.id} className="row">
                  <span className="k"><strong className="tabular">{punktNo(p.number)}</strong> {p.text}<div className="sub">{p.location_path || p.location_name || 'Allgemein'} · {p.responsible_name ?? 'Allgemein'}</div></span>
                  {d.can_edit ? <StatusSelect status={p.status} onChange={(to) => runAndLoad(() => api(`/punkte/${p.id}`, { method: 'PATCH', body: { base_version: p.version, status: to } }), `${punktNo(p.number)} wieder aktiv`)} /> : <StatusChip status={shown(p)} />}
                </div>
              ))}
            </div>
            <div className="footnote">Erledigte Punkte stehen weder im Protokoll noch in der E-Mail und wandern nicht in die Folgesitzung.</div>
          </details>
        )}

        {d.maengel.length > 0 && (
          <div>
            <div className="group-head">
              <h3>Überfällige Mängel der Teilnehmer</h3>
              <span className="sub">aus dem Mängelmanagement, zur Besprechung</span>
            </div>
            <div className="card">
              <table className="table">
                <tbody>
                  {d.maengel.map((m) => (
                    <tr key={m.id} style={{ cursor: 'default' }}>
                      <td className="num" style={{ width: 80 }}>
                        {mNo(m.number)}
                      </td>
                      <td>{m.description}</td>
                      <td className="who" style={{ width: 220 }}>
                        {m.company_name}
                      </td>
                      <td style={{ width: 230 }}>
                        <span className="pill c-red">
                          <span className="dot" />
                          {m.escalation.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="footnote">{info.role === 'nu' ? 'Ihre Punkte sind gelb hervorgehoben. ' : ''}W = aus der vorigen Besprechung übernommen. Status: 🟥 Blockiert · 🟧 Wichtig · 🟨 In Arbeit · 🟩 Erledigt · ⬜ Nicht fällig. Erledigte Punkte wandern in die Historie.</div>
      </div>

      {editing && (
        <NewPunktSheet
          info={info}
          d={d}
          locationId={editing.location_id}
          initial={editing}
          own={own}
          onCancel={() => setEditing(null)}
          onSave={(body) =>
            runAndLoad(async () => {
              const { id: _id, besprechung_id: _b, ...rest } = body as Record<string, unknown>;
              await api(`/punkte/${editing.id}`, { method: 'PATCH', body: { ...rest, base_version: editing.version } });
              setEditing(null);
            }, 'Punkt geändert')
          }
        />
      )}
      {sign && <SignatureSheet title="Protokoll gegenzeichnen" onCancel={() => setSign(false)}
        onDone={(s) => { setSign(false); void runAndLoad(() => api(`/besprechungen/${id}/gegenzeichnen`, { method: 'POST', body: { signature: s } }), 'Gegengezeichnet'); }} />}
      {adding && (
        <NewPunktSheet
          info={info}
          d={d}
          locationId={adding.location_id}
          own={own}
          onCancel={() => setAdding(null)}
          onSave={(body) =>
            runAndLoad(async () => {
              await api('/punkte', { method: 'POST', body });
              setAdding(null);
            }, 'Punkt angelegt')
          }
        />
      )}
      {confirm && (
        <Sheet
          title="Protokoll versenden"
          primary="Versenden"
          onCancel={() => setConfirm(false)}
          onPrimary={() =>
            runAndLoad(async () => {
              const r = await api<{ mails: { company: string }[]; skipped: string[] }>(`/besprechungen/${id}/send`, { method: 'POST', body: { base_version: d.version } });
              setConfirm(false);
              if (r.skipped.length) throw new Error(`Versendet an ${r.mails.length} Firmen. Ohne E-Mail-Adresse: ${r.skipped.join(', ')}`);
            }, 'Protokoll und Aufgabenlisten versendet')
          }
        >
          <VersandVorschau d={d} id={id} info={info} />
          <div className="footnote">
            Jede Firma bekommt das Protokoll (ihre Punkte gelb markiert) und ihre persönliche Aufgabenliste als PDF; der feste Verteiler, manuelle Teilnehmer und CC das Protokoll.
            Doppelte Adressen werden entfernt. Erledigte und „nur intern“-Punkte werden nicht versendet. Danach ist das Protokoll gesperrt; Änderungen gehen in die Folgesitzung.
          </div>
          {info.role === 'bauleitung' && <button className="btn plain" onClick={() => setVerteiler(true)}>Verteiler & Mail-Vorlage bearbeiten …</button>}
        </Sheet>
      )}
      {verteiler && <VerteilerSheet info={info} onClose={() => setVerteiler(false)} run={run} />}
    </>
  );
}

function NewPunktSheet(props: {
  info: ProjectInfo;
  d: BesprechungDetail;
  locationId: string | null;
  /** Edit an existing Punkt (also one carried over from an earlier meeting). */
  initial?: Punkt;
  own?: string;
  onCancel: () => void;
  onSave: (body: object) => void;
}) {
  const init = props.initial;
  const { info, d } = props;
  const own = props.own ?? 'Eigen';
  const orte = info.locations.filter((l) => l.kind !== 'raum');
  const [f, setF] = useState({
    text: init?.text ?? '',
    location_id: props.locationId ?? '',
    gewerk_id: init?.gewerk_id ?? '',
    art: (init ? (init.responsible_company_id ? 'firma' : 'allgemein') : 'firma') as 'firma' | 'allgemein',
    responsible_company_id: init?.responsible_company_id ?? '',
    kontakt: init?.kontakt ?? '',
    due_date: init?.due_date?.slice(0, 10) ?? '',
    status: (init?.status ?? 'in_arbeit') as PunktStatus,
    internal: init?.internal ?? false,
    notiz: init?.notiz ?? '',
    eigen_anteil: init?.eigen_anteil ?? '',
    kontrolle: init?.kontrolle ?? '',
  });
  const [teile, setTeile] = useState<{ company_id: string; text: string; status: PunktStatus; due_date: string }[]>(
    (init?.teilaufgaben ?? []).map((t) => ({ company_id: t.company_id ?? '', text: t.text, status: t.status, due_date: t.due_date ?? '' })));
  const [kontakte, setKontakte] = useState<{ company_id: string; name: string; funktion: string | null }[]>([]);
  useEffect(() => void api<typeof kontakte>(`/kontakte?project=${info.project.id}`).then(setKontakte).catch(() => undefined), [info.project.id]);
  // Suggest the responsible company from the Gewerk (same mapping as for Mängel).
  const setGewerk = (g: string) => {
    const nu = info.gewerkCompanies.find((gc) => gc.gewerk_id === g)?.company_id;
    setF({ ...f, gewerk_id: g, responsible_company_id: f.responsible_company_id || nu || '' });
  };
  const teileOk = teile.every((t) => t.text.trim());
  return (
    <Sheet
      title={init ? `${punktNo(init.number)} bearbeiten` : 'Neuen Punkt aufnehmen'}
      primary="Sichern"
      primaryDisabled={!f.text.trim() || (f.art === 'firma' && !f.responsible_company_id) || !teileOk}
      wide
      onCancel={props.onCancel}
      onPrimary={() =>
        props.onSave({
          id: crypto.randomUUID(),
          besprechung_id: d.id,
          text: f.text,
          location_id: f.location_id || null,
          gewerk_id: f.gewerk_id || null,
          responsible_company_id: f.art === 'firma' ? f.responsible_company_id || null : null,
          kontakt: f.art === 'firma' ? f.kontakt.trim() || null : null,
          due_date: f.due_date || null,
          status: f.status,
          internal: f.internal,
          notiz: f.notiz.trim() || null,
          eigen_anteil: f.eigen_anteil.trim() || null,
          kontrolle: f.kontrolle.trim() || null,
          teilaufgaben: teile.map((t) => ({ company_id: t.company_id || null, text: t.text.trim(), status: t.status, due_date: t.due_date || null })),
        })
      }
    >
      <div className="group">
        <div className="row"><span className="k">Ort (Bereich, Bauteil, Geschoss)</span>
          <select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
            <option value="">Allgemein</option>
            {orte.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="row"><span className="k">Punktart</span>
          <div className="segmented small">
            <button className={f.art === 'allgemein' ? 'on' : ''} onClick={() => setF({ ...f, art: 'allgemein' })}>Allgemeiner Punkt</button>
            <button className={f.art === 'firma' ? 'on' : ''} onClick={() => setF({ ...f, art: 'firma' })}>Firma / Gewerk</button>
          </div>
        </div>
        <div className="row"><span className="k">Gewerk</span>
          <select value={f.gewerk_id} onChange={(e) => setGewerk(e.target.value)}>
            <option value="">–</option>
            {info.gewerke.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        {f.art === 'firma' && (
          <>
            <div className="row"><span className="k">Firma</span>
              <select value={f.responsible_company_id} onChange={(e) => setF({ ...f, responsible_company_id: e.target.value, kontakt: '' })}>
                <option value="">– auswählen –</option>
                {info.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="row"><span className="k">Ansprechpartner</span>
              <input list="punkt-kontakte" placeholder="optional" value={f.kontakt} onChange={(e) => setF({ ...f, kontakt: e.target.value })} />
              <datalist id="punkt-kontakte">{kontakte.filter((k) => k.company_id === f.responsible_company_id).map((k) => <option key={k.name} value={k.name}>{k.funktion ?? ''}</option>)}</datalist>
            </div>
          </>
        )}
        <div className="row"><span className="k">Fällig am</span><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
        <div className="row"><span className="k">Status</span><StatusSelect status={f.status} onChange={(st) => setF({ ...f, status: st })} /></div>
      </div>
      <div className="group">
        <div className="row stack"><textarea autoFocus placeholder="Aufgabe / verbindliches Ergebnis" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></div>
        <div className="row stack"><textarea rows={2} placeholder="Notiz / Abhängigkeit / Folgegewerk / Hindernis" value={f.notiz} onChange={(e) => setF({ ...f, notiz: e.target.value })} /></div>
        <div className="row stack"><textarea rows={2} placeholder={`${own}-Anteil (optional): welchen übergeordneten Beitrag leistet ${own}?`} value={f.eigen_anteil} onChange={(e) => setF({ ...f, eigen_anteil: e.target.value })} /></div>
        <div className="row"><span className="k">{own}-Kontrolle / Freigabe</span><input placeholder="z. B. BL am 20.11." value={f.kontrolle} onChange={(e) => setF({ ...f, kontrolle: e.target.value })} /></div>
      </div>
      <div>
        <div className="group-title">Beteiligte / unterstützende Firmen und Teilaufgaben</div>
        <div className="group">
          {teile.map((t, i) => (
            <div key={i} className="row teil-row">
              <select value={t.company_id} onChange={(e) => setTeile(teile.map((x, j) => (j === i ? { ...x, company_id: e.target.value } : x)))}>
                <option value="">{own}</option>
                {info.companies.filter((c) => c.kind !== 'own').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="tb-left" placeholder="Aufgabe dieser Firma" value={t.text} onChange={(e) => setTeile(teile.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <StatusSelect status={t.status} onChange={(st) => setTeile(teile.map((x, j) => (j === i ? { ...x, status: st } : x)))} />
              <input type="date" value={t.due_date} onChange={(e) => setTeile(teile.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))} />
              <button className="btn small plain destructive" aria-label="Entfernen" onClick={() => setTeile(teile.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="row action" onClick={() => setTeile([...teile, { company_id: info.companies.find((c) => c.kind === 'nu' && c.id !== f.responsible_company_id)?.id ?? '', text: '', status: 'in_arbeit', due_date: '' }])}>+ Weitere Firma / {own} hinzufügen</button>
        </div>
        <div className="footnote">Für jede Firma erscheint eine eigene Teilaufgabe direkt unter dem Hauptpunkt; die Firma sieht den Punkt im Portal.</div>
      </div>
      <label className="group row" style={{ cursor: 'pointer' }}>
        <span className="k">Nur intern (nicht versenden, für NU unsichtbar)</span>
        <input type="checkbox" className="switch" checked={f.internal} onChange={(e) => setF({ ...f, internal: e.target.checked })} />
      </label>
    </Sheet>
  );
}

function NewBesprechungSheet({ info, onCancel, onSave }: { info: ProjectInfo; onCancel: () => void; onSave: (b: { id: string } & Record<string, unknown>) => void }) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ kind: 'nu' as 'nu' | 'bau', title: 'NU-Besprechung', held_at: local, place: 'Baucontainer', companies: info.companies.filter((c) => c.kind !== 'bauherr').map((c) => c.id) });
  // Baubesprechung: with the Bauherr and the planners; NU-Besprechung: the NU only (ANNAHME, docs/fachkonzept/09).
  const setKind = (kind: 'nu' | 'bau') =>
    setF({
      ...f,
      kind,
      title: f.title === KIND_LABEL[f.kind] ? KIND_LABEL[kind] : f.title,
      companies: info.companies.filter((c) => (kind === 'bau' ? c.kind !== 'nu' : c.kind !== 'bauherr')).map((c) => c.id),
    });
  return (
    <Sheet
      title="Neue Besprechung"
      primary="Anlegen"
      primaryDisabled={!f.title.trim()}
      onCancel={onCancel}
      onPrimary={() =>
        onSave({ id: crypto.randomUUID(), project_id: info.project.id, kind: f.kind, title: f.title, held_at: new Date(f.held_at).toISOString(), place: f.place || null, company_ids: f.companies })
      }
    >
      <div className="segmented">
        {(['bau', 'nu'] as const).map((k) => (
          <button key={k} className={f.kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="group">
        <div className="row">
          <span className="k">Titel</span>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div className="row">
          <span className="k">Termin</span>
          <input type="datetime-local" value={f.held_at} onChange={(e) => setF({ ...f, held_at: e.target.value })} />
        </div>
        <div className="row">
          <span className="k">Ort</span>
          <input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} />
        </div>
      </div>
      <div>
        <div className="group-title">Teilnehmer</div>
        <div className="group">
          <div className="row tokens">
            {info.companies.map((c) => (
              <button
                key={c.id}
                className={`token ${f.companies.includes(c.id) ? 'on' : ''}`}
                onClick={() => setF({ ...f, companies: f.companies.includes(c.id) ? f.companies.filter((x) => x !== c.id) : [...f.companies, c.id] })}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="footnote">Für die wöchentliche Runde besser „Folgesitzung vorbereiten“ in der letzten Besprechung nutzen: dann wandern offene Punkte mit.</div>
      </div>
    </Sheet>
  );
}

/** Attendance, remarks and next date. Editable while the protocol is a draft, printed in the PDF. */
function KopfCard({ d, id, run }: { d: BesprechungDetail; id: string; run: Run }) {
  const [bemerkung, setBemerkung] = useState(d.bemerkung ?? '');
  const [next, setNext] = useState(toLocalInput(d.next_at));
  useEffect(() => {
    setBemerkung(d.bemerkung ?? '');
    setNext(toLocalInput(d.next_at));
  }, [d.bemerkung, d.next_at]);
  const patch = (body: Record<string, unknown>, ok: string) => run(() => api(`/besprechungen/${id}`, { method: 'PATCH', body: { base_version: d.version, ...body } }), ok);
  const extern = d.teilnehmer.filter((t) => t.kind !== 'own');
  const present = extern.filter((t) => t.anwesend === true).length;
  return (
    <div className="kopf">
      <div>
        <div className="group-head">
          <h3>Teilnehmer</h3>
          <span className="sub">{present} von {extern.length} anwesend</span>
        </div>
        <div className="card">
          {d.teilnehmer.map((t) => (
            <div key={t.id} className="row">
              <span className="k">
                {t.name}
                <div className="sub">{t.kind === 'own' ? 'eigene Firma' : t.kind === 'bauherr' ? 'Bauherr' : t.kind === 'nu' ? 'Nachunternehmer' : t.kind}</div>
              </span>
              {d.can_edit ? (
                <div className="segmented small">
                  {(
                    [
                      [true, 'anwesend'],
                      [false, 'entschuldigt'],
                      [null, '–'],
                    ] as const
                  ).map(([v, l]) => (
                    <button
                      key={String(v)}
                      className={t.anwesend === v ? 'on' : ''}
                      onClick={() => run(() => api(`/besprechungen/${id}/teilnehmer/${t.id}/anwesenheit`, { method: 'PUT', body: { anwesend: v } }), `${t.name}: ${l}`)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              ) : (
                <span className={`pill ${t.anwesend === true ? 'c-green' : t.anwesend === false ? 'c-orange' : 'c-gray'}`}>{t.anwesend === true ? 'anwesend' : t.anwesend === false ? 'entschuldigt' : 'nicht erfasst'}</span>
              )}
            </div>
          ))}
          {d.teilnehmer.length === 0 && <div className="empty">Keine Teilnehmer</div>}
        </div>
      </div>
      <div>
        <div className="group-head">
          <h3>Bemerkungen und nächster Termin</h3>
        </div>
        <div className="card">
          <div className="row stack">
            <textarea
              rows={4}
              placeholder={d.can_edit ? 'Allgemeines, z. B. Baustellenordnung, Zufahrt, Witterung …' : 'Keine Bemerkungen'}
              value={bemerkung}
              readOnly={!d.can_edit}
              onChange={(e) => setBemerkung(e.target.value)}
              onBlur={() => d.can_edit && bemerkung !== (d.bemerkung ?? '') && void patch({ bemerkung: bemerkung.trim() || null }, 'Bemerkungen gespeichert')}
            />
          </div>
          <div className="row">
            <span className="k">Nächster Termin</span>
            {d.can_edit ? (
              <input
                type="datetime-local"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                onBlur={() => next !== toLocalInput(d.next_at) && void patch({ next_at: next ? new Date(next).toISOString() : null }, next ? 'Nächster Termin gespeichert' : 'Nächster Termin entfernt')}
              />
            ) : (
              <span className="v">{d.next_at ? fmtDateTime(d.next_at) : '–'}</span>
            )}
          </div>
          {d.next_at && (
            <button className="row action" onClick={() => run(() => downloadFile(`/besprechungen/${id}/naechster-termin.ics`, 'Naechster-Termin.ics'), 'Kalendereintrag geladen')}>
              In den Kalender (iPhone, Outlook) <Icon name="kalender" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Protokollkopf of the concept: Ort/Format, Protokollführung, Dokumentenstand, KW, manual participants, CC. */
function ProtokollKopf({ d, id, run }: { d: BesprechungDetail; id: string; run: Run }) {
  const patch = (body: Record<string, unknown>, ok: string) => run(() => api(`/besprechungen/${id}`, { method: 'PATCH', body: { base_version: d.version, ...body } }), ok);
  const kw = kalenderwoche(new Date(d.held_at).toISOString().slice(0, 10));
  const ro = !d.can_edit;
  const [neu, setNeu] = useState({ name: '', email: '' });
  const extra = d.extra_teilnehmer ?? [];
  return (
    <div>
      <div className="group-head"><h3>Protokollkopf</h3><span className="sub">KW {String(kw.kw).padStart(2, '0')}/{kw.jahr}</span></div>
      <div className="card kopf-grid">
        <div className="row"><span className="k">Ort / Format</span>
          <select disabled={ro} value={BESPRECHUNG_FORMATE.includes(d.place as never) ? d.place ?? '' : d.place ? '__frei' : ''}
            onChange={(e) => e.target.value !== '__frei' && void patch({ place: e.target.value || null }, 'Ort gespeichert')}>
            <option value="">–</option>
            {BESPRECHUNG_FORMATE.map((f) => <option key={f}>{f}</option>)}
            {d.place && !BESPRECHUNG_FORMATE.includes(d.place as never) && <option value="__frei">{d.place}</option>}
          </select>
        </div>
        <div className="row"><span className="k">Protokollführung</span>
          <input disabled={ro} defaultValue={d.protokollfuehrung ?? ''} placeholder="Name" onBlur={(e) => e.target.value !== (d.protokollfuehrung ?? '') && void patch({ protokollfuehrung: e.target.value || null }, 'Gespeichert')} /></div>
        <div className="row"><span className="k">Dokumentenstand</span>
          <input disabled={ro} defaultValue={d.dokumentenstand ?? ''} placeholder="z. B. Planstand 14.11." onBlur={(e) => e.target.value !== (d.dokumentenstand ?? '') && void patch({ dokumentenstand: e.target.value || null }, 'Gespeichert')} /></div>
        <div className="row"><span className="k">CC (kommagetrennt)</span>
          <input disabled={ro} defaultValue={d.cc ?? ''} placeholder="z. B. Planer, Bauherrenvertreter" onBlur={(e) => e.target.value !== (d.cc ?? '') && void patch({ cc: e.target.value || null }, 'CC gespeichert')} /></div>
        {extra.map((x, i) => (
          <div key={i} className="row"><span className="k">{x.name}<div className="sub">{x.email || 'ohne E-Mail'} · manueller Teilnehmer</div></span>
            {!ro && <button className="btn small plain destructive" onClick={() => void patch({ extra_teilnehmer: extra.filter((_, j) => j !== i) }, 'Entfernt')}>✕</button>}</div>
        ))}
        {!ro && (
          <div className="row">
            <input className="tb-left" placeholder="Manueller Teilnehmer – Name (z. B. externer Gast)" value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} />
            <input placeholder="E-Mail (optional)" value={neu.email} onChange={(e) => setNeu({ ...neu, email: e.target.value })} />
            <button className="btn small" disabled={!neu.name.trim()} onClick={() => { void patch({ extra_teilnehmer: [...extra, { name: neu.name.trim(), email: neu.email.trim() || null }] }, 'Teilnehmer hinzugefügt'); setNeu({ name: '', email: '' }); }}>Hinzufügen</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Allgemeine Informationen": short binding notes without status (concept point 3). */
function AllgemeinCard({ d, id, run }: { d: BesprechungDetail; id: string; run: Run }) {
  const list = d.allgemein ?? [];
  const [neu, setNeu] = useState('');
  const save = (next: string[], ok: string) => run(() => api(`/besprechungen/${id}`, { method: 'PATCH', body: { base_version: d.version, allgemein: next } }), ok);
  if (!d.can_edit && !list.length) return null;
  return (
    <div>
      <div className="group-head"><h3>Allgemeine Informationen</h3><span className="sub">ohne Status, z. B. Arbeitsschutz, Ordnung, Zutrittszeiten</span></div>
      <div className="card">
        {list.map((a, i) => (
          <div key={i} className="row">
            {d.can_edit ? <input className="tb-left" defaultValue={a} onBlur={(e) => e.target.value !== a && void save(list.map((x, j) => (j === i ? e.target.value : x)), 'Gespeichert')} /> : <span className="k">• {a}</span>}
            {d.can_edit && <button className="btn small plain destructive" onClick={() => void save(list.filter((_, j) => j !== i), 'Entfernt')}>✕</button>}
          </div>
        ))}
        {d.can_edit && (
          <div className="row">
            <input className="tb-left" placeholder="+ Allgemeinen Hinweis hinzufügen" value={neu} onChange={(e) => setNeu(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && neu.trim()) { void save([...list, neu.trim()], 'Hinweis hinzugefügt'); setNeu(''); } }} />
            <button className="btn small" disabled={!neu.trim()} onClick={() => { void save([...list, neu.trim()], 'Hinweis hinzugefügt'); setNeu(''); }}>Hinzufügen</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Recipients and the mail text exactly as it will be sent. */
function VersandVorschau({ d, id, info }: { d: BesprechungDetail; id: string; info: ProjectInfo }) {
  const [mail, setMail] = useState<{ betreff: string; text: string } | null>(null);
  const [vt, setVt] = useState<{ name: string; email: string; aktiv: boolean }[]>([]);
  useEffect(() => {
    void api<{ betreff: string; text: string }>(`/besprechungen/${id}/mail`).then(setMail);
    void api<typeof vt>(`/projects/${info.project.id}/verteiler`).then(setVt);
  }, [id, info.project.id]);
  const extra = (d.extra_teilnehmer ?? []).filter((x) => x.email);
  const cc = (d.cc ?? '').split(/[,;\s]+/).filter((x) => x.includes('@'));
  return (
    <>
      <div className="group-title">Empfänger</div>
      <div className="group">
        {d.teilnehmer.filter((t) => t.kind !== 'own').map((t) => <div key={t.id} className="row"><span className="k">{t.name}</span><span className="v">{t.email ?? 'keine E-Mail hinterlegt'}</span></div>)}
        {vt.filter((v) => v.aktiv).map((v) => <div key={v.email} className="row"><span className="k">{v.name}<div className="sub">fester Verteiler</div></span><span className="v">{v.email}</span></div>)}
        {extra.map((x) => <div key={x.email!} className="row"><span className="k">{x.name}<div className="sub">manueller Teilnehmer</div></span><span className="v">{x.email}</span></div>)}
        {cc.map((x) => <div key={x} className="row"><span className="k">CC</span><span className="v">{x}</span></div>)}
      </div>
      {mail && (
        <>
          <div className="group-title" style={{ marginTop: 12 }}>E-Mail-Vorschau · {mail.betreff}</div>
          <div className="group"><pre className="mail-preview">{mail.text}</pre></div>
          <button className="btn plain" onClick={() => void navigator.clipboard.writeText(`Betreff: ${mail.betreff}\n\n${mail.text}`)}>E-Mail-Vorschau kopieren</button>
        </>
      )}
    </>
  );
}

/** Fixed distribution list and mail template of the project (concept point 7). */
function VerteilerSheet({ info, onClose, run }: { info: ProjectInfo; onClose: () => void; run: Run }) {
  const [list, setList] = useState<{ id: string; name: string; email: string; kategorie: keyof typeof VERTEILER_KATEGORIEN; aktiv: boolean }[]>([]);
  const [v, setV] = useState<MailVorlage | null>(null);
  const [neu, setNeu] = useState({ name: '', email: '', kategorie: 'bauleiter' as keyof typeof VERTEILER_KATEGORIEN });
  const load = useCallback(async () => {
    setList(await api(`/projects/${info.project.id}/verteiler`));
    setV(await api(`/projects/${info.project.id}/mail-vorlage`));
  }, [info.project.id]);
  useEffect(() => void load(), [load]);
  if (!v) return null;
  const preset = (k: 'standard' | 'kurz' | 'foermlich' | 'eigen') => setV(k === 'eigen' ? { ...v, preset: 'eigen' } : { ...v, preset: k, intro: MAIL_VORLAGEN[k].intro, outro: MAIL_VORLAGEN[k].outro });
  return (
    <Sheet title="Verteiler & Mail-Vorlage" primary="Vorlage sichern" wide onCancel={onClose}
      onPrimary={() => run(async () => { await api(`/projects/${info.project.id}/mail-vorlage`, { method: 'PUT', body: v }); onClose(); }, 'Mail-Vorlage gespeichert')}>
      <div className="group-title">E-Mail-Textvorlage</div>
      <div className="segmented" style={{ marginBottom: 8 }}>
        {(['standard', 'kurz', 'foermlich', 'eigen'] as const).map((k) => <button key={k} className={v.preset === k ? 'on' : ''} onClick={() => preset(k)}>{k === 'eigen' ? 'Eigene' : MAIL_VORLAGEN[k].name}</button>)}
      </div>
      <div className="group">
        <div className="row stack"><span className="sub">Einleitung (nach der Anrede, vor den Terminangaben)</span><textarea rows={3} value={v.intro} onChange={(e) => setV({ ...v, preset: 'eigen', intro: e.target.value })} /></div>
        <div className="row stack"><span className="sub">Schlusstext (nach den Punkten)</span><textarea rows={2} value={v.outro} onChange={(e) => setV({ ...v, preset: 'eigen', outro: e.target.value })} /></div>
        <div className="row stack"><span className="sub">Signatur</span><textarea rows={3} value={v.signatur} onChange={(e) => setV({ ...v, preset: 'eigen', signatur: e.target.value })} /></div>
      </div>
      <div className="group-title" style={{ marginTop: 16 }}>Fester Verteiler</div>
      <div className="group">
        {list.map((r) => (
          <div key={r.id} className="row"><span className="k">{r.name}<div className="sub">{VERTEILER_KATEGORIEN[r.kategorie]} · {r.email}</div></span>
            <span className="actions">
              <input type="checkbox" className="switch" checked={r.aktiv} onChange={(e) => void run(async () => { await api(`/projects/${info.project.id}/verteiler`, { method: 'PUT', body: { ...r, aktiv: e.target.checked } }); await load(); }, e.target.checked ? 'Aktiv' : 'Inaktiv')} />
              <button className="btn small plain destructive" onClick={() => void run(async () => { await api(`/verteiler/${r.id}`, { method: 'DELETE' }); await load(); }, 'Entfernt')}>✕</button>
            </span>
          </div>
        ))}
        <div className="row">
          <input className="tb-left" placeholder="Name / Funktion" value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} />
          <input placeholder="E-Mail" value={neu.email} onChange={(e) => setNeu({ ...neu, email: e.target.value })} />
          <select value={neu.kategorie} onChange={(e) => setNeu({ ...neu, kategorie: e.target.value as typeof neu.kategorie })}>{Object.entries(VERTEILER_KATEGORIEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn small" disabled={!neu.name.trim() || !neu.email.includes('@')} onClick={() => void run(async () => {
            await api(`/projects/${info.project.id}/verteiler`, { method: 'PUT', body: { id: crypto.randomUUID(), ...neu } });
            setNeu({ name: '', email: '', kategorie: neu.kategorie });
            await load();
          }, 'Empfänger hinzugefügt')}>Hinzufügen</button>
        </div>
      </div>
      <div className="footnote">Der feste Verteiler bekommt jedes versendete Protokoll dieses Projekts. Firmen mit Punkten und Teilnehmer werden automatisch ergänzt.</div>
    </Sheet>
  );
}
