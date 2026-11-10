/** Plan register (docs/fachkonzept/03): current released index, "Eingang / Zur Prüfung", history ("Alt"), upload, approval, QR check. */
import { useCallback, useEffect, useState } from 'react';
import { formatDate, nextPlanIndex, PLAN_REVISION_LABELS, type PlanRevisionStatus } from '@bap/domain';
import { api, ApiError, getToken, openPdf, type PlanEntry, type PlanRevision, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { Sheet, type Run } from './ui/layout';

const TONE: Record<PlanRevisionStatus, string> = { freigegeben: 'c-green', zur_pruefung: 'c-orange', abgelehnt: 'c-red', ersetzt: 'c-gray' };

export function Planregister({ info, run, onChanged }: { info: ProjectInfo; run: Run; onChanged: () => void }) {
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [upload, setUpload] = useState<{ plan?: PlanEntry } | null>(null);
  const [reject, setReject] = useState<PlanRevision | null>(null);
  const internal = info.role === 'bauleitung' || info.role === 'polier';
  const isBauleitung = info.role === 'bauleitung';
  const reload = useCallback(async () => setPlans((await api<{ plans: PlanEntry[] }>(`/projects/${info.project.id}/plaene`)).plans), [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const runAndReload: Run = async (fn, ok) => {
    await run(fn, ok);
    await reload();
    onChanged();
  };
  const inbox = plans.flatMap((p) => p.revisions.filter((r) => r.status === 'zur_pruefung').map((r) => ({ plan: p, r })));

  return (
    <div className="list-pad" style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {internal && (
        <div>
          <div className="group-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px 8px' }}>
            <h3 style={{ margin: 0 }}>Eingang / Zur Prüfung</h3>
            <button className="btn filled" onClick={() => setUpload({})}>
              <Icon name="plus" size={16} /> Plan hochladen
            </button>
          </div>
          <div className="card">
            {inbox.length === 0 && <div className="empty">Nichts zu prüfen</div>}
            <table className="table">
              <tbody>
                {inbox.map(({ plan, r }) => (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td>
                      <div className="desc">
                        {plan.name} · Index {r.plan_index}
                      </div>
                      <div className="sub">
                        hochgeladen {formatDate(r.uploaded_at)} von {r.uploaded_by_name}
                        {r.comment ? ` · „${r.comment}“` : ''}
                      </div>
                    </td>
                    <td style={{ width: 360, textAlign: 'right' }}>
                      <div className="meta-row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn small" onClick={() => run(() => openPdf(`/plan-revisions/${r.id}/pdf`), 'Plan geöffnet')}>
                          Ansehen
                        </button>
                        {isBauleitung && (
                          <>
                            <button className="btn small destructive" onClick={() => setReject(r)}>
                              Ablehnen …
                            </button>
                            <button
                              className="btn small filled"
                              onClick={() =>
                                runAndReload(
                                  () => api(`/plan-revisions/${r.id}/decision`, { method: 'POST', body: { decision: 'freigeben', base_version: r.version } }),
                                  `${plan.name} Index ${r.plan_index} freigegeben – alter Stand liegt unter „Alt“`,
                                )
                              }
                            >
                              Freigeben
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isBauleitung && inbox.length > 0 && <div className="footnote">Freigeben darf nur die Bauleitung.</div>}
        </div>
      )}

      <div>
        <div className="group-title">Gültige Pläne</div>
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Ort</th>
                <th>Index</th>
                <th>Freigegeben</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const current = p.revisions.find((r) => r.id === p.current_revision_id);
                const old = p.revisions.filter((r) => r.status === 'ersetzt' || r.status === 'abgelehnt');
                return (
                  <tr key={p.id} style={{ cursor: 'default' }}>
                    <td>
                      <div className="desc">{p.name}</div>
                      {internal && old.length > 0 && (
                        <div className="sub">
                          Alt:{' '}
                          {old.map((r, i) => (
                            <span key={r.id}>
                              {i > 0 && ', '}
                              <a href="#" onClick={(e) => (e.preventDefault(), run(() => openPdf(`/plan-revisions/${r.id}/pdf`), 'Alter Stand geöffnet'))}>
                                Index {r.plan_index} ({PLAN_REVISION_LABELS[r.status]})
                              </a>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{p.location_name}</td>
                    <td>
                      {current ? <span className={`pill ${TONE[current.status]}`}>Index {current.plan_index}</span> : <span className="pill c-orange">noch nicht freigegeben</span>}
                    </td>
                    <td className="sub">{current?.decided_at ? `${formatDate(current.decided_at)} · ${current.decided_by_name}` : '–'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="meta-row" style={{ justifyContent: 'flex-end' }}>
                        {current && (
                          <button className="btn small" onClick={() => run(() => openPdf(`/plan-revisions/${current.id}/pdf`), 'Plan mit QR-Code geöffnet')}>
                            Drucken (mit QR)
                          </button>
                        )}
                        {internal && (
                          <button className="btn small plain" onClick={() => setUpload({ plan: p })}>
                            Neuer Index
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="footnote">Ausgedruckte Pläne tragen einen QR-Code. Mit der iPhone-Kamera scannen: grüner Haken = aktueller Stand, rote Warnung = veraltet.</div>
      </div>

      {upload && <UploadSheet info={info} plan={upload.plan} onCancel={() => setUpload(null)} run={runAndReload} onDone={() => setUpload(null)} />}
      {reject && (
        <RejectSheet
          rev={reject}
          onCancel={() => setReject(null)}
          onReject={(comment) =>
            runAndReload(async () => {
              await api(`/plan-revisions/${reject.id}/decision`, { method: 'POST', body: { decision: 'ablehnen', comment, base_version: reject.version } });
              setReject(null);
            }, `Index ${reject.plan_index} abgelehnt`)
          }
        />
      )}
    </div>
  );
}

function UploadSheet({ info, plan, onCancel, run, onDone }: { info: ProjectInfo; plan?: PlanEntry; onCancel: () => void; run: Run; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const lastIndex = plan?.revisions[0]?.plan_index;
  const [f, setF] = useState({
    name: '',
    location_id: info.locations.find((l) => l.kind === 'geschoss')?.id ?? '',
    plan_index: lastIndex ? nextPlanIndex(lastIndex) : 'A',
    comment: '',
  });
  const send = () =>
    run(async () => {
      const fd = new FormData();
      fd.set('project_id', info.project.id);
      if (plan) fd.set('plan_id', plan.id);
      else {
        fd.set('name', f.name);
        fd.set('location_id', f.location_id);
      }
      fd.set('plan_index', f.plan_index);
      if (f.comment) fd.set('comment', f.comment);
      fd.set('file', file!); // file last: the server reads fields that come before it
      const res = await fetch('/api/plan-revisions', { method: 'POST', body: fd, headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      onDone();
    }, 'Hochgeladen – liegt im Eingang zur Prüfung');
  return (
    <Sheet title={plan ? `Neuer Index: ${plan.name}` : 'Plan hochladen'} primary="Hochladen" primaryDisabled={!file || (!plan && !f.name.trim())} onCancel={onCancel} onPrimary={send}>
      <label
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const fl = e.dataTransfer.files[0];
          if (fl) setFile(fl);
        }}
      >
        <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <strong>{file.name}</strong>
        ) : (
          <>
            PDF hierher ziehen oder <span style={{ color: 'var(--accent)' }}>auswählen</span>
          </>
        )}
      </label>
      <div className="group">
        {!plan && (
          <>
            <div className="row">
              <span className="k">Planname</span>
              <input placeholder="z. B. Grundriss 1. OG" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div className="row">
              <span className="k">Ort</span>
              <select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
                {info.locations
                  .filter((l) => l.kind !== 'raum')
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>
          </>
        )}
        <div className="row">
          <span className="k">Index</span>
          <input value={f.plan_index} onChange={(e) => setF({ ...f, plan_index: e.target.value.toUpperCase() })} style={{ maxWidth: 80 }} />
        </div>
        <div className="row stack">
          <textarea placeholder="Änderung / Hinweis (optional)" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} style={{ minHeight: 60 }} />
        </div>
      </div>
      <div className="footnote">Neue Pläne landen immer im Eingang „Zur Prüfung“ und sind erst nach der Freigabe durch die Bauleitung gültig.</div>
    </Sheet>
  );
}

function RejectSheet({ rev, onCancel, onReject }: { rev: PlanRevision; onCancel: () => void; onReject: (comment: string) => void }) {
  const [c, setC] = useState('');
  return (
    <Sheet title={`Index ${rev.plan_index} ablehnen`} primary="Ablehnen" destructive primaryDisabled={!c.trim()} onCancel={onCancel} onPrimary={() => onReject(c)}>
      <div className="group">
        <div className="row stack">
          <textarea autoFocus placeholder="Grund (Pflicht), z. B. „Maße Bad stimmen nicht mit Werkplanung überein“" value={c} onChange={(e) => setC(e.target.value)} />
        </div>
      </div>
    </Sheet>
  );
}

/** Page behind the QR code on printed plans: /check/<revision id>. */
export function CheckPage({ revisionId }: { revisionId: string }) {
  const [r, setR] = useState<{ plan_name: string; plan_index: string; current_index: string; current_released_at: string; project_name: string; is_current: boolean; status: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<typeof r>(`/plan-revisions/${revisionId}/check`).then(setR, (e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [revisionId]);
  if (err) return <div className="check-page"><div><h2>Plan nicht gefunden</h2><p className="sub">{err}</p></div></div>;
  if (!r) return <p className="loading">Prüfe Planstand …</p>;
  return (
    <div className="check-page">
      <div>
        <div className="big" style={{ background: r.is_current ? 'var(--green)' : 'var(--red)' }}>{r.is_current ? '✓' : '!'}</div>
        <h1 style={{ margin: '0 0 6px' }}>{r.is_current ? 'Aktueller Stand' : 'Veraltet'}</h1>
        <p style={{ fontSize: 17 }}>
          {r.plan_name} · Index {r.plan_index}
        </p>
        {!r.is_current && (
          <p style={{ color: 'var(--red)', fontWeight: 600 }}>
            Neuer Index {r.current_index} gültig seit {formatDate(r.current_released_at)} – diesen Ausdruck nicht mehr verwenden.
          </p>
        )}
        <p className="sub">{r.project_name}</p>
        <a className="btn" href="/">
          Zur App
        </a>
      </div>
    </div>
  );
}
