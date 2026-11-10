/**
 * Dokumente (docs/fachkonzept/03): folders with plans and documents. Each folder shows only the current
 * released version; replaced versions appear under "Alt". New versions start in "Zur Prüfung".
 * Visibility: RLS (folder flags for NU/Bauherr; external roles only see released versions).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { nextPlanIndex, PLAN_REVISION_LABELS } from '@bap/domain';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';
import { stampPdf, uploadRevision, type StampInfo } from './plan-service';

export const DOC_DIR = fileURLToPath(new URL('../../../storage/dokumente/', import.meta.url));

async function audit(tx: TxSql, userId: string, projectId: string, entityId: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'dokument', ${entityId}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

/** Folder tree with plans and documents (each with all versions the user may see). */
export async function dokumenteTree(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  const folders = await tx`SELECT id, parent_id, name, sort, visible_to_nu, visible_to_bauherr, kind, location_id FROM folder WHERE project_id = ${projectId} ORDER BY sort, name`;
  const plans = await tx`
    SELECT p.id, p.folder_id, p.name, p.current_revision_id,
      coalesce((SELECT json_agg(json_build_object('id', r.id, 'label', 'Index ' || r.plan_index, 'status', r.status, 'comment', r.comment,
        'uploaded_at', r.uploaded_at, 'decided_at', r.decided_at, 'uploaded_by_name', u.name, 'decided_by_name', d.name, 'version', r.version) ORDER BY r.uploaded_at DESC)
        FROM plan_revision r JOIN app_user u ON u.id = r.uploaded_by LEFT JOIN app_user d ON d.id = r.decided_by WHERE r.plan_id = p.id), '[]') AS revisions
    FROM plan p WHERE p.project_id = ${projectId} AND p.folder_id IS NOT NULL`;
  const docs = await tx`
    SELECT doc.id, doc.folder_id, doc.name, doc.current_revision_id,
      coalesce((SELECT json_agg(json_build_object('id', r.id, 'label', 'Version ' || r.version_label, 'status', r.status, 'comment', r.comment,
        'uploaded_at', r.uploaded_at, 'decided_at', r.decided_at, 'uploaded_by_name', u.name, 'decided_by_name', d.name, 'version', r.version,
        'file_name', r.file_name, 'mime', r.mime) ORDER BY r.uploaded_at DESC)
        FROM document_revision r JOIN app_user u ON u.id = r.uploaded_by LEFT JOIN app_user d ON d.id = r.decided_by WHERE r.document_id = doc.id), '[]') AS revisions
    FROM document doc WHERE doc.project_id = ${projectId}`;
  return {
    role: actor.role,
    folders,
    items: [
      ...plans.map((p) => ({ ...(p as Record<string, unknown>), type: 'plan' as const })),
      ...docs.map((d) => ({ ...(d as Record<string, unknown>), type: 'document' as const })),
    ].filter((i) => ((i as Record<string, unknown>).revisions as unknown[]).length > 0),
  };
}

export async function createFolder(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const f = z.object({
    project_id: z.string().uuid(),
    parent_id: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(120),
    visible_to_nu: z.boolean().default(false),
    visible_to_bauherr: z.boolean().default(false),
    kind: z.enum(['plaene', 'dokumente']).optional(),
    location_id: z.string().uuid().nullish(),
  }).parse(input);
  const actor = await actorFor(tx, userId, f.project_id);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Ordner anlegen dürfen Bau- und Projektleitung');
  // Subfolders inherit the kind of the parent (a folder under "Pläne" holds plans).
  let kind = f.kind;
  if (!kind && f.parent_id) kind = ((await tx`SELECT kind FROM folder WHERE id = ${f.parent_id}`)[0]?.kind as 'plaene' | 'dokumente') ?? 'dokumente';
  const [row] = await tx`INSERT INTO folder ${tx({ ...f, kind: kind ?? 'dokumente', parent_id: f.parent_id ?? null, location_id: f.location_id ?? null } as never)} RETURNING *`;
  await audit(tx, userId, f.project_id, row!.id as string, 'ordner', meta, { name: f.name });
  return row!;
}

const UploadFields = z.object({
  project_id: z.string().uuid(),
  folder_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  version_label: z.string().trim().max(20).optional(),
  comment: z.string().max(2000).optional(),
});
const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dwg: 'application/acad', zip: 'application/zip' };

/** Upload a new document or a new version. Always "Zur Prüfung" first. */
export async function uploadDocument(tx: TxSql, userId: string, fields: unknown, file: { bytes: Buffer; name: string }, meta: WriteMeta) {
  const f = UploadFields.parse(fields);
  const actor = await actorFor(tx, userId, f.project_id);
  if (actor.role !== 'bauleitung' && actor.role !== 'polier') throw new HttpError(403, 'Dokumente hochladen dürfen Leitung und Polier');
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new HttpError(422, `Dateityp .${ext} wird nicht unterstützt (PDF, Bilder, DOCX, XLSX, DWG, ZIP)`);
  let docId = f.document_id;
  let label = f.version_label;
  if (!docId) {
    if (!f.folder_id || !f.name) throw new HttpError(422, 'Für ein neues Dokument fehlen Ordner und Name');
    const [folder] = await tx`SELECT id FROM folder WHERE id = ${f.folder_id} AND project_id = ${f.project_id}`;
    if (!folder) throw new HttpError(404, 'Ordner nicht gefunden');
    docId = randomUUID();
    await tx`INSERT INTO document (id, project_id, folder_id, name) VALUES (${docId}, ${f.project_id}, ${f.folder_id}, ${f.name})`;
    label ??= '1';
  } else {
    const [doc] = await tx`SELECT id FROM document WHERE id = ${docId} AND project_id = ${f.project_id}`;
    if (!doc) throw new HttpError(404, 'Dokument nicht gefunden');
    const [last] = await tx`SELECT version_label FROM document_revision WHERE document_id = ${docId} ORDER BY uploaded_at DESC LIMIT 1`;
    const prev = (last?.version_label as string) ?? '0';
    label ??= /^\d+$/.test(prev) ? String(Number(prev) + 1) : nextPlanIndex(prev);
  }
  const [dup] = await tx`SELECT 1 FROM document_revision WHERE document_id = ${docId} AND version_label = ${label}`;
  if (dup) throw new HttpError(409, `Version ${label} gibt es schon`);
  const revId = randomUUID();
  const key = `${revId}.${ext}`;
  await mkdir(DOC_DIR, { recursive: true });
  await writeFile(DOC_DIR + key, file.bytes);
  await tx`INSERT INTO document_revision (id, document_id, project_id, version_label, file_key, file_name, mime, size_bytes, comment, uploaded_by, uploaded_at)
           VALUES (${revId}, ${docId}, ${f.project_id}, ${label}, ${key}, ${file.name}, ${mime}, ${file.bytes.length}, ${f.comment ?? null}, ${userId}, ${meta.occurredAt})`;
  await audit(tx, userId, f.project_id, docId, 'hochgeladen', meta, { revision: revId, version: label });
  return { document_id: docId, revision_id: revId, version_label: label };
}

/** Leitung releases (previous version → "Alt") or rejects (reason required). */
export async function decideDocument(tx: TxSql, userId: string, revisionId: string, input: unknown, meta: WriteMeta) {
  const d = z.object({ decision: z.enum(['freigeben', 'ablehnen']), comment: z.string().max(2000).optional(), base_version: z.number().int() }).parse(input);
  const [rev] = await tx`SELECT * FROM document_revision WHERE id = ${revisionId}`;
  if (!rev) throw new HttpError(404, 'Version nicht gefunden');
  const actor = await actorFor(tx, userId, rev.project_id as string);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Freigeben dürfen Bau- und Projektleitung');
  if (rev.status !== 'zur_pruefung') throw new HttpError(409, `Diese Version ist bereits „${PLAN_REVISION_LABELS[rev.status as keyof typeof PLAN_REVISION_LABELS]}“`);
  if (rev.version !== d.base_version) throw new HttpError(409, 'Die Version wurde inzwischen geändert');
  if (d.decision === 'ablehnen' && !d.comment?.trim()) throw new HttpError(422, 'Bitte einen Grund für die Ablehnung angeben');
  if (d.decision === 'freigeben') {
    await tx`UPDATE document_revision SET status = 'ersetzt', version = version + 1 WHERE document_id = ${rev.document_id as string} AND status = 'freigegeben'`;
    await tx`UPDATE document SET current_revision_id = ${revisionId} WHERE id = ${rev.document_id as string}`;
  }
  const [row] = await tx`
    UPDATE document_revision SET status = ${d.decision === 'freigeben' ? 'freigegeben' : 'abgelehnt'}, decided_by = ${userId}, decided_at = now(),
      comment = coalesce(${d.comment ?? null}, comment), version = version + 1
    WHERE id = ${revisionId} AND version = ${d.base_version} RETURNING *`;
  if (!row) throw new HttpError(409, 'Gleichzeitige Änderung');
  await audit(tx, userId, rev.project_id as string, rev.document_id as string, d.decision === 'freigeben' ? 'freigegeben' : 'abgelehnt', meta, { revision: revisionId, comment: d.comment ?? null });
  return row;
}

/** File of a version. PDFs get the QR stamp (current / outdated), other types are served as they are. */
export async function documentFile(tx: TxSql, revisionId: string) {
  const [r] = await tx`
    SELECT r.*, d.name AS doc_name, c.version_label AS current_label, u.name AS decided_by_name
    FROM document_revision r JOIN document d ON d.id = r.document_id
    LEFT JOIN document_revision c ON c.id = d.current_revision_id LEFT JOIN app_user u ON u.id = r.decided_by
    WHERE r.id = ${revisionId}`; // RLS
  if (!r) throw new HttpError(404, 'Dokument nicht gefunden');
  const raw = await readFile(DOC_DIR + (r.file_key as string).replace(/[^a-z0-9._-]/gi, ''));
  if (r.mime !== 'application/pdf') return { bytes: raw, mime: r.mime as string, name: r.file_name as string };
  const bytes = await stampPdf(raw, {
    checkId: revisionId,
    title: r.doc_name as string,
    label: `Version ${r.version_label}`,
    status: r.status as StampInfo['status'],
    decidedAt: (r.decided_at as Date) ?? null,
    decidedBy: (r.decided_by_name as string) ?? null,
    currentLabel: r.current_label ? `Version ${r.current_label}` : null,
  });
  return { bytes: Buffer.from(bytes), mime: 'application/pdf', name: r.file_name as string };
}

/** "Plan_EG_Index_C.pdf" → name "Plan EG", label "C". Recognises Index/Rev/V suffixes. */
export function parseFileName(file: string) {
  const base = file.replace(/\.[^.]+$/, '');
  const m = base.match(/^(.*?)[\s_-]*(?:index|idx|rev|stand|version|v)[\s_.-]*([A-Za-z]{1,2}|\d{1,3})$/i);
  const name = (m ? m[1]! : base).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || base;
  return { name, label: m ? m[2]!.toUpperCase() : undefined };
}

/**
 * Simplified upload: drop a file into a folder, nothing else to fill in (docs/fachkonzept/03).
 * - Same name in the folder → new version of it; otherwise a new document.
 * - PDF in a plan folder → plan (shows up under "Pläne"); Ort from the folder, the file name or the first Geschoss.
 */
export async function smartUpload(tx: TxSql, userId: string, fields: unknown, file: { bytes: Buffer; name: string }, meta: WriteMeta) {
  const f = z.object({ project_id: z.string().uuid(), folder_id: z.string().uuid(), comment: z.string().max(2000).optional() }).parse(fields);
  const [folder] = await tx`SELECT id, kind, location_id FROM folder WHERE id = ${f.folder_id} AND project_id = ${f.project_id}`;
  if (!folder) throw new HttpError(404, 'Ordner nicht gefunden');
  const { name, label } = parseFileName(file.name);
  const isPdf = /\.pdf$/i.test(file.name);
  if (folder.kind === 'plaene' && isPdf) {
    const [plan] = await tx`SELECT id FROM plan WHERE folder_id = ${f.folder_id} AND lower(name) = lower(${name}) LIMIT 1`;
    let locationId = folder.location_id as string | null;
    if (!plan && !locationId) {
      const locs = await tx`SELECT id, name, kind FROM location WHERE project_id = ${f.project_id} AND kind <> 'raum' ORDER BY sort`;
      // ANNAHME: Ort aus dem Dateinamen ("EG", "OG 1"), sonst das erste Geschoss.
      const hit = locs.find((l) => new RegExp(`(^|\\s)${(l.name as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(name));
      locationId = (hit?.id ?? locs.find((l) => l.kind === 'geschoss')?.id ?? locs[0]?.id) as string;
    }
    const r = await uploadRevision(tx, userId, plan
      ? { project_id: f.project_id, plan_id: plan.id, plan_index: label, comment: f.comment }
      : { project_id: f.project_id, folder_id: f.folder_id, name, location_id: locationId, plan_index: label, comment: f.comment }, file.bytes, meta);
    return { type: 'plan' as const, name, label: `Index ${r.plan_index}`, isNew: !plan };
  }
  const [doc] = await tx`SELECT id FROM document WHERE folder_id = ${f.folder_id} AND lower(name) = lower(${name}) LIMIT 1`;
  const r = await uploadDocument(tx, userId, doc
    ? { project_id: f.project_id, document_id: doc.id, version_label: label, comment: f.comment }
    : { project_id: f.project_id, folder_id: f.folder_id, name, version_label: label, comment: f.comment }, file, meta);
  return { type: 'document' as const, name, label: `Version ${r.version_label}`, isNew: !doc };
}
