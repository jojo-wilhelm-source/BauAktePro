/** Digitale Stundenzettel (docs/fachkonzept/08): NU and Polier enter and submit, Bau-/Projektleitung confirm, cut or reject. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BEZUG_LABELS, computeHours, formatDate, stundenzettelNo, ZETTEL_STATUS_LABELS, type Bezug, type ZettelStatus } from '@bap/domain';
import { api, ApiError, getToken, openPdf, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface ZettelRow {
  id: string; number: number | null; company_id: string; company_name: string; period_from: string; period_to: string; status: ZettelStatus;
  hours_total: string; hours_approved: string | null; submitted_at: string | null; version: number; created_by_name: string; has_attachment: boolean; zeilen: number;
}
interface Zeile { id: string; datum: string; person: string; von: string | null; bis: string | null; pause_min: number; stunden: number | string; stunden_anerkannt?: string | null; taetigkeit: string; location_id: string | null; location_name?: string | null; bezug: Bezug }
interface ZettelDetail extends Omit<ZettelRow, 'zeilen'> { note: string | null; decision_reason: string | null; decided_by_name: string | null; attachment_key: string | null; zeilen: Zeile[]; can_edit: boolean; can_decide: boolean }

const TONE: Record<ZettelStatus, string> = { entwurf: 'c-gray', eingereicht: 'c-orange', bestaetigt: 'c-green', gekuerzt: 'c-indigo', abgelehnt: 'c-red' };
const h = (v: string | number | null | undefined) => (v == null ? '–' : `${Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`);
const today = () => new Date().toISOString().slice(0, 10);
const monday = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export function StundenPage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [rows, setRows] = useState<ZettelRow[]>([]);
  const [myCompany, setMyCompany] = useState('');
  const [scope, setScope] = useState<'offen' | 'alle'>('offen');
  const [edit, setEdit] = useState<ZettelDetail | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const leitung = info.role === 'bauleitung';
  const reload = useCallback(async () => {
    const r = await api<{ zettel: ZettelRow[]; companyId: string }>(`/projects/${info.project.id}/stundenzettel`);
    setRows(r.zettel);
    setMyCompany(r.companyId);
  }, [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const runAndReload: Run = async (fn, ok) => {
    await run(fn, ok);
    await reload();
  };
  const shown = rows.filter((r) => scope === 'alle' || r.status === 'entwurf' || r.status === 'eingereicht');
  const sumBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows.filter((x) => x.status === 'bestaetigt' || x.status === 'gekuerzt')) m.set(r.company_name, (m.get(r.company_name) ?? 0) + Number(r.hours_approved ?? 0));
    return [...m.entries()];
  }, [rows]);

  return (
    <>
      <PageHeader
        eyebrow={info.project.name}
        title="Stundenzettel"
        action={
          <button className="btn filled" onClick={() => setEdit('new')}>
            <Icon name="plus" size={16} /> Neuer Stundenzettel
          </button>
        }
      >
        <div className="segmented">
          <button className={scope === 'offen' ? 'on' : ''} onClick={() => setScope('offen')}>{leitung ? 'Zu prüfen / Entwürfe' : 'Offen'}</button>
          <button className={scope === 'alle' ? 'on' : ''} onClick={() => setScope('alle')}>Alle</button>
        </div>
        {sumBy.length > 0 && (
          <span className="sub" style={{ fontSize: 13 }}>
            Anerkannt: {sumBy.map(([c, s]) => `${c} ${h(s)}`).join(' · ')}
          </span>
        )}
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1100 }}>
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Nr.</th><th>Firma</th><th>Zeitraum</th><th className="money">Eingereicht</th><th className="money">Anerkannt</th><th>Status</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => setDetail(r.id)}>
                  <td className="num">{stundenzettelNo(r.number)}</td>
                  <td><div className="desc">{r.company_name}</div><div className="sub">{r.zeilen} Zeilen · erfasst von {r.created_by_name}{r.has_attachment ? ' · mit Anhang' : ''}</div></td>
                  <td className="tabular">{formatDate(r.period_from)} – {formatDate(r.period_to)}</td>
                  <td className="money">{h(r.hours_total)}</td>
                  <td className="money">{r.hours_approved == null ? '–' : h(r.hours_approved)}</td>
                  <td><span className={`pill ${TONE[r.status]}`}>{ZETTEL_STATUS_LABELS[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">Keine Stundenzettel</div>}
        </div>
        <div className="footnote">Ein Stundenzettel je Firma und Zeitraum. Nach dem Einreichen gesperrt; Bau- oder Projektleitung bestätigen, kürzen (mit Begründung) oder lehnen ab. Keine Lohnabrechnung.</div>
      </div>

      {detail && (
        <DetailSheet
          id={detail}
          onClose={() => setDetail(null)}
          onEdit={(d) => (setDetail(null), setEdit(d))}
          run={runAndReload}
        />
      )}
      {edit && <EditSheet info={info} zettel={edit === 'new' ? null : edit} myCompany={myCompany} run={runAndReload} onClose={() => setEdit(null)} />}
    </>
  );
}

function EditSheet({ info, zettel, myCompany, run, onClose }: { info: ProjectInfo; zettel: ZettelDetail | null; myCompany: string; run: Run; onClose: () => void }) {
  const nu = info.role === 'nu';
  const companies = nu ? info.companies.filter((c) => c.id === myCompany) : info.companies.filter((c) => c.kind !== 'bauherr');
  const newRow = (datum = today()): Zeile => ({ id: crypto.randomUUID(), datum, person: '', von: '07:00', bis: '16:00', pause_min: 30, stunden: computeHours('07:00', '16:00', 30) ?? 0, taetigkeit: '', location_id: null, bezug: 'hauptauftrag' });
  const [f, setF] = useState({
    id: zettel?.id ?? crypto.randomUUID(),
    company_id: zettel?.company_id ?? (nu ? myCompany : companies.find((c) => c.kind === 'own')?.id ?? companies[0]?.id ?? ''),
    period_from: zettel?.period_from?.slice(0, 10) ?? monday(),
    period_to: zettel?.period_to?.slice(0, 10) ?? today(),
    note: zettel?.note ?? '',
  });
  const [zeilen, setZeilen] = useState<Zeile[]>(zettel?.zeilen.map((z) => ({ ...z, datum: z.datum.slice(0, 10), von: z.von?.slice(0, 5) ?? null, bis: z.bis?.slice(0, 5) ?? null, stunden: Number(z.stunden) })) ?? [newRow()]);
  const set = (i: number, patch: Partial<Zeile>) =>
    setZeilen((zs) => zs.map((z, k) => {
      if (k !== i) return z;
      const n = { ...z, ...patch };
      // Hours follow from von/bis/Pause unless the person types them directly.
      if ('von' in patch || 'bis' in patch || 'pause_min' in patch) n.stunden = computeHours(n.von, n.bis, n.pause_min) ?? n.stunden;
      return n;
    }));
  const total = zeilen.reduce((s, z) => s + Number(z.stunden || 0), 0);
  const valid = zeilen.every((z) => z.person.trim() && z.taetigkeit.trim()) && f.company_id;
  const body = () => ({ ...f, project_id: info.project.id, note: f.note || null, zeilen: zeilen.map((z) => ({ ...z, stunden: Number(z.stunden), location_id: z.location_id || null })) });
  const save = (submit: boolean) =>
    run(async () => {
      const saved = await api<ZettelDetail>('/stundenzettel', { method: 'PUT', body: body() });
      if (submit) await api(`/stundenzettel/${saved.id}/submit`, { method: 'POST', body: { base_version: saved.version } });
      onClose();
    }, submit ? 'Stundenzettel eingereicht' : 'Entwurf gesichert');
  const rooms = info.locations.filter((l) => l.kind !== 'gebaeude');

  return (
    <Sheet wide title={zettel ? 'Stundenzettel bearbeiten' : 'Neuer Stundenzettel'} primary="Einreichen" primaryDisabled={!valid || !zeilen.length} onCancel={onClose} onPrimary={() => save(true)}>
      <div className="group">
        <div className="row">
          <span className="k">Firma</span>
          <select value={f.company_id} disabled={nu} onChange={(e) => setF({ ...f, company_id: e.target.value })}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="row">
          <span className="k">Zeitraum</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <input type="date" value={f.period_from} onChange={(e) => setF({ ...f, period_from: e.target.value })} />
            <input type="date" value={f.period_to} onChange={(e) => setF({ ...f, period_to: e.target.value })} />
          </span>
        </div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table edit-table">
          <thead>
            <tr><th style={{ width: 130 }}>Datum</th><th>Person</th><th style={{ width: 84 }}>von</th><th style={{ width: 84 }}>bis</th><th style={{ width: 70 }}>Pause min</th><th style={{ width: 76 }}>Stunden</th><th>Tätigkeit</th><th style={{ width: 120 }}>Ort</th><th style={{ width: 130 }}>Bezug</th><th style={{ width: 30 }} /></tr>
          </thead>
          <tbody>
            {zeilen.map((z, i) => (
              <tr key={z.id} style={{ cursor: 'default' }}>
                <td><input type="date" value={z.datum} onChange={(e) => set(i, { datum: e.target.value })} /></td>
                <td><input placeholder="Name" value={z.person} onChange={(e) => set(i, { person: e.target.value })} /></td>
                <td><input type="time" value={z.von ?? ''} onChange={(e) => set(i, { von: e.target.value || null })} /></td>
                <td><input type="time" value={z.bis ?? ''} onChange={(e) => set(i, { bis: e.target.value || null })} /></td>
                <td><input type="number" min={0} step={15} value={z.pause_min} onChange={(e) => set(i, { pause_min: Number(e.target.value) || 0 })} /></td>
                <td><input type="number" min={0} max={24} step={0.25} value={z.stunden} onChange={(e) => set(i, { stunden: e.target.value })} /></td>
                <td><input placeholder="z. B. Leerrohre verlegen" value={z.taetigkeit} onChange={(e) => set(i, { taetigkeit: e.target.value })} /></td>
                <td>
                  <select value={z.location_id ?? ''} onChange={(e) => set(i, { location_id: e.target.value || null })}>
                    <option value="">–</option>
                    {rooms.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </td>
                <td>
                  <select value={z.bezug} onChange={(e) => set(i, { bezug: e.target.value as Bezug })}>
                    {Object.entries(BEZUG_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </td>
                <td><button className="btn plain small destructive" title="Zeile löschen" onClick={() => setZeilen(zeilen.filter((_, k) => k !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="add-row" style={{ padding: '10px 12px', color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }} onClick={() => setZeilen([...zeilen, newRow(zeilen.at(-1)?.datum)])}>
          + Zeile
        </div>
      </div>
      <div className="meta-row" style={{ justifyContent: 'space-between' }}>
        <strong>Summe: {h(total)}</strong>
        <button className="btn" disabled={!valid} onClick={() => save(false)}>Als Entwurf sichern</button>
      </div>
      <div className="group"><div className="row stack"><textarea placeholder="Bemerkung (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ minHeight: 50 }} /></div></div>
      <div className="footnote">Stunden werden aus von/bis/Pause berechnet (Viertelstunden) und lassen sich überschreiben. Regie nur mit Anordnung. Den Papierzettel kann man nach dem Sichern als Foto/PDF anhängen.</div>
    </Sheet>
  );
}

function DetailSheet({ id, onClose, onEdit, run }: { id: string; onClose: () => void; onEdit: (d: ZettelDetail) => void; run: Run }) {
  const [d, setD] = useState<ZettelDetail | null>(null);
  const [mode, setMode] = useState<'view' | 'kuerzen' | 'ablehnen'>('view');
  const [reason, setReason] = useState('');
  const [cut, setCut] = useState<Record<string, string>>({});
  const load = useCallback(async () => setD(await api<ZettelDetail>(`/stundenzettel/${id}`)), [id]);
  useEffect(() => void load(), [load]);
  if (!d) return null;
  const decide = (decision: 'bestaetigen' | 'kuerzen' | 'ablehnen') =>
    run(async () => {
      await api(`/stundenzettel/${id}/decision`, {
        method: 'POST',
        body: { decision, reason: reason || undefined, base_version: d.version, zeilen: decision === 'kuerzen' ? Object.entries(cut).filter(([, v]) => v !== '').map(([zid, v]) => ({ id: zid, stunden_anerkannt: Number(v) })) : undefined },
      });
      onClose();
    }, decision === 'bestaetigen' ? 'Stunden bestätigt' : decision === 'kuerzen' ? 'Stunden gekürzt' : 'Stundenzettel abgelehnt');
  const primary = d.can_decide ? (mode === 'kuerzen' ? 'Kürzung speichern' : mode === 'ablehnen' ? 'Ablehnen' : 'Bestätigen') : d.can_edit ? 'Bearbeiten' : 'Schließen';
  return (
    <Sheet
      wide
      title={`${stundenzettelNo(d.number)} · ${d.company_name}`}
      primary={primary}
      destructive={mode === 'ablehnen'}
      primaryDisabled={(mode !== 'view' && !reason.trim()) || (mode === 'kuerzen' && !Object.values(cut).some((v) => v !== ''))}
      onCancel={onClose}
      onPrimary={() => (d.can_decide ? decide(mode === 'view' ? 'bestaetigen' : mode === 'kuerzen' ? 'kuerzen' : 'ablehnen') : d.can_edit ? onEdit(d) : onClose())}
    >
      <div className="meta-row">
        <span className={`pill ${TONE[d.status]}`}>{ZETTEL_STATUS_LABELS[d.status]}</span>
        <span className="sub">{formatDate(d.period_from)} – {formatDate(d.period_to)} · eingereicht {h(d.hours_total)}{d.hours_approved != null ? ` · anerkannt ${h(d.hours_approved)}` : ''}</span>
        {d.attachment_key && <button className="btn small" onClick={() => run(() => openPdf(`/stundenzettel/${id}/anhang`), 'Anhang geöffnet')}>Papierzettel ansehen</button>}
      </div>
      {d.decision_reason && <div className="warn-box"><strong>Begründung ({d.decided_by_name}):</strong> {d.decision_reason}</div>}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Datum</th><th>Person</th><th>Zeit</th><th>Tätigkeit</th><th>Ort</th><th>Bezug</th><th className="money">Stunden</th>{(mode === 'kuerzen' || d.status === 'gekuerzt') && <th className="money">Anerkannt</th>}</tr></thead>
          <tbody>
            {d.zeilen.map((z) => (
              <tr key={z.id} style={{ cursor: 'default' }}>
                <td className="tabular">{formatDate(z.datum)}</td>
                <td>{z.person}</td>
                <td className="tabular sub">{z.von?.slice(0, 5) ?? ''}–{z.bis?.slice(0, 5) ?? ''}{z.pause_min ? ` (−${z.pause_min} min)` : ''}</td>
                <td>{z.taetigkeit}</td>
                <td className="sub">{z.location_name ?? '–'}</td>
                <td><span className={`pill ${z.bezug === 'regie' ? 'c-orange' : z.bezug === 'nachtrag' ? 'c-indigo' : 'c-gray'}`}>{BEZUG_LABELS[z.bezug]}</span></td>
                <td className="money">{h(z.stunden)}</td>
                {mode === 'kuerzen' && (
                  <td style={{ width: 90 }}>
                    <input type="number" min={0} max={Number(z.stunden)} step={0.25} placeholder={String(Number(z.stunden))} value={cut[z.id] ?? ''} onChange={(e) => setCut({ ...cut, [z.id]: e.target.value })} style={{ width: 80 }} />
                  </td>
                )}
                {mode !== 'kuerzen' && d.status === 'gekuerzt' && <td className="money">{z.stunden_anerkannt != null ? h(z.stunden_anerkannt) : h(z.stunden)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {d.zeilen.length === 0 && <div className="empty">Keine Zeilen – siehe Anhang</div>}
      </div>
      {d.can_edit && (
        <label className="btn" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
          Papierzettel anhängen (Foto/PDF)
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void run(async () => {
                const fd = new FormData();
                fd.set('file', file);
                const res = await fetch(`/api/stundenzettel/${id}/anhang`, { method: 'POST', body: fd, headers: { authorization: `Bearer ${getToken()}` } });
                if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
                await load();
              }, 'Anhang gespeichert');
            }}
          />
        </label>
      )}
      {d.can_decide && (
        <>
          <div className="segmented">
            <button className={mode === 'view' ? 'on' : ''} onClick={() => setMode('view')}>Bestätigen</button>
            <button className={mode === 'kuerzen' ? 'on' : ''} onClick={() => setMode('kuerzen')}>Kürzen</button>
            <button className={mode === 'ablehnen' ? 'on' : ''} onClick={() => setMode('ablehnen')}>Ablehnen</button>
          </div>
          {mode !== 'view' && (
            <div className="group"><div className="row stack"><textarea autoFocus placeholder="Begründung (Pflicht, der Einreicher sieht sie)" value={reason} onChange={(e) => setReason(e.target.value)} /></div></div>
          )}
        </>
      )}
    </Sheet>
  );
}
