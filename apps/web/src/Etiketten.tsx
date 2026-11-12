/**
 * Raum-QR-Etiketten (decided 12.11.2026): format adjustable (grid, margins, QR size, lines), live preview, print.
 * The QR leads to the room: scanned in the app it sets the room for a new Mangel or a documentation.
 */
import { useEffect, useMemo, useState } from 'react';
import { ETIKETT_ZEILEN, etikettenRaster, STANDARD_ETIKETTEN, type EtikettenFormat, type EtikettZeile } from '@bap/domain';
import { api, getToken, openPdf, type ProjectInfo } from './api';
import { PageHeader, type Run } from './ui/layout';

export function EtikettenPage({ info, run, onReload }: { info: ProjectInfo; run: Run; onReload: () => void }) {
  const [f, setF] = useState<EtikettenFormat | null>(null);
  const [unter, setUnter] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const leitung = info.role === 'bauleitung';
  useEffect(() => void api<EtikettenFormat>(`/projects/${info.project.id}/etiketten-format`).then(setF), [info.project.id]);
  const raster = useMemo(() => (f ? etikettenRaster(f) : null), [f]);
  const query = f ? `format=${encodeURIComponent(JSON.stringify(f))}${unter ? `&unter=${unter}` : ''}` : '';
  // Live preview (debounced): the same PDF the printer gets.
  useEffect(() => {
    if (!f) return;
    const t = setTimeout(() => {
      void fetch(`/api/projects/${info.project.id}/raum-etiketten.pdf?${query}`, { headers: { authorization: `Bearer ${getToken()}` } }).then(async (r) => {
        if (!r.ok) return setErr(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Vorschau nicht möglich');
        setErr(null);
        const url = URL.createObjectURL(await r.blob());
        setPreview((old) => { if (old) URL.revokeObjectURL(old); return url; });
      });
    }, 400);
    return () => clearTimeout(t);
  }, [query, f, info.project.id]);
  if (!f || !raster) return <p className="loading">Wird geladen …</p>;
  const set = (p: Partial<EtikettenFormat>) => setF({ ...f, ...p });
  const nfield = (k: keyof EtikettenFormat, label: string, unit: string, step = 1) => (
    <div className="row"><span className="k">{label}</span><span className="tb-pair"><input type="number" step={step} value={f[k] as number} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<EtikettenFormat>)} /> {unit}</span></div>
  );
  const rooms = info.locations.filter((l) => l.kind === 'raum');
  const parents = info.locations.filter((l) => l.kind !== 'raum');
  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Raum-QR-Etiketten"
        action={<div className="meta-row">
          {leitung && <button className="btn" onClick={() => void run(async () => { setF(await api(`/projects/${info.project.id}/etiketten-format`, { method: 'PUT', body: f })); }, 'Format für das Projekt gespeichert')}>Format speichern</button>}
          <button className="btn filled" onClick={() => void run(() => openPdf(`/projects/${info.project.id}/raum-etiketten.pdf?${query}`), 'PDF geöffnet')}>Drucken (PDF)</button>
        </div>}>
        <select className="popup" value={unter} onChange={(e) => setUnter(e.target.value)}>
          <option value="">Alle Räume ({rooms.length})</option>
          {parents.map((p) => <option key={p.id} value={p.id}>nur {p.name}</option>)}
        </select>
        <span className="sub" style={{ fontSize: 13 }}>{raster.proSeite} Etiketten je A4-Seite · {Math.round(raster.breite)} × {Math.round(raster.hoehe)} mm</span>
      </PageHeader>
      <div className="split etiketten">
        <div className="card etikett-preview">{preview ? <iframe title="Vorschau" src={`${preview}#toolbar=0&view=FitH`} /> : <p className="loading">Vorschau …</p>}{err && <div className="warn-box">{err}</div>}</div>
        <aside>
          <div className="group-title">Raster (A4)</div>
          <div className="group">
            {nfield('spalten', 'Spalten', '')}{nfield('zeilen', 'Zeilen', '')}
            {nfield('rand_oben_mm', 'Rand oben/unten', 'mm')}{nfield('rand_links_mm', 'Rand links/rechts', 'mm')}
            {nfield('abstand_x_mm', 'Abstand waagrecht', 'mm')}{nfield('abstand_y_mm', 'Abstand senkrecht', 'mm')}
            {nfield('qr_mm', 'QR-Code', 'mm')}{nfield('schrift_pt', 'Schrift', 'pt')}
            <label className="row"><span className="k">Rahmen</span><input type="checkbox" className="switch" checked={f.rahmen} onChange={(e) => set({ rahmen: e.target.checked })} /></label>
          </div>
          <div className="group-title" style={{ marginTop: 16 }}>Text neben dem QR-Code</div>
          <div className="group">
            {(Object.keys(ETIKETT_ZEILEN) as EtikettZeile[]).map((k) => (
              <label key={k} className="row"><span className="k">{ETIKETT_ZEILEN[k]}</span>
                <input type="checkbox" className="switch" checked={f.inhalt.includes(k)} onChange={(e) => set({ inhalt: e.target.checked ? [...f.inhalt, k] : f.inhalt.filter((x) => x !== k) })} /></label>
            ))}
          </div>
          <button className="btn plain" onClick={() => setF(STANDARD_ETIKETTEN)}>Standard (16 pro Seite)</button>
          {leitung && (
            <>
              <div className="group-title" style={{ marginTop: 16 }}>Raumnummern</div>
              <div className="group" style={{ maxHeight: 320, overflow: 'auto' }}>
                {rooms.map((r) => (
                  <div key={r.id} className="row"><span className="k">{r.name}</span>
                    <input placeholder="z. B. 04.035" defaultValue={r.nummer ?? ''}
                      onBlur={(e) => { if (e.target.value !== (r.nummer ?? '')) void run(async () => { await api(`/locations/${r.id}`, { method: 'PATCH', body: { nummer: e.target.value } }); onReload(); }, 'Raumnummer gespeichert'); }} /></div>
                ))}
              </div>
            </>
          )}
          <div className="footnote">Auf Etikettenbögen drucken (z. B. 2 × 8 = 16 je Seite) und an die Türen kleben. In der App beim Mangel oder bei der Dokumentation „Raum per QR-Code“ antippen und scannen.</div>
        </aside>
      </div>
    </>
  );
}
