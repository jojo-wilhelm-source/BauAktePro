/** NU-Besprechung (docs/fachkonzept/09): list, protocol view, status chips, new Punkte, send, follow-up meeting. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { besprechungNo, formatDate, nextPunktStatus, punktNo, PUNKT_STATUS, PUNKT_STATUS_LABELS, PUNKT_TONE, type PunktStatus } from '@bap/domain';
import { api, openPdf, type BesprechungDetail, type BesprechungListItem, type Mangel, type ProjectInfo, type Punkt } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';
import { mNo } from './ui/status';

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
    <button className={cls} onClick={onClick} title="Antippen: Offen → In Arbeit → Erledigt">
      <span className="dot" />
      {PUNKT_STATUS_LABELS[status]}
    </button>
  );
}

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
      />
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
              {list.map((b) => (
                <tr key={b.id} onClick={() => props.onOpen(b.id)}>
                  <td className="num">{besprechungNo(b.number)}</td>
                  <td>
                    <div className="desc">{b.title}</div>
                    <div className="sub">
                      {fmtDateTime(b.held_at)}
                      {b.place ? ` · ${b.place}` : ''}
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
          {list.length === 0 && <div className="empty">Noch keine Besprechungen</div>}
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
  const [confirm, setConfirm] = useState(false);
  const [listFor, setListFor] = useState('');
  const load = useCallback(async () => setD(await api<BesprechungDetail>(`/besprechungen/${id}`)), [id]);
  useEffect(() => void load(), [load]);
  const runAndLoad: Run = async (fn, ok) => {
    await run(fn, ok);
    await load();
  };

  const groups = useMemo(() => {
    if (!d) return [];
    const key = (p: Punkt) =>
      group === 'ort' ? (p.location_name ?? 'Allgemein') : group === 'firma' ? (p.responsible_name ?? 'Ohne Verantwortlichen') : PUNKT_STATUS_LABELS[shown(p)];
    const order = (k: string) =>
      group === 'ort' ? (k === 'Allgemein' ? '0' : `1${info.locations.find((l) => l.name === k)?.id ?? k}`) : group === 'status' ? String(PUNKT_STATUS.map((s) => PUNKT_STATUS_LABELS[s]).indexOf(k)) : k;
    const map = new Map<string, Punkt[]>();
    for (const p of d.punkte) map.set(key(p), [...(map.get(key(p)) ?? []), p]);
    if (group === 'ort' && d.can_edit) {
      // Empty Geschosse can be filled during the meeting.
      for (const l of info.locations.filter((x) => x.kind === 'geschoss')) if (!map.has(l.name)) map.set(l.name, []);
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
                      body: { id: crypto.randomUUID(), project_id: info.project.id, kind: d.kind, title: d.title, held_at: new Date(Date.now() + 7 * 86400000).toISOString(), place: d.place, previous_id: d.id },
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
        {groups.map(([name, punkte]) => (
          <div key={name}>
            <div className="group-head">
              <h3>{name}</h3>
              <span className="sub">{punkte.length} Punkte</span>
            </div>
            <div className="card">
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
                  {punkte.map((p) => {
                    const st = shown(p);
                    const overdue = p.due_date && st !== 'erledigt' && st !== 'info' && p.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10);
                    return (
                      <tr key={p.id} style={{ cursor: 'default' }}>
                        <td className="num">
                          {punktNo(p.number)}
                          {p.carried && <span className="badge-w" title="Aus der vorigen Besprechung übernommen">W</span>}
                        </td>
                        <td>{p.gewerk_name ?? <span className="sub">–</span>}</td>
                        <td>
                          {sent ? (p.text_snapshot ?? p.text) : p.text}
                          {p.internal && <span className="tag critical" style={{ marginLeft: 6 }}>nur intern</span>}
                        </td>
                        <td>
                          <div className="who">{p.responsible_name ?? '–'}</div>
                          {p.support_names.length > 0 && <div className="sub">Zuarbeit: {p.support_names.join(', ')}</div>}
                        </td>
                        <td className="tabular" style={overdue ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
                          {formatDate(p.due_date)}
                        </td>
                        <td>
                          <StatusChip
                            status={st}
                            onClick={
                              d.can_edit && st !== 'info'
                                ? () => runAndLoad(() => api(`/punkte/${p.id}`, { method: 'PATCH', body: { base_version: p.version, status: nextPunktStatus(p.status) } }), `${punktNo(p.number)}: ${PUNKT_STATUS_LABELS[nextPunktStatus(p.status)]}`)
                                : undefined
                            }
                          />
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
                    );
                  })}
                </tbody>
              </table>
              {d.can_edit && group === 'ort' && (
                <div className="add-row" onClick={() => setAdding({ location_id: info.locations.find((l) => l.name === name)?.id ?? null })}>
                  + Punkt in „{name}“
                </div>
              )}
              {punkte.length === 0 && !d.can_edit && <div className="empty">Keine Punkte</div>}
            </div>
          </div>
        ))}

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
        <div className="footnote">W = aus der vorigen Besprechung übernommen. Status antippen: Offen → In Arbeit → Erledigt. Erledigte Punkte werden in der Folgesitzung archiviert.</div>
      </div>

      {adding && (
        <NewPunktSheet
          info={info}
          d={d}
          locationId={adding.location_id}
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
          <div className="group">
            {d.teilnehmer
              .filter((t) => t.kind !== 'own')
              .map((t) => (
                <div key={t.id} className="row">
                  <span className="k">{t.name}</span>
                  <span className="v">{t.email ?? 'keine E-Mail hinterlegt'}</span>
                </div>
              ))}
          </div>
          <div className="footnote">
            Jede Firma bekommt das Protokoll und ihre persönliche Aufgabenliste als PDF. Punkte „nur intern“ werden nicht versendet. Danach ist das Protokoll gesperrt;
            Änderungen gehen in die Folgesitzung.
          </div>
        </Sheet>
      )}
    </>
  );
}

function NewPunktSheet(props: {
  info: ProjectInfo;
  d: BesprechungDetail;
  locationId: string | null;
  onCancel: () => void;
  onSave: (body: object) => void;
}) {
  const { info, d } = props;
  const orte = info.locations.filter((l) => l.kind !== 'raum');
  const [f, setF] = useState({
    text: '',
    location_id: props.locationId ?? '',
    gewerk_id: '',
    responsible_company_id: '',
    support: [] as string[],
    due_date: '',
    status: 'offen' as PunktStatus,
    internal: false,
  });
  // Suggest the responsible company from the Gewerk (same mapping as for Mängel).
  const setGewerk = (g: string) => {
    const nu = info.gewerkCompanies.find((gc) => gc.gewerk_id === g)?.company_id;
    setF({ ...f, gewerk_id: g, responsible_company_id: f.responsible_company_id || nu || '' });
  };
  return (
    <Sheet
      title="Neuer Punkt"
      primary="Sichern"
      primaryDisabled={!f.text.trim()}
      onCancel={props.onCancel}
      onPrimary={() =>
        props.onSave({
          id: crypto.randomUUID(),
          besprechung_id: d.id,
          text: f.text,
          location_id: f.location_id || null,
          gewerk_id: f.gewerk_id || null,
          responsible_company_id: f.responsible_company_id || null,
          support_company_ids: f.support,
          due_date: f.due_date || null,
          status: f.status,
          internal: f.internal,
        })
      }
    >
      <div className="group">
        <div className="row stack">
          <textarea autoFocus placeholder="Aufgabe, z. B. „Raum 04.035 fertigstellen“" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        </div>
      </div>
      <div className="group">
        <div className="row">
          <span className="k">Ort</span>
          <select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
            <option value="">Allgemein</option>
            {orte.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span className="k">Gewerk</span>
          <select value={f.gewerk_id} onChange={(e) => setGewerk(e.target.value)}>
            <option value="">–</option>
            {info.gewerke.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span className="k">Verantwortlich</span>
          <select value={f.responsible_company_id} onChange={(e) => setF({ ...f, responsible_company_id: e.target.value })}>
            <option value="">–</option>
            {info.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span className="k">Frist</span>
          <input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </div>
      </div>
      <div>
        <div className="group-title">Zuarbeit</div>
        <div className="group">
          <div className="row tokens">
            {info.companies
              .filter((c) => c.kind === 'nu' && c.id !== f.responsible_company_id)
              .map((c) => (
                <button
                  key={c.id}
                  className={`token ${f.support.includes(c.id) ? 'on' : ''}`}
                  onClick={() => setF({ ...f, support: f.support.includes(c.id) ? f.support.filter((x) => x !== c.id) : [...f.support, c.id] })}
                >
                  {c.name}
                </button>
              ))}
          </div>
        </div>
      </div>
      <div>
        <div className="group-title">Status</div>
        <div className="segmented" style={{ width: '100%' }}>
          {PUNKT_STATUS.map((s) => (
            <button key={s} style={{ flex: 1 }} className={f.status === s ? 'on' : ''} onClick={() => setF({ ...f, status: s })}>
              {PUNKT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <label className="group row" style={{ cursor: 'pointer' }}>
        <span className="k">Nur intern (nicht versenden, für NU unsichtbar)</span>
        <input type="checkbox" checked={f.internal} onChange={(e) => setF({ ...f, internal: e.target.checked })} style={{ maxWidth: 'none' }} />
      </label>
    </Sheet>
  );
}

function NewBesprechungSheet({ info, onCancel, onSave }: { info: ProjectInfo; onCancel: () => void; onSave: (b: { id: string } & Record<string, unknown>) => void }) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ title: 'NU-Besprechung', held_at: local, place: 'Baucontainer', companies: info.companies.filter((c) => c.kind !== 'bauherr').map((c) => c.id) });
  return (
    <Sheet
      title="Neue Besprechung"
      primary="Anlegen"
      primaryDisabled={!f.title.trim()}
      onCancel={onCancel}
      onPrimary={() =>
        onSave({ id: crypto.randomUUID(), project_id: info.project.id, kind: 'nu', title: f.title, held_at: new Date(f.held_at).toISOString(), place: f.place || null, company_ids: f.companies })
      }
    >
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
