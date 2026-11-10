/**
 * Dokumente (docs/fachkonzept/03): folder tree; every folder shows only current versions, replaced ones under "Alt".
 * Old version clicked → warning with "open current version". Every PDF is served with the QR code (current / outdated).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, PLAN_REVISION_LABELS } from '@bap/domain';
import { api, ApiError, getToken, openPdf, type DocItem, type DocVersion, type Folder, type ProjectInfo } from './api';
import { Icon } from './ui/Icon';
import { PageHeader, Sheet, type Run } from './ui/layout';

const fileUrl = (item: { type: 'plan' | 'document' }, revId: string) => (item.type === 'plan' ? `/plan-revisions/${revId}/pdf` : `/document-revisions/${revId}/file`);
const decisionUrl = (item: { type: 'plan' | 'document' }, revId: string) => (item.type === 'plan' ? `/plan-revisions/${revId}/decision` : `/document-revisions/${revId}/decision`);

/** Warning when an outdated version is opened (docs/fachkonzept/03). */
export function OldVersionSheet({ name, old, current, onOpenCurrent, onOpenOld, onCancel }: {
  name: string; old: { label: string }; current: { label: string; decided_at: string | null } | null;
  onOpenCurrent: () => void; onOpenOld: () => void; onCancel: () => void;
}) {
  return (
    <Sheet title="Veralteter Stand" primary={current ? 'Aktuellen Stand öffnen' : 'Schließen'} onCancel={onCancel} onPrimary={current ? onOpenCurrent : onCancel}>
      <div className="warn-box">
        <strong>Achtung: {name} · {old.label} ist nicht mehr gültig.</strong>
        <p style={{ margin: '8px 0 0' }}>
          {current ? <>Aktuell gültig ist <strong style={{ color: 'var(--label)' }}>{current.label}</strong>{current.decided_at ? `, freigegeben am ${formatDate(current.decided_at)}` : ''}. Bitte nur mit dem aktuellen Stand arbeiten.</> : 'Es gibt derzeit keinen freigegebenen Stand.'}
        </p>
      </div>
      <button className="btn" onClick={onOpenOld}>
        Alten Stand trotzdem ansehen (mit Wasserzeichen „ERSETZT“)
      </button>
    </Sheet>
  );
}

export function DokumentePage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<DocItem[]>([]);
  const [sel, setSel] = useState<string | 'inbox' | null>(null);
  const [showAlt, setShowAlt] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [warn, setWarn] = useState<{ item: DocItem; rev: DocVersion } | null>(null);
  const [reject, setReject] = useState<{ item: DocItem; rev: DocVersion } | null>(null);
  const internal = info.role === 'bauleitung' || info.role === 'polier';
  const leitung = info.role === 'bauleitung';

  const reload = useCallback(async () => {
    const r = await api<{ folders: Folder[]; items: DocItem[] }>(`/projects/${info.project.id}/dokumente`);
    setFolders(r.folders);
    setItems(r.items);
    setSel((s) => s ?? r.folders.find((f) => !f.parent_id)?.id ?? null);
  }, [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const runAndReload: Run = async (fn, ok) => {
    await run(fn, ok);
    await reload();
  };

  // Flattened tree with depth for indentation.
  const tree = useMemo(() => {
    const out: (Folder & { depth: number })[] = [];
    const walk = (parent: string | null, depth: number) =>
      folders.filter((f) => f.parent_id === parent).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).forEach((f) => {
        out.push({ ...f, depth });
        walk(f.id, depth + 1);
      });
    walk(null, 0);
    return out;
  }, [folders]);
  const current = (i: DocItem) => i.revisions.find((r) => r.id === i.current_revision_id) ?? null;
  const inbox = items.flatMap((i) => i.revisions.filter((r) => r.status === 'zur_pruefung').map((r) => ({ item: i, rev: r })));
  const folder = folders.find((f) => f.id === sel);
  const inFolder = items.filter((i) => i.folder_id === sel);
  const altList = inFolder.flatMap((i) => i.revisions.filter((r) => r.status === 'ersetzt').map((r) => ({ item: i, rev: r })));
  /** Simplified upload: just the files. Name from the file name, same name = new version, PDFs in plan folders = plans. */
  const uploadFiles = async (files: File[], target?: DocItem) => {
    if (!files.length || !folder) return;
    setBusy(true);
    const done: string[] = [];
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.set('project_id', info.project.id);
        let url = '/api/dokumente/upload';
        if (target) {
          url = target.type === 'plan' ? '/api/plan-revisions' : '/api/document-revisions';
          fd.set(target.type === 'plan' ? 'plan_id' : 'document_id', target.id);
        } else fd.set('folder_id', folder.id);
        fd.set('file', file); // last: the server reads the fields before the file
        const res = await fetch(url, { method: 'POST', body: fd, headers: { authorization: `Bearer ${getToken()}` } });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(res.status, body);
        done.push(target ? `${target.name} (neue Version)` : `${body.name} · ${body.label}${body.type === 'plan' ? ' (Plan)' : ''}${body.isNew ? '' : ' – neue Version'}`);
      }
      await runAndReload(async () => undefined, `Hochgeladen, liegt zur Prüfung: ${done.join(', ')}`);
    } catch (e) {
      await runAndReload(async () => { throw e; }, '');
    } finally {
      setBusy(false);
    }
  };
  const pick = (target?: DocItem) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !target;
    input.onchange = () => void uploadFiles([...(input.files ?? [])], target);
    input.click();
  };
  const open = (item: DocItem, rev: DocVersion) => run(() => openPdf(fileUrl(item, rev.id)), `${item.name} · ${rev.label} geöffnet`);

  return (
    <>
      <PageHeader
        eyebrow={info.project.name}
        title="Dokumente"
        action={
          internal && (
            <div className="meta-row">
              {leitung && (
                <button className="btn" onClick={() => setNewFolder(true)}>
                  Neuer Ordner
                </button>
              )}
              <button className="btn filled" onClick={() => pick()} disabled={!folder || busy}>
                <Icon name="plus" size={16} /> {busy ? 'Lädt hoch …' : 'Hochladen'}
              </button>
            </div>
          )
        }
      />
      <div className="docs-split">
        <div className="card tree">
          {internal && (
            <button className={sel === 'inbox' ? 'on' : ''} onClick={() => setSel('inbox')}>
              <Icon name="hinweis" size={16} /> Zur Prüfung <span className="count">{inbox.length || ''}</span>
            </button>
          )}
          {tree.map((f) => (
            <button key={f.id} className={sel === f.id ? 'on' : ''} style={{ paddingLeft: 10 + f.depth * 18 }} onClick={() => (setSel(f.id), setShowAlt(false))}>
              <Icon name="ordner" size={16} /> {f.name}
              <span className="count">{items.filter((i) => i.folder_id === f.id && current(i)).length || ''}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {sel === 'inbox' ? (
            <div className="card">
              <table className="table">
                <tbody>
                  {inbox.map(({ item, rev }) => (
                    <tr key={rev.id} style={{ cursor: 'default' }}>
                      <td>
                        <div className="desc">{item.name} · {rev.label}</div>
                        <div className="sub">
                          {folders.find((f) => f.id === item.folder_id)?.name} · hochgeladen {formatDate(rev.uploaded_at)} von {rev.uploaded_by_name}
                          {rev.comment ? ` · „${rev.comment}“` : ''}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', width: 330 }}>
                        <div className="meta-row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn small" onClick={() => open(item, rev)}>Ansehen</button>
                          {leitung && (
                            <>
                              <button className="btn small destructive" onClick={() => setReject({ item, rev })}>Ablehnen …</button>
                              <button
                                className="btn small filled"
                                onClick={() => runAndReload(() => api(decisionUrl(item, rev.id), { method: 'POST', body: { decision: 'freigeben', base_version: rev.version } }), `${item.name} ${rev.label} freigegeben – alter Stand liegt unter „Alt“`)}
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
              {inbox.length === 0 && <div className="empty">Nichts zu prüfen</div>}
              {!leitung && inbox.length > 0 && <div className="footnote" style={{ padding: 12 }}>Freigeben dürfen Bau- und Projektleitung.</div>}
            </div>
          ) : folder ? (
            <>
              <div
                className={`card ${dragOver ? 'drop over' : ''}`}
                style={dragOver ? { padding: 0 } : undefined}
                onDragOver={(e) => internal && (e.preventDefault(), setDragOver(true))}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (internal) void uploadFiles([...e.dataTransfer.files]);
                }}
              >
                <table className="table">
                  <thead>
                    <tr>
                      <th>{folder.name}</th>
                      <th>Stand</th>
                      <th>Freigegeben</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {inFolder.filter((i) => current(i)).map((i) => {
                      const c = current(i)!;
                      const pending = i.revisions.find((r) => r.status === 'zur_pruefung');
                      return (
                        <tr key={i.id} style={{ cursor: 'default' }}>
                          <td>
                            <div className="desc">
                              {i.name} {i.type === 'plan' && <span className="tag">Plan</span>}
                            </div>
                            {pending && internal && <div className="sub" style={{ color: 'var(--orange)' }}>Neuer Stand {pending.label} in Prüfung</div>}
                          </td>
                          <td><span className="pill c-green">{c.label}</span></td>
                          <td className="sub">{c.decided_at ? `${formatDate(c.decided_at)} · ${c.decided_by_name}` : '–'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="meta-row" style={{ justifyContent: 'flex-end' }}>
                              <button className="btn small" onClick={() => open(i, c)} title="PDFs mit QR-Code: zeigt beim Scannen, ob der Stand aktuell ist">
                                Öffnen (mit QR)
                              </button>
                              {internal && (
                                <button className="btn small plain" onClick={() => pick(i)}>
                                  Neue Version
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {inFolder.filter((i) => current(i)).length === 0 && <div className="empty">Keine gültigen Dokumente in diesem Ordner</div>}
                {internal && (
                  <div className="add-row" style={{ padding: '12px', color: 'var(--label-2)', textAlign: 'center' }} onClick={() => pick()}>
                    {folder.kind === 'plaene' ? 'PDF-Pläne' : 'Dateien'} hierher ziehen oder klicken – Name aus dem Dateinamen, gleicher Name = neue Version
                    {folder.kind === 'plaene' && ' (z. B. „Grundriss OG 1 Index B.pdf“)'}
                  </div>
                )}
              </div>
              {internal && (
                <div>
                  <button className="tree" style={{ border: 0, background: 'transparent', padding: 0 }} onClick={() => setShowAlt(!showAlt)}>
                    <span className="group-title" style={{ cursor: 'pointer' }}>
                      {showAlt ? '▾' : '▸'} {folder.name} / Alt ({altList.length})
                    </span>
                  </button>
                  {showAlt && (
                    <div className="card">
                      <table className="table">
                        <tbody>
                          {altList.map(({ item, rev }) => (
                            <tr key={rev.id} onClick={() => setWarn({ item, rev })}>
                              <td>
                                <div className="desc" style={{ color: 'var(--label-2)' }}>{item.name} · {rev.label}</div>
                                <div className="sub">ersetzt durch {current(item)?.label ?? '–'}</div>
                              </td>
                              <td><span className="pill c-gray">{PLAN_REVISION_LABELS[rev.status]}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {altList.length === 0 && <div className="empty">Keine alten Stände</div>}
                    </div>
                  )}
                </div>
              )}
              <div className="footnote">
                Im Ordner liegt nur der aktuelle, freigegebene Stand. Ersetzte Stände wandern automatisch nach „Alt“. Jedes abgerufene PDF trägt einen QR-Code, der beim Scannen sagt, ob es noch aktuell ist.
              </div>
            </>
          ) : (
            <div className="placeholder">Ordner wählen</div>
          )}
        </div>
      </div>

      {warn && (
        <OldVersionSheet
          name={warn.item.name}
          old={warn.rev}
          current={current(warn.item)}
          onCancel={() => setWarn(null)}
          onOpenCurrent={() => {
            const c = current(warn.item);
            setWarn(null);
            if (c) void open(warn.item, c);
          }}
          onOpenOld={() => {
            const w = warn;
            setWarn(null);
            void open(w.item, w.rev);
          }}
        />
      )}
      {newFolder && <NewFolderSheet info={info} folders={tree} parent={folder?.id ?? null} run={runAndReload} onClose={() => setNewFolder(false)} />}
      {reject && (
        <RejectSheet
          label={`${reject.item.name} · ${reject.rev.label}`}
          onCancel={() => setReject(null)}
          onReject={(comment) =>
            runAndReload(async () => {
              await api(decisionUrl(reject.item, reject.rev.id), { method: 'POST', body: { decision: 'ablehnen', comment, base_version: reject.rev.version } });
              setReject(null);
            }, 'Abgelehnt')
          }
        />
      )}
    </>
  );
}

function NewFolderSheet({ info, folders, parent, run, onClose }: { info: ProjectInfo; folders: (Folder & { depth: number })[]; parent: string | null; run: Run; onClose: () => void }) {
  const [f, setF] = useState({ name: '', parent_id: parent ?? '', visible_to_nu: false, visible_to_bauherr: false, kind: '' as '' | 'plaene' | 'dokumente', location_id: '' });
  const parentKind = folders.find((x) => x.id === f.parent_id)?.kind;
  const kind = f.kind || parentKind || 'dokumente';
  return (
    <Sheet
      title="Neuer Ordner"
      primary="Anlegen"
      primaryDisabled={!f.name.trim()}
      onCancel={onClose}
      onPrimary={() => run(async () => { await api('/folders', { method: 'POST', body: { name: f.name, visible_to_nu: f.visible_to_nu, visible_to_bauherr: f.visible_to_bauherr, kind, location_id: kind === 'plaene' && f.location_id ? f.location_id : null, parent_id: f.parent_id || null, project_id: info.project.id } }); onClose(); }, `Ordner „${f.name}“ angelegt`)}
    >
      <div className="group">
        <div className="row"><span className="k">Name</span><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="row">
          <span className="k">In Ordner</span>
          <select value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })}>
            <option value="">(oberste Ebene)</option>
            {folders.map((x) => <option key={x.id} value={x.id}>{'  '.repeat(x.depth)}{x.name}</option>)}
          </select>
        </div>
        <div className="row">
          <span className="k">Inhalt</span>
          <div className="segmented">
            <button className={kind === 'plaene' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'plaene' })}>Pläne</button>
            <button className={kind === 'dokumente' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'dokumente' })}>Dokumente</button>
          </div>
        </div>
        {kind === 'plaene' && (
          <div className="row">
            <span className="k">Ort der Pläne</span>
            <select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
              <option value="">aus dem Dateinamen</option>
              {info.locations.filter((l) => l.kind !== 'raum').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        <label className="row" style={{ cursor: 'pointer' }}><span className="k">Für Nachunternehmer sichtbar</span><input type="checkbox" checked={f.visible_to_nu} onChange={(e) => setF({ ...f, visible_to_nu: e.target.checked })} style={{ maxWidth: 'none' }} /></label>
        <label className="row" style={{ cursor: 'pointer' }}><span className="k">Für Bauherr sichtbar</span><input type="checkbox" checked={f.visible_to_bauherr} onChange={(e) => setF({ ...f, visible_to_bauherr: e.target.checked })} style={{ maxWidth: 'none' }} /></label>
      </div>
      <div className="footnote">Externe sehen nur freigegebene, aktuelle Stände – nie „Zur Prüfung“ oder „Alt“.</div>
    </Sheet>
  );
}

function RejectSheet({ label, onCancel, onReject }: { label: string; onCancel: () => void; onReject: (c: string) => void }) {
  const [c, setC] = useState('');
  return (
    <Sheet title={`${label} ablehnen`} primary="Ablehnen" destructive primaryDisabled={!c.trim()} onCancel={onCancel} onPrimary={() => onReject(c)}>
      <div className="group"><div className="row stack"><textarea autoFocus placeholder="Grund (Pflicht)" value={c} onChange={(e) => setC(e.target.value)} /></div></div>
    </Sheet>
  );
}
