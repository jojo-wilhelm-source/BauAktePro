/** Baustellen-Einkäufe and Fahrtenbuch (docs/fachkonzept/14). On site both are recorded on the phone, also offline. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EINKAUF_STATUS_LABELS, FAHRZEUG_ARTEN, formatDate, formatEuro, kmWarnung, nettoAusBrutto, ZAHLUNGSART_LABELS, type EinkaufStatus, type FahrzeugArt, type Zahlungsart } from '@bap/domain';
import { api, ApiError, getToken, openPdf, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

const today = () => new Date().toISOString().slice(0, 10);
const parseNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
async function uploadBeleg(url: string, file: File) {
  const fd = new FormData();
  fd.set('file', file);
  const res = await fetch(`/api${url}`, { method: 'POST', body: fd, headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
}

// --- Einkäufe ----------------------------------------------------------------------------

interface Einkauf {
  id: string; number: number; gekauft_von: string; datum: string; haendler: string; brutto: number; netto: number; mwst: number; gewerk_name: string | null;
  zweck: string; zahlungsart: Zahlungsart; has_beleg: boolean; status: EinkaufStatus; erstattet: boolean; decision_reason: string | null;
  decided_at: string | null; decided_by_name: string | null; created_by_name: string; version: number;
}
const EK_TONE: Record<EinkaufStatus, string> = { eingereicht: 'c-orange', freigegeben: 'c-green', abgelehnt: 'c-red' };

export function EinkaeufePage({ info, me, run }: { info: ProjectInfo; me: { name: string }; run: Run }) {
  const [rows, setRows] = useState<Einkauf[]>([]);
  const [neu, setNeu] = useState(false);
  const [reject, setReject] = useState<Einkauf | null>(null);
  const [korr, setKorr] = useState<Einkauf | null>(null);
  const [scope, setScope] = useState<'offen' | 'alle' | 'erstatten'>('offen');
  const leitung = info.role === 'bauleitung';
  const reload = useCallback(async () => setRows((await api<{ einkaeufe: Einkauf[] }>(`/projects/${info.project.id}/einkaeufe`)).einkaeufe), [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const runAndReload: Run = async (fn, ok) => {
    await run(fn, ok);
    await reload();
  };
  const decide = (e: Einkauf, decision: 'freigeben' | 'ablehnen' | 'zuruecknehmen' | 'erstattet', reason?: string) =>
    runAndReload(() => api(`/einkaeufe/${e.id}/decision`, { method: 'POST', body: { decision, reason, base_version: e.version } }),
      { freigeben: 'Freigegeben – fließt in die Kosten', ablehnen: 'Abgelehnt', zuruecknehmen: 'Entscheidung zurückgenommen', erstattet: e.erstattet ? 'Erstattung zurückgesetzt' : 'Zur Erstattung an die Buchhaltung übergeben' }[decision]);
  const shown = rows.filter((r) => scope === 'alle' || (scope === 'offen' ? r.status === 'eingereicht' : r.status === 'freigegeben' && r.zahlungsart === 'privat' && !r.erstattet));
  const zuErstatten = useMemo(() => {
    const m = new Map<string, number>();
    rows.filter((r) => r.status === 'freigegeben' && r.zahlungsart === 'privat' && !r.erstattet).forEach((r) => m.set(r.gekauft_von, (m.get(r.gekauft_von) ?? 0) + r.brutto));
    return [...m.entries()];
  }, [rows]);

  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Baustellen-Einkäufe" action={<button className="btn filled" onClick={() => setNeu(true)}><Icon name="plus" size={16} /> Einkauf erfassen</button>}>
        <div className="segmented">
          <button className={scope === 'offen' ? 'on' : ''} onClick={() => setScope('offen')}>{leitung ? 'Zu prüfen' : 'Offen'}</button>
          <button className={scope === 'erstatten' ? 'on' : ''} onClick={() => setScope('erstatten')}>Zu erstatten</button>
          <button className={scope === 'alle' ? 'on' : ''} onClick={() => setScope('alle')}>Alle</button>
        </div>
        <span className="sub" style={{ fontSize: 13 }}>Freigegeben gesamt: {formatEuro(rows.filter((r) => r.status === 'freigegeben').reduce((s, r) => s + r.netto, 0))} netto</span>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1180 }}>
        {scope === 'erstatten' && zuErstatten.length > 0 && (
          <div className="group" style={{ marginBottom: 16 }}>
            {zuErstatten.map(([wer, b]) => <div key={wer} className="row"><span className="k">{wer}</span><span className="v money">{formatEuro(b)} brutto</span></div>)}
          </div>
        )}
        <div className="card">
          <table className="table">
            <thead><tr><th>Nr.</th><th>Einkauf</th><th>Gekauft von</th><th className="money">Brutto</th><th className="money">Netto</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} style={{ cursor: 'default' }}>
                  <td className="num">EK-{String(e.number).padStart(3, '0')}</td>
                  <td>
                    <div className="desc">{e.haendler} · {e.zweck}</div>
                    <div className="sub">{formatDate(e.datum)} · {ZAHLUNGSART_LABELS[e.zahlungsart]}{e.gewerk_name ? ` · ${e.gewerk_name}` : ''}{e.erstattet ? ' · erstattet' : ''}</div>
                    {e.decision_reason && <div className="sub" style={{ color: 'var(--red)' }}>Grund: {e.decision_reason}</div>}
                  </td>
                  <td>{e.gekauft_von}<div className="sub">erfasst von {e.created_by_name}</div></td>
                  <td className="money">{formatEuro(e.brutto)}</td>
                  <td className="money sub">{formatEuro(e.netto)}</td>
                  <td><span className={`pill ${EK_TONE[e.status]}`}>{EINKAUF_STATUS_LABELS[e.status]}</span></td>
                  <td style={{ textAlign: 'right', width: 330 }}>
                    <div className="meta-row" style={{ justifyContent: 'flex-end' }}>
                      {e.status === 'eingereicht' && <button className="btn small plain" onClick={() => setKorr(e)}>Ändern</button>}
                      {e.has_beleg ? <button className="btn small" onClick={() => run(() => openPdf(`/einkaeufe/${e.id}/beleg`), 'Beleg geöffnet')}>Beleg</button> : (
                        <label className="btn small plain" style={{ cursor: 'pointer' }}>Beleg anhängen
                          <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void runAndReload(() => uploadBeleg(`/einkaeufe/${e.id}/beleg`, f), 'Beleg gespeichert'); }} />
                        </label>
                      )}
                      {leitung && e.status === 'eingereicht' && (<>
                        <button className="btn small destructive" onClick={() => setReject(e)}>Ablehnen …</button>
                        <button className="btn small filled" onClick={() => decide(e, 'freigeben')}>Freigeben</button>
                      </>)}
                      {leitung && e.status === 'freigegeben' && e.zahlungsart === 'privat' && <button className="btn small" onClick={() => decide(e, 'erstattet')}>{e.erstattet ? 'Erstattung zurücksetzen' : 'Erstattet'}</button>}
                      {leitung && e.status !== 'eingereicht' && !e.erstattet && <button className="btn small plain" onClick={() => decide(e, 'zuruecknehmen')}>Zurücknehmen</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="empty">Keine Einkäufe</div>}
        </div>
        <div className="footnote">Auf der Baustelle: in der iPhone-App unter „Mehr“ mit Foto vom Beleg, auch ohne Netz. Freigegebene Einkäufe fließen in die Kostenübersicht; privat Ausgelegtes wird an die Buchhaltung zur Erstattung übergeben (die App zahlt nicht aus).</div>
      </div>
      {korr && <KorrekturSheet title={`EK-${String(korr.number).padStart(3, '0')} ändern`} url={`/einkaeufe/${korr.id}`} run={runAndReload} onClose={() => setKorr(null)}
        fields={[{ key: 'haendler', label: 'Händler' }, { key: 'zweck', label: 'Wofür' }, { key: 'betrag_brutto', label: 'Betrag brutto (€)', type: 'number' }, { key: 'datum', label: 'Datum', type: 'date' }, { key: 'gekauft_von', label: 'Gekauft von' }]}
        initial={{ haendler: korr.haendler, zweck: korr.zweck, betrag_brutto: korr.brutto, datum: korr.datum, gekauft_von: korr.gekauft_von }} />}
      {neu && <EinkaufSheet info={info} me={me} run={runAndReload} onClose={() => setNeu(false)} />}
      {reject && <Reason title="Einkauf ablehnen" onCancel={() => setReject(null)} onOk={(r) => { const e = reject; setReject(null); void decide(e, 'ablehnen', r); }} />}
    </>
  );
}

function EinkaufSheet({ info, me, run, onClose }: { info: ProjectInfo; me: { name: string }; run: Run; onClose: () => void }) {
  const [f, setF] = useState({ gekauft_von: me.name, datum: today(), haendler: '', brutto: '', mwst: 19, gewerk_id: '', zweck: '', zahlungsart: 'firmenkarte' as Zahlungsart });
  const [beleg, setBeleg] = useState<File | null>(null);
  const brutto = parseNum(f.brutto);
  const valid = f.haendler.trim() && f.zweck.trim() && f.brutto !== '' && brutto >= 0;
  return (
    <Sheet title="Einkauf erfassen" primary="Einreichen" primaryDisabled={!valid} onCancel={onClose}
      onPrimary={() => run(async () => {
        const id = crypto.randomUUID();
        await api('/einkaeufe', { method: 'POST', body: { id, project_id: info.project.id, gekauft_von: f.gekauft_von, datum: f.datum, haendler: f.haendler, betrag_brutto: brutto, mwst_satz: f.mwst, gewerk_id: f.gewerk_id || null, zweck: f.zweck, zahlungsart: f.zahlungsart } });
        if (beleg) await uploadBeleg(`/einkaeufe/${id}/beleg`, beleg);
        onClose();
      }, 'Einkauf eingereicht')}>
      <div className="group">
        <div className="row"><span className="k">Händler</span><input autoFocus placeholder="z. B. Bauhaus" value={f.haendler} onChange={(e) => setF({ ...f, haendler: e.target.value })} /></div>
        <div className="row"><span className="k">Wofür</span><input placeholder="z. B. Abdeckfolie" value={f.zweck} onChange={(e) => setF({ ...f, zweck: e.target.value })} /></div>
        <div className="row"><span className="k">Betrag brutto (€)</span><input inputMode="decimal" placeholder="0,00" value={f.brutto} onChange={(e) => setF({ ...f, brutto: e.target.value })} /></div>
        <div className="row"><span className="k">MwSt</span>
          <div className="segmented">{[19, 7, 0].map((m) => <button key={m} className={f.mwst === m ? 'on' : ''} onClick={() => setF({ ...f, mwst: m })}>{m} %</button>)}</div>
        </div>
        {f.brutto !== '' && <div className="row"><span className="k">Netto</span><span className="v">{formatEuro(nettoAusBrutto(brutto, f.mwst))}</span></div>}
        <div className="row"><span className="k">Bezahlt mit</span>
          <select value={f.zahlungsart} onChange={(e) => setF({ ...f, zahlungsart: e.target.value as Zahlungsart })}>{Object.entries(ZAHLUNGSART_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </div>
        <div className="row"><span className="k">Gekauft von</span><input value={f.gekauft_von} onChange={(e) => setF({ ...f, gekauft_von: e.target.value })} /></div>
        <div className="row"><span className="k">Datum</span><input type="date" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} /></div>
        <div className="row"><span className="k">Gewerk</span><select value={f.gewerk_id} onChange={(e) => setF({ ...f, gewerk_id: e.target.value })}><option value="">Baustelle allgemein</option>{info.gewerke.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
      </div>
      <label className="drop"><input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => setBeleg(e.target.files?.[0] ?? null)} />{beleg ? <strong>{beleg.name}</strong> : <>Beleg (Foto/PDF) <span style={{ color: 'var(--accent)' }}>anhängen</span></>}</label>
    </Sheet>
  );
}

// --- Fahrtenbuch --------------------------------------------------------------------------

interface Fahrzeug { id: string; kennzeichen: string; bezeichnung: string; kraftstoff: string; fahrer_name: string | null; last_km: number | null; art: FahrzeugArt; last_bh: number | null; bestand: number | null; kapazitaet_l: number | null }
interface Fahrt { id: string; fahrzeug_id: string; datum: string; km_start: number; km_ende: number; km: number; zweck: string; fahrer_name: string; project_name: string | null }
interface Tanken { id: string; fahrzeug_id: string; datum: string; liter_f: number; betrag_f: number | null; km_stand: number | null; bh: number | null; tankstelle: string | null; quelle_name: string | null; fahrer_name: string; verbrauch: number | null; verbrauch_h: number | null; has_beleg: boolean }

export function FahrtenbuchPage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [d, setD] = useState<{ leitung: boolean; fahrzeuge: Fahrzeug[]; fahrten: Fahrt[]; tanken: Tanken[] } | null>(null);
  const [fz, setFz] = useState<string>('alle');
  const [sheet, setSheet] = useState<'fahrt' | 'tanken' | 'fahrzeug' | null>(null);
  const [korrFahrt, setKorrFahrt] = useState<Fahrt | null>(null);
  const [korrTanken, setKorrTanken] = useState<Tanken | null>(null);
  const reload = useCallback(async () => setD(await api('/fahrtenbuch')), []);
  useEffect(() => void reload(), [reload]);
  const runAndReload: Run = async (fn, ok) => {
    await run(fn, ok);
    await reload();
  };
  if (!d) return <p className="loading">Fahrtenbuch wird geladen …</p>;
  const fahrten = d.fahrten.filter((f) => fz === 'alle' || f.fahrzeug_id === fz);
  const tanken = d.tanken.filter((t) => fz === 'alle' || t.fahrzeug_id === fz);
  const month = new Date().toISOString().slice(0, 7);
  const kmMonat = fahrten.filter((f) => f.datum.slice(0, 7) === month).reduce((s, f) => s + f.km, 0);
  const literMonat = tanken.filter((t) => t.datum.slice(0, 7) === month).reduce((s, t) => s + t.liter_f, 0);
  const name = (id: string) => d.fahrzeuge.find((x) => x.id === id);
  const csv = () => {
    const lines = [['Datum', 'Fahrzeug', 'Fahrer', 'km Start', 'km Ende', 'km', 'Projekt', 'Zweck'].join(';'),
      ...fahrten.map((f) => [formatDate(f.datum), name(f.fahrzeug_id)?.kennzeichen, f.fahrer_name, f.km_start, f.km_ende, f.km, f.project_name ?? '', f.zweck].join(';'))];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Fahrtenbuch-${month}.csv`;
    a.click();
  };
  return (
    <>
      <PageHeader eyebrow="Eigene Firma · alle Projekte" title="Fahrtenbuch" action={
        <div className="meta-row">
          {d.leitung && <button className="btn" onClick={() => setSheet('fahrzeug')}>Fahrzeug</button>}
          <button className="btn" onClick={() => setSheet('tanken')}>Tanken</button>
          <button className="btn filled" onClick={() => setSheet('fahrt')}><Icon name="plus" size={16} /> Fahrt</button>
        </div>}>
        <select className="popup" value={fz} onChange={(e) => setFz(e.target.value)}>
          <option value="alle">Alle Fahrzeuge</option>
          {d.fahrzeuge.map((f) => <option key={f.id} value={f.id}>{f.kennzeichen} · {f.bezeichnung}</option>)}
        </select>
        <span className="sub" style={{ fontSize: 13 }}>Dieser Monat: {kmMonat.toLocaleString('de-DE')} km · {literMonat.toLocaleString('de-DE', { maximumFractionDigits: 1 })} l getankt</span>
        <button className="btn small" onClick={csv}>Export CSV</button>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1180, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div>
          <div className="group-title">Fahrzeuge, Maschinen, Tankstellen</div>
          <div className="group">
            {d.fahrzeuge.map((x) => (
              <div key={x.id} className="row">
                <span className="k">{x.bezeichnung}<div className="sub">{FAHRZEUG_ARTEN[x.art]} · {x.kennzeichen}{x.fahrer_name ? ` · ${x.fahrer_name}` : ''}</div></span>
                <span className="v">{x.art === 'tankstelle' ? `Bestand ${Math.round(x.bestand ?? 0).toLocaleString('de-DE')} l${x.kapazitaet_l ? ` von ${Number(x.kapazitaet_l).toLocaleString('de-DE')} l` : ''}`
                  : x.art === 'maschine' ? (x.last_bh != null ? `${x.last_bh.toLocaleString('de-DE')} Bh` : '–') : (x.last_km != null ? `${x.last_km.toLocaleString('de-DE')} km` : '–')}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="group-title">Fahrten {d.leitung ? '(alle Fahrer)' : '(meine)'}</div>
          <div className="card">
            <table className="table">
              <thead><tr><th>Datum</th><th>Fahrzeug</th><th>Fahrer</th><th className="money">km-Stand</th><th className="money">km</th><th>Zweck</th><th /></tr></thead>
              <tbody>{fahrten.map((f) => (
                <tr key={f.id} style={{ cursor: 'default' }}>
                  <td className="tabular">{formatDate(f.datum)}</td><td>{name(f.fahrzeug_id)?.kennzeichen}</td><td>{f.fahrer_name}</td>
                  <td className="money sub">{f.km_start.toLocaleString('de-DE')} – {f.km_ende.toLocaleString('de-DE')}</td><td className="money">{f.km.toLocaleString('de-DE')}</td>
                  <td>{f.zweck}<div className="sub">{f.project_name ?? 'ohne Projekt'}</div></td>
                  <td><button className="btn small plain" onClick={() => setKorrFahrt(f)}>Korrigieren</button></td>
                </tr>))}</tbody>
            </table>
            {fahrten.length === 0 && <div className="empty">Keine Fahrten</div>}
          </div>
        </div>
        <div>
          <div className="group-title">Tanken</div>
          <div className="card">
            <table className="table">
              <thead><tr><th>Datum</th><th>Fahrzeug</th><th>Fahrer</th><th className="money">Liter</th><th className="money">Betrag</th><th className="money">km / Bh</th><th className="money">Verbrauch</th><th /></tr></thead>
              <tbody>{tanken.map((t) => (
                <tr key={t.id} style={{ cursor: 'default' }}>
                  <td className="tabular">{formatDate(t.datum)}</td><td>{name(t.fahrzeug_id)?.bezeichnung ?? name(t.fahrzeug_id)?.kennzeichen}<div className="sub">{t.quelle_name ? `aus ${t.quelle_name}` : (t.tankstelle ?? '')}</div></td><td>{t.fahrer_name}</td>
                  <td className="money">{t.liter_f.toLocaleString('de-DE', { minimumFractionDigits: 2 })} l</td><td className="money">{t.betrag_f != null ? formatEuro(t.betrag_f) : '–'}</td>
                  <td className="money sub">{t.km_stand != null ? `${t.km_stand.toLocaleString('de-DE')} km` : t.bh != null ? `${t.bh.toLocaleString('de-DE')} Bh` : '–'}</td>
                  <td className="money">{t.verbrauch != null ? `${t.verbrauch.toLocaleString('de-DE')} l/100 km` : t.verbrauch_h != null ? `${t.verbrauch_h.toLocaleString('de-DE')} l/h` : '–'}</td>
                  <td><button className="btn small plain" onClick={() => setKorrTanken(t)}>Korrigieren</button>{' '}{t.has_beleg ? <button className="btn small" onClick={() => run(() => openPdf(`/tankvorgaenge/${t.id}/beleg`), 'Beleg geöffnet')}>Beleg</button> : (
                    <label className="btn small plain" style={{ cursor: 'pointer' }}>Beleg<input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void runAndReload(() => uploadBeleg(`/tankvorgaenge/${t.id}/beleg`, f), 'Beleg gespeichert'); }} /></label>)}</td>
                </tr>))}</tbody>
            </table>
            {tanken.length === 0 && <div className="empty">Keine Tankvorgänge</div>}
          </div>
        </div>
        <div className="footnote">Einfaches Fahrtenbuch (kein Finanzamt-Fahrtenbuch). Fahrer sehen ihre eigenen Einträge, Bau- und Projektleitung alle (ANNAHME D2). Lücken im km-Stand werden gemeldet, aber nicht gesperrt.</div>
      </div>
      {korrFahrt && <KorrekturSheet title="Fahrt korrigieren" url={`/fahrten/${korrFahrt.id}`} run={runAndReload} onClose={() => setKorrFahrt(null)}
        fields={[{ key: 'datum', label: 'Datum', type: 'date' }, { key: 'km_start', label: 'km Start', type: 'number' }, { key: 'km_ende', label: 'km Ende', type: 'number' }, { key: 'zweck', label: 'Zweck' }]}
        initial={{ datum: korrFahrt.datum, km_start: korrFahrt.km_start, km_ende: korrFahrt.km_ende, zweck: korrFahrt.zweck }} />}
      {korrTanken && <KorrekturSheet title="Tankvorgang korrigieren" url={`/tankvorgaenge/${korrTanken.id}`} run={runAndReload} onClose={() => setKorrTanken(null)}
        fields={[{ key: 'datum', label: 'Datum', type: 'date' }, { key: 'liter', label: 'Liter', type: 'number' }, { key: 'betrag_brutto', label: 'Betrag (€)', type: 'number' },
          ...(korrTanken.km_stand != null ? [{ key: 'km_stand', label: 'km-Stand', type: 'number' as const }] : []), ...(korrTanken.bh != null ? [{ key: 'betriebsstunden', label: 'Betriebsstunden', type: 'number' as const }] : [])]}
        initial={{ datum: korrTanken.datum, liter: korrTanken.liter_f, betrag_brutto: korrTanken.betrag_f, km_stand: korrTanken.km_stand, betriebsstunden: korrTanken.bh }} />}
      {sheet === 'fahrt' && <FahrtSheet info={info} fz={d.fahrzeuge} preset={fz} run={runAndReload} onClose={() => setSheet(null)} />}
      {sheet === 'tanken' && <TankenSheet info={info} fz={d.fahrzeuge} preset={fz} run={runAndReload} onClose={() => setSheet(null)} />}
      {sheet === 'fahrzeug' && <FahrzeugSheet run={runAndReload} onClose={() => setSheet(null)} />}
    </>
  );
}

function FahrtSheet({ info, fz: alle, preset, run, onClose }: { info: ProjectInfo; fz: Fahrzeug[]; preset: string; run: Run; onClose: () => void }) {
  const fz = alle.filter((x) => x.art === 'fahrzeug');
  const start = (id: string) => String(fz.find((f) => f.id === id)?.last_km ?? '');
  const first = preset !== 'alle' && fz.some((x) => x.id === preset) ? preset : fz[0]?.id ?? '';
  const [f, setF] = useState({ fahrzeug_id: first, datum: today(), km_start: start(first), km_ende: '', project_id: info.project.id, zweck: '' });
  const last = fz.find((x) => x.id === f.fahrzeug_id)?.last_km ?? null;
  const warn = f.km_start ? kmWarnung(last, Number(f.km_start)) : null;
  const valid = f.fahrzeug_id && f.zweck.trim() && f.km_start !== '' && f.km_ende !== '' && Number(f.km_ende) >= Number(f.km_start);
  return (
    <Sheet title="Fahrt eintragen" primary="Sichern" primaryDisabled={!valid} onCancel={onClose}
      onPrimary={() => run(async () => { await api('/fahrten', { method: 'POST', body: { ...f, id: crypto.randomUUID(), km_start: Number(f.km_start), km_ende: Number(f.km_ende), project_id: f.project_id || null } }); onClose(); }, `Fahrt gesichert: ${Number(f.km_ende) - Number(f.km_start)} km`)}>
      <div className="group">
        <div className="row"><span className="k">Fahrzeug</span><select value={f.fahrzeug_id} onChange={(e) => setF({ ...f, fahrzeug_id: e.target.value, km_start: start(e.target.value) })}>{fz.map((x) => <option key={x.id} value={x.id}>{x.kennzeichen} · {x.bezeichnung}</option>)}</select></div>
        <div className="row"><span className="k">Datum</span><input type="date" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} /></div>
        <div className="row"><span className="k">km-Stand Start</span><input inputMode="numeric" value={f.km_start} onChange={(e) => setF({ ...f, km_start: e.target.value })} /></div>
        <div className="row"><span className="k">km-Stand Ende</span><input inputMode="numeric" autoFocus value={f.km_ende} onChange={(e) => setF({ ...f, km_ende: e.target.value })} /></div>
        {f.km_ende !== '' && <div className="row"><span className="k">Strecke</span><span className="v">{(Number(f.km_ende) - Number(f.km_start)).toLocaleString('de-DE')} km</span></div>}
        <div className="row"><span className="k">Zweck</span><input placeholder="z. B. Baustelle, Material holen" value={f.zweck} onChange={(e) => setF({ ...f, zweck: e.target.value })} /></div>
        <div className="row"><span className="k">Projekt</span><select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">ohne Projekt</option><option value={info.project.id}>{info.project.name}</option></select></div>
      </div>
      {warn && <div className="warn-box"><strong>Hinweis:</strong> {warn}</div>}
    </Sheet>
  );
}

function TankenSheet({ info, fz, preset, run, onClose }: { info: ProjectInfo; fz: Fahrzeug[]; preset: string; run: Run; onClose: () => void }) {
  const first = preset !== 'alle' ? preset : fz[0]?.id ?? '';
  const stationen = fz.filter((x) => x.art === 'tankstelle');
  const [f, setF] = useState({ fahrzeug_id: first, datum: today(), liter: '', betrag: '', km_stand: String(fz.find((x) => x.id === first)?.last_km ?? ''), bh: '', tankstelle: '', quelle_id: '', project_id: info.project.id });
  const [beleg, setBeleg] = useState<File | null>(null);
  const art = fz.find((x) => x.id === f.fahrzeug_id)?.art ?? 'fahrzeug';
  const ausStation = !!f.quelle_id;
  const valid = f.fahrzeug_id && parseNum(f.liter) > 0 && (art !== 'fahrzeug' || f.km_stand !== '') && (art !== 'maschine' || f.bh !== '') && (ausStation || art === 'maschine' || f.betrag !== '');
  return (
    <Sheet title={art === 'tankstelle' ? 'Tankstelle befüllen' : 'Tanken eintragen'} primary="Sichern" primaryDisabled={!valid} onCancel={onClose}
      onPrimary={() => run(async () => {
        const id = crypto.randomUUID();
        const r = await api<{ warnung: string | null }>('/tankvorgaenge', { method: 'POST', body: { id, fahrzeug_id: f.fahrzeug_id, datum: f.datum, liter: parseNum(f.liter),
          betrag_brutto: f.betrag !== '' ? parseNum(f.betrag) : null, km_stand: art === 'fahrzeug' ? Number(f.km_stand) : null, betriebsstunden: art === 'maschine' ? parseNum(f.bh) : null,
          tankstelle: f.tankstelle || null, quelle_id: art !== 'tankstelle' ? f.quelle_id || null : null, project_id: f.project_id || null } });
        if (beleg) await uploadBeleg(`/tankvorgaenge/${id}/beleg`, beleg);
        onClose();
        if (r.warnung) throw new Error(`Gesichert. Hinweis: ${r.warnung}`);
      }, 'Tankvorgang gesichert')}>
      <div className="group">
        <div className="row"><span className="k">Fahrzeug / Gerät</span><select value={f.fahrzeug_id} onChange={(e) => setF({ ...f, fahrzeug_id: e.target.value })}>{fz.map((x) => <option key={x.id} value={x.id}>{x.bezeichnung} ({FAHRZEUG_ARTEN[x.art]})</option>)}</select></div>
        {art !== 'tankstelle' && stationen.length > 0 && (
          <div className="row"><span className="k">Getankt an</span><select value={f.quelle_id} onChange={(e) => setF({ ...f, quelle_id: e.target.value })}>
            <option value="">Öffentliche Tankstelle</option>{stationen.map((x) => <option key={x.id} value={x.id}>{x.bezeichnung} (Bestand {Math.round(x.bestand ?? 0)} l)</option>)}</select></div>
        )}
        <div className="row"><span className="k">Datum</span><input type="date" value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} /></div>
        <div className="row"><span className="k">Liter</span><input inputMode="decimal" autoFocus placeholder="0,00" value={f.liter} onChange={(e) => setF({ ...f, liter: e.target.value })} /></div>
        {art === 'maschine' && <div className="row"><span className="k">Betriebsstunden</span><input inputMode="decimal" placeholder={String(fz.find((x) => x.id === f.fahrzeug_id)?.last_bh ?? '')} value={f.bh} onChange={(e) => setF({ ...f, bh: e.target.value })} /></div>}
        {art === 'fahrzeug' && <div className="row"><span className="k">km-Stand</span><input inputMode="numeric" value={f.km_stand} onChange={(e) => setF({ ...f, km_stand: e.target.value })} /></div>}
        {!ausStation && <div className="row"><span className="k">Betrag brutto (€)</span><input inputMode="decimal" placeholder={art === 'maschine' ? 'optional' : '0,00'} value={f.betrag} onChange={(e) => setF({ ...f, betrag: e.target.value })} /></div>}
        {!ausStation && <div className="row"><span className="k">{art === 'tankstelle' ? 'Lieferant' : 'Tankstelle'}</span><input value={f.tankstelle} onChange={(e) => setF({ ...f, tankstelle: e.target.value })} /></div>}
        <div className="row"><span className="k">Projekt</span><select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">ohne Projekt</option><option value={info.project.id}>{info.project.name}</option></select></div>
      </div>
      {!ausStation && <label className="drop"><input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => setBeleg(e.target.files?.[0] ?? null)} />{beleg ? <strong>{beleg.name}</strong> : <>Beleg <span style={{ color: 'var(--accent)' }}>anhängen</span></>}</label>}
    </Sheet>
  );
}

function FahrzeugSheet({ run, onClose }: { run: Run; onClose: () => void }) {
  const [f, setF] = useState({ kennzeichen: '', bezeichnung: '', kraftstoff: 'diesel', art: 'fahrzeug' as FahrzeugArt, kapazitaet_l: '' });
  return (
    <Sheet title="Fahrzeug / Gerät anlegen" primary="Sichern" primaryDisabled={!f.kennzeichen.trim() || !f.bezeichnung.trim()} onCancel={onClose}
      onPrimary={() => run(async () => { await api('/fahrzeuge', { method: 'POST', body: { ...f, kapazitaet_l: f.kapazitaet_l ? Number(f.kapazitaet_l) : null } }); onClose(); }, 'Angelegt')}>
      <div className="group">
        <div className="row"><span className="k">Art</span><select value={f.art} onChange={(e) => setF({ ...f, art: e.target.value as FahrzeugArt })}>{Object.entries(FAHRZEUG_ARTEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        {f.art === 'tankstelle' && <div className="row"><span className="k">Fassungsvermögen (l)</span><input inputMode="numeric" value={f.kapazitaet_l} onChange={(e) => setF({ ...f, kapazitaet_l: e.target.value })} /></div>}
        <div className="row"><span className="k">{f.art === 'fahrzeug' ? 'Kennzeichen' : 'Inventar-Nr.'}</span><input autoFocus placeholder={f.art === 'fahrzeug' ? 'S-MB 123' : 'RL-07'} value={f.kennzeichen} onChange={(e) => setF({ ...f, kennzeichen: e.target.value })} /></div>
        <div className="row"><span className="k">Bezeichnung</span><input placeholder="z. B. VW Crafter" value={f.bezeichnung} onChange={(e) => setF({ ...f, bezeichnung: e.target.value })} /></div>
        <div className="row"><span className="k">Kraftstoff</span><select value={f.kraftstoff} onChange={(e) => setF({ ...f, kraftstoff: e.target.value })}><option value="diesel">Diesel</option><option value="benzin">Benzin</option><option value="elektro">Elektro</option><option value="hybrid">Hybrid</option></select></div>
      </div>
    </Sheet>
  );
}

function Reason({ title, onCancel, onOk }: { title: string; onCancel: () => void; onOk: (r: string) => void }) {
  const [r, setR] = useState('');
  return (
    <Sheet title={title} primary="Ablehnen" destructive primaryDisabled={!r.trim()} onCancel={onCancel} onPrimary={() => onOk(r)}>
      <div className="group"><div className="row stack"><textarea autoFocus placeholder="Grund (Pflicht)" value={r} onChange={(e) => setR(e.target.value)} /></div></div>
    </Sheet>
  );
}

/** Generic correction dialog (decided 12.11.2026: almost everything editable afterwards; audited on the server). */
function KorrekturSheet({ title, url, fields, initial, run, onClose }: {
  title: string; url: string; run: Run; onClose: () => void;
  fields: { key: string; label: string; type?: 'text' | 'date' | 'number' }[]; initial: Record<string, string | number | null>;
}) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((x) => [x.key, initial[x.key] == null ? '' : String(initial[x.key]).replace(/^(\d{4}-\d{2}-\d{2}).*$/, '$1')])));
  return (
    <Sheet title={title} primary="Sichern" onCancel={onClose}
      onPrimary={() => run(async () => {
        const body = Object.fromEntries(fields.filter((x) => f[x.key] !== String(initial[x.key] ?? '').replace(/^(\d{4}-\d{2}-\d{2}).*$/, '$1'))
          .map((x) => [x.key, x.type === 'number' ? (f[x.key] === '' ? null : parseNum(f[x.key]!)) : f[x.key] || null]));
        if (Object.keys(body).length) await api(url, { method: 'PATCH', body });
        onClose();
      }, 'Korrigiert')}>
      <div className="group">
        {fields.map((x) => (
          <div key={x.key} className="row"><span className="k">{x.label}</span>
            <input type={x.type === 'date' ? 'date' : 'text'} inputMode={x.type === 'number' ? 'decimal' : undefined} value={f[x.key]} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} /></div>
        ))}
      </div>
      <div className="footnote">Die Korrektur wird mit altem und neuem Wert im Protokoll festgehalten.</div>
    </Sheet>
  );
}
