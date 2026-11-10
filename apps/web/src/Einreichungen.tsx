/** Nachträge & Rechnungen (docs/fachkonzept/11): the NU uploads, Bau- and Projektleitung check and decide. No payments. */
import { useCallback, useEffect, useState } from 'react';
import { einreichungNo, EINREICHUNG_STATUS_LABELS, formatDate, formatEuro, FREIGABEGRENZE_NETTO, RECHNUNG_ART_LABELS, type EinreichungStatus } from '@bap/domain';
import { api, ApiError, getToken, openPdf, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface Einreichung {
  id: string; number: number; company_id: string; company_name: string; kind: 'nachtrag' | 'rechnung'; rechnung_art: keyof typeof RECHNUNG_ART_LABELS | null;
  title: string; amount_net: number; file_name: string; note: string | null; status: EinreichungStatus; decision_reason: string | null;
  decided_at: string | null; decided_by_name: string | null; submitted_at: string; submitted_by_name: string; version: number;
}
const TONE: Record<EinreichungStatus, string> = { eingereicht: 'c-orange', in_pruefung: 'c-blue', freigegeben: 'c-green', gf_erforderlich: 'c-purple', abgelehnt: 'c-red', zurueckgezogen: 'c-gray' };

export function EinreichungenPage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [rows, setRows] = useState<Einreichung[]>([]);
  const [kind, setKind] = useState<'alle' | 'nachtrag' | 'rechnung'>('alle');
  const [submit, setSubmit] = useState<'nachtrag' | 'rechnung' | null>(null);
  const [reason, setReason] = useState<{ e: Einreichung; decision: 'ablehnen' | 'zuruecknehmen' } | null>(null);
  const leitung = info.role === 'bauleitung';
  const nu = info.role === 'nu';
  const reload = useCallback(async () => setRows((await api<{ einreichungen: Einreichung[] }>(`/projects/${info.project.id}/einreichungen`)).einreichungen), [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const runAndReload: Run = async (fn, ok) => {
    await run(fn, ok);
    await reload();
  };
  const decide = (e: Einreichung, decision: 'pruefen' | 'freigeben' | 'ablehnen' | 'zuruecknehmen' | 'zurueckziehen', why?: string) =>
    runAndReload(
      () => api(`/einreichungen/${e.id}/decision`, { method: 'POST', body: { decision, reason: why, base_version: e.version } }),
      { pruefen: 'In Prüfung genommen', freigeben: 'Entschieden', ablehnen: 'Abgelehnt – der NU sieht die Begründung', zuruecknehmen: 'Entscheidung zurückgenommen – wieder in Prüfung', zurueckziehen: 'Zurückgezogen' }[decision],
    );

  const section = (k: 'nachtrag' | 'rechnung') => {
    const list = rows.filter((r) => r.kind === k);
    const offen = list.filter((r) => r.status === 'eingereicht' || r.status === 'in_pruefung');
    const frei = list.filter((r) => r.status === 'freigegeben');
    const sum = (l: Einreichung[]) => formatEuro(l.reduce((s, r) => s + r.amount_net, 0));
    return (
      <div key={k}>
        <div className="group-head" style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '0 4px 8px' }}>
          <h3 style={{ margin: 0 }}>{k === 'nachtrag' ? 'Nachträge' : 'Rechnungen'}</h3>
          <span className="sub">
            offen {offen.length} · {sum(offen)} · {k === 'nachtrag' ? 'beauftragt' : 'freigegeben'} {sum(frei)} (netto)
          </span>
          <span style={{ flex: 1 }} />
          {(nu || leitung) && (
            <button className="btn small" onClick={() => setSubmit(k)}>
              <Icon name="plus" size={14} /> {k === 'nachtrag' ? 'Nachtrag' : 'Rechnung'} {nu ? 'einreichen' : 'erfassen'}
            </button>
          )}
        </div>
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Nr.</th><th>{k === 'nachtrag' ? 'Nachtrag' : 'Rechnung'}</th>{!nu && <th>Nachunternehmer</th>}<th className="money">Netto</th><th>Eingereicht</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {list.map((e) => {
                const decided = e.status === 'freigegeben' || e.status === 'abgelehnt' || e.status === 'gf_erforderlich';
                return (
                  <tr key={e.id} style={{ cursor: 'default', opacity: e.status === 'zurueckgezogen' ? 0.55 : 1 }}>
                    <td className="num">{einreichungNo(e.kind, e.number)}</td>
                    <td>
                      <div className="desc">{e.title}</div>
                      <div className="sub">{e.kind === 'nachtrag' ? 'Angebot' : RECHNUNG_ART_LABELS[e.rechnung_art!]}{e.note ? ` · ${e.note}` : ''}</div>
                      {e.decision_reason && <div className="sub" style={{ color: e.status === 'abgelehnt' ? 'var(--red)' : undefined }}>Begründung: {e.decision_reason}</div>}
                    </td>
                    {!nu && <td className="who">{e.company_name}</td>}
                    <td className="money">{formatEuro(e.amount_net)}</td>
                    <td className="sub">{formatDate(e.submitted_at)}<br />{e.submitted_by_name}</td>
                    <td>
                      <span className={`pill ${TONE[e.status]}`}>{EINREICHUNG_STATUS_LABELS[e.status]}</span>
                      {e.decided_at && <div className="sub">{formatDate(e.decided_at)} · {e.decided_by_name}</div>}
                    </td>
                    <td style={{ textAlign: 'right', width: 330 }}>
                      <div className="meta-row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn small" onClick={() => run(() => openPdf(`/einreichungen/${e.id}/file`), 'Datei geöffnet')}>PDF</button>
                        {leitung && (e.status === 'eingereicht' || e.status === 'in_pruefung') && (
                          <>
                            {e.status === 'eingereicht' && <button className="btn small plain" onClick={() => decide(e, 'pruefen')}>In Prüfung</button>}
                            <button className="btn small destructive" onClick={() => setReason({ e, decision: 'ablehnen' })}>Ablehnen …</button>
                            <button className="btn small filled" onClick={() => decide(e, 'freigeben')} title={k === 'nachtrag' && e.amount_net > FREIGABEGRENZE_NETTO ? 'Über der Freigabegrenze: geht an die Geschäftsführung' : undefined}>
                              {k === 'nachtrag' ? 'Beauftragen' : 'Freigeben'}
                            </button>
                          </>
                        )}
                        {leitung && decided && (
                          <button className="btn small plain" onClick={() => setReason({ e, decision: 'zuruecknehmen' })} title="Falsch geklickt? Die Entscheidung wird zurückgenommen, alles bleibt im Protokoll.">
                            Entscheidung zurücknehmen …
                          </button>
                        )}
                        {nu && e.status === 'eingereicht' && (
                          <button className="btn small destructive" onClick={() => decide(e, 'zurueckziehen')}>Zurückziehen</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 && <div className="empty">{k === 'nachtrag' ? 'Keine Nachträge' : 'Keine Rechnungen'}</div>}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Nachträge & Rechnungen">
        <div className="segmented">
          {([['alle', 'Beides'], ['nachtrag', 'Nachträge'], ['rechnung', 'Rechnungen']] as const).map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {(kind === 'alle' || kind === 'nachtrag') && section('nachtrag')}
        {(kind === 'alle' || kind === 'rechnung') && section('rechnung')}
        <div className="footnote">
          Bau- und Projektleitung sehen alle Einreichungen, der NU nur seine eigenen. Nachträge über {formatEuro(FREIGABEGRENZE_NETTO)} netto gehen an die Geschäftsführung.
          Falsch entschieden? „Entscheidung zurücknehmen“ setzt wieder auf „In Prüfung“ – das Protokoll behält beide Schritte. Freigeben löst keine Zahlung aus.
        </div>
      </div>
      {submit && <SubmitSheet info={info} initialKind={submit} run={runAndReload} onClose={() => setSubmit(null)} />}
      {reason && (
        <ReasonSheet
          title={reason.decision === 'ablehnen' ? `${reason.e.title} ablehnen` : 'Entscheidung zurücknehmen'}
          primary={reason.decision === 'ablehnen' ? 'Ablehnen' : 'Zurücknehmen'}
          placeholder={reason.decision === 'ablehnen' ? 'Begründung (Pflicht, der NU sieht sie)' : 'Warum? z. B. „Versehentlich freigegeben, Mengen noch prüfen“'}
          onCancel={() => setReason(null)}
          onOk={(r) => { const x = reason; setReason(null); void decide(x.e, x.decision, r); }}
        />
      )}
    </>
  );
}

function SubmitSheet({ info, initialKind, run, onClose }: { info: ProjectInfo; initialKind: 'nachtrag' | 'rechnung'; run: Run; onClose: () => void }) {
  const nu = info.role === 'nu';
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ kind: initialKind as 'nachtrag' | 'rechnung', rechnung_art: 'abschlag', title: '', amount: '', note: '', company_id: info.companies.find((c) => c.kind === 'nu')?.id ?? '' });
  const amount = Number(f.amount.replace(/\./g, '').replace(',', '.'));
  const valid = !!file && f.title.trim() && Number.isFinite(amount) && amount >= 0 && f.amount !== '';
  const send = () =>
    run(async () => {
      const fd = new FormData();
      fd.set('project_id', info.project.id);
      if (!nu) fd.set('company_id', f.company_id);
      fd.set('kind', f.kind);
      if (f.kind === 'rechnung') fd.set('rechnung_art', f.rechnung_art);
      fd.set('title', f.title);
      fd.set('amount_net', String(amount));
      if (f.note) fd.set('note', f.note);
      fd.set('file', file!);
      const res = await fetch('/api/einreichungen', { method: 'POST', body: fd, headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      onClose();
    }, 'Eingereicht – die Bauleitung wird informiert');
  return (
    <Sheet title={f.kind === 'nachtrag' ? 'Nachtrag einreichen' : 'Rechnung einreichen'} primary="Einreichen" primaryDisabled={!valid} onCancel={onClose} onPrimary={send}>
      <div className="segmented" style={{ width: '100%' }}>
        <button style={{ flex: 1 }} className={f.kind === 'rechnung' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'rechnung' })}>Rechnung</button>
        <button style={{ flex: 1 }} className={f.kind === 'nachtrag' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'nachtrag' })}>Nachtrag</button>
      </div>
      <div className="group">
        {!nu && (
          <div className="row"><span className="k">Nachunternehmer</span>
            <select value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}>{info.companies.filter((c) => c.kind === 'nu').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>
        )}
        {f.kind === 'rechnung' && (
          <div className="row"><span className="k">Art</span>
            <select value={f.rechnung_art} onChange={(e) => setF({ ...f, rechnung_art: e.target.value })}>{Object.entries(RECHNUNG_ART_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
        )}
        <div className="row"><span className="k">Bezeichnung</span><input placeholder={f.kind === 'nachtrag' ? 'z. B. Nachtrag 02 – Zusätzliche Steckdosen' : 'z. B. 2. Abschlagsrechnung'} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="row"><span className="k">Betrag netto (€)</span><input inputMode="decimal" placeholder="0,00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
      </div>
      <label className="drop">
        <input type="file" accept="application/pdf,application/xml,text/xml,image/jpeg,image/png" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? <strong>{file.name}</strong> : <>PDF (oder E-Rechnung XML) <span style={{ color: 'var(--accent)' }}>auswählen</span></>}
      </label>
      <div className="group"><div className="row stack"><textarea placeholder="Bemerkung (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ minHeight: 50 }} /></div></div>
      {f.kind === 'nachtrag' && Number.isFinite(amount) && amount > FREIGABEGRENZE_NETTO && <div className="footnote">Über {formatEuro(FREIGABEGRENZE_NETTO)} netto: Freigabe durch die Geschäftsführung.</div>}
    </Sheet>
  );
}

function ReasonSheet({ title, primary = 'Ablehnen', placeholder = 'Begründung (Pflicht, der NU sieht sie)', onCancel, onOk }: { title: string; primary?: string; placeholder?: string; onCancel: () => void; onOk: (r: string) => void }) {
  const [r, setR] = useState('');
  return (
    <Sheet title={title} primary={primary} destructive={primary === 'Ablehnen'} primaryDisabled={!r.trim()} onCancel={onCancel} onPrimary={() => onOk(r)}>
      <div className="group"><div className="row stack"><textarea autoFocus placeholder={placeholder} value={r} onChange={(e) => setR(e.target.value)} /></div></div>
    </Sheet>
  );
}
