/**
 * Plan register with revisions and approval (docs/fachkonzept/03-dateiablage-plaene.md).
 * Upload → "Zur Prüfung" → Bauleitung releases (old index becomes "Ersetzt") or rejects.
 * plan.plan_index / file_key always point to the current released revision (devices download that one).
 */
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { formatDate, nextPlanIndex, PLAN_REVISION_LABELS } from '@bap/domain';
import { PLAN_DIR } from './anzeige-service';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173';

async function audit(tx: TxSql, userId: string, projectId: string, entityId: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'plan', ${entityId}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

export async function listPlans(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  const plans = await tx`
    SELECT p.id, p.name, p.plan_index, p.location_id, l.name AS location_name, p.released_at, p.current_revision_id, p.visible_to_nu, p.visible_to_bauherr
    FROM plan p JOIN location l ON l.id = p.location_id WHERE p.project_id = ${projectId} ORDER BY p.name`;
  const revisions = await tx`
    SELECT r.id, r.plan_id, r.plan_index, r.status, r.comment, r.uploaded_at, r.decided_at, r.version,
           u.name AS uploaded_by_name, d.name AS decided_by_name
    FROM plan_revision r JOIN app_user u ON u.id = r.uploaded_by LEFT JOIN app_user d ON d.id = r.decided_by
    WHERE r.project_id = ${projectId} ORDER BY r.uploaded_at DESC`;
  return { role: actor.role, plans: plans.map((p) => ({ ...p, revisions: revisions.filter((r) => r.plan_id === p.id) })) };
}

const UploadFields = z.object({
  project_id: z.string().uuid(),
  plan_id: z.string().uuid().optional(), // missing: new plan
  folder_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  location_id: z.string().uuid().optional(),
  plan_index: z.string().trim().regex(/^[A-Za-z]{1,3}$/, 'Index: Buchstaben A–ZZZ').optional(),
  comment: z.string().max(2000).optional(),
});

/** Upload a new index (or a new plan). It always lands in "Zur Prüfung", never directly among the valid plans. */
export async function uploadRevision(tx: TxSql, userId: string, fields: unknown, file: Buffer, meta: WriteMeta) {
  const f = UploadFields.parse(fields);
  const actor = await actorFor(tx, userId, f.project_id);
  if (actor.role !== 'bauleitung' && actor.role !== 'polier') throw new HttpError(403, 'Pläne hochladen dürfen Bauleitung und Polier');
  let pageCount: number;
  try {
    pageCount = (await PDFDocument.load(file, { ignoreEncryption: true })).getPageCount();
  } catch {
    throw new HttpError(422, 'Die Datei ist kein lesbares PDF');
  }

  let planId = f.plan_id;
  let index = f.plan_index?.toUpperCase();
  const revisionId = randomUUID();
  const fileKey = `${revisionId}.pdf`;
  if (!planId) {
    if (!f.name || !f.location_id) throw new HttpError(422, 'Für einen neuen Plan fehlen Name und Ort');
    planId = randomUUID();
    index ??= 'A';
    // A new plan is invisible to NU/Bauherr until its first index is released.
    await tx`INSERT INTO plan (id, project_id, location_id, name, plan_index, file_key, page_count, visible_to_nu, visible_to_bauherr, folder_id)
             VALUES (${planId}, ${f.project_id}, ${f.location_id}, ${f.name}, ${index}, ${fileKey}, ${pageCount}, false, false, ${f.folder_id ?? null})`;
  } else {
    const [plan] = await tx`SELECT id, project_id FROM plan WHERE id = ${planId}`;
    if (!plan || plan.project_id !== f.project_id) throw new HttpError(404, 'Plan nicht gefunden');
    // Latest uploaded index (not max(): 'Z' sorts after 'AA').
    const [last] = await tx`SELECT plan_index FROM plan_revision WHERE plan_id = ${planId} ORDER BY uploaded_at DESC LIMIT 1`;
    index ??= last ? nextPlanIndex(last.plan_index as string) : 'A';
  }
  const [dup] = await tx`SELECT 1 FROM plan_revision WHERE plan_id = ${planId} AND plan_index = ${index}`;
  if (dup) throw new HttpError(409, `Index ${index} gibt es für diesen Plan schon`);
  await writeFile(PLAN_DIR + fileKey, file);
  await tx`INSERT INTO plan_revision (id, plan_id, project_id, plan_index, file_key, page_count, status, comment, uploaded_by, uploaded_at)
           VALUES (${revisionId}, ${planId}, ${f.project_id}, ${index}, ${fileKey}, ${pageCount}, 'zur_pruefung', ${f.comment ?? null}, ${userId}, ${meta.occurredAt})`;
  await audit(tx, userId, f.project_id, planId, 'hochgeladen', meta, { revision: revisionId, index });
  return { plan_id: planId, revision_id: revisionId, plan_index: index };
}

export const DecisionInput = z.object({
  decision: z.enum(['freigeben', 'ablehnen']),
  comment: z.string().max(2000).optional(),
  base_version: z.number().int(),
});

/** Bauleitung decides. Release: the previous released index becomes "Ersetzt" (= folder "Alt"), the plan points to the new one. */
export async function decideRevision(tx: TxSql, userId: string, revisionId: string, input: unknown, meta: WriteMeta) {
  const d = DecisionInput.parse(input);
  const [rev] = await tx`SELECT * FROM plan_revision WHERE id = ${revisionId}`;
  if (!rev) throw new HttpError(404, 'Planstand nicht gefunden');
  const actor = await actorFor(tx, userId, rev.project_id as string);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Pläne freigeben darf nur die Bauleitung');
  if (rev.status !== 'zur_pruefung') throw new HttpError(409, `Dieser Planstand ist bereits „${PLAN_REVISION_LABELS[rev.status as keyof typeof PLAN_REVISION_LABELS]}“`);
  if (rev.version !== d.base_version) throw new HttpError(409, 'Der Planstand wurde inzwischen geändert');
  if (d.decision === 'ablehnen' && !d.comment?.trim()) throw new HttpError(422, 'Bitte einen Grund für die Ablehnung angeben');

  if (d.decision === 'freigeben') {
    await tx`UPDATE plan_revision SET status = 'ersetzt', version = version + 1 WHERE plan_id = ${rev.plan_id as string} AND status = 'freigegeben'`;
    const [first] = await tx`SELECT current_revision_id FROM plan WHERE id = ${rev.plan_id as string}`;
    await tx`
      UPDATE plan SET plan_index = ${rev.plan_index as string}, file_key = ${rev.file_key as string}, page_count = ${rev.page_count as number},
        current_revision_id = ${revisionId}, released_at = now(),
        visible_to_nu = CASE WHEN ${!first?.current_revision_id} THEN true ELSE visible_to_nu END  -- ANNAHME: first release makes it visible to NU
      WHERE id = ${rev.plan_id as string}`;
  }
  const [updated] = await tx`
    UPDATE plan_revision SET status = ${d.decision === 'freigeben' ? 'freigegeben' : 'abgelehnt'}, decided_by = ${userId}, decided_at = now(),
      comment = coalesce(${d.comment ?? null}, comment), version = version + 1
    WHERE id = ${revisionId} AND version = ${d.base_version} RETURNING *`;
  if (!updated) throw new HttpError(409, 'Gleichzeitige Änderung');
  await audit(tx, userId, rev.project_id as string, rev.plan_id as string, d.decision === 'freigeben' ? 'freigegeben' : 'abgelehnt', meta, {
    revision: revisionId, index: rev.plan_index, comment: d.comment ?? null,
  });
  return updated;
}

/** QR check page data: is this printed revision still the current one? */
export async function checkRevision(tx: TxSql, revisionId: string) {
  const [r] = await tx`
    SELECT r.id, r.plan_index, r.status, r.decided_at, p.id AS plan_id, p.name AS plan_name, p.plan_index AS current_index,
           p.released_at AS current_released_at, pr.name AS project_name
    FROM plan_revision r JOIN plan p ON p.id = r.plan_id JOIN project pr ON pr.id = r.project_id WHERE r.id = ${revisionId}`;
  if (r) return { ...r, kind: 'plan', is_current: r.status === 'freigegeben' && r.plan_index === r.current_index };
  // Documents (Statik, Nachweise …) carry the same QR code: same answer, generic fields.
  const [d] = await tx`
    SELECT r.id, r.version_label AS plan_index, r.status, r.decided_at, d.id AS plan_id, d.name AS plan_name,
           c.version_label AS current_index, c.decided_at AS current_released_at, pr.name AS project_name, c.id AS current_revision_id
    FROM document_revision r JOIN document d ON d.id = r.document_id JOIN project pr ON pr.id = r.project_id
    LEFT JOIN document_revision c ON c.id = d.current_revision_id WHERE r.id = ${revisionId}`;
  if (!d) throw new HttpError(404, 'Stand nicht gefunden oder keine Berechtigung');
  return { ...d, kind: 'document', is_current: d.status === 'freigegeben' && d.id === d.current_revision_id };
}

/**
 * Revision as PDF for download/print: stamped with a QR code (check page), index and release date.
 * Not released → red "NICHT FREIGEGEBEN"; replaced → "ERSETZT – aktuell Index X".
 */
export interface StampInfo {
  checkId: string; // revision id behind the QR code
  title: string; // plan/document name
  label: string; // "Index B" / "Version 2"
  status: keyof typeof PLAN_REVISION_LABELS;
  decidedAt: Date | null;
  decidedBy: string | null;
  currentLabel: string | null; // label of the current version (for "ERSETZT – aktuell …")
}

/**
 * Stamp every page with a QR code (→ check page), version and release date.
 * Not released → red "NICHT FREIGEGEBEN"; replaced → "ERSETZT – aktuell …". Shared by plans and documents.
 */
export async function stampPdf(bytes: Uint8Array, i: StampInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const qr = QRCode.create(`${PUBLIC_WEB_URL}/check/${i.checkId}`, { errorCorrectionLevel: 'M' });
  const clean = (t: string) => t.replace(/[^\x20-\xFF·–]/g, '?');
  const line1 = `${i.title} · ${i.label} · ${PLAN_REVISION_LABELS[i.status]}`;
  const line2 = i.decidedAt && i.status !== 'abgelehnt' ? `freigegeben ${formatDate(i.decidedAt.toISOString())} von ${i.decidedBy}` : 'nicht freigegeben';
  const line3 = `Abgerufen ${formatDate(new Date().toISOString())} · QR scannen = Stand prüfen`;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = 64;
    const cell = size / qr.modules.size;
    const x0 = width - size - 24;
    const y0 = 24;
    page.drawRectangle({ x: x0 - 230, y: y0 - 6, width: size + 236, height: size + 12, color: rgb(1, 1, 1), opacity: 0.92 });
    for (let row = 0; row < qr.modules.size; row++) {
      for (let col = 0; col < qr.modules.size; col++) {
        if (qr.modules.get(row, col)) page.drawRectangle({ x: x0 + col * cell, y: y0 + size - (row + 1) * cell, width: cell, height: cell, color: rgb(0, 0, 0) });
      }
    }
    page.drawText(clean(line1), { x: x0 - 222, y: y0 + 44, size: 9, font: bold });
    page.drawText(clean(line2), { x: x0 - 222, y: y0 + 30, size: 8, font });
    page.drawText(clean(line3), { x: x0 - 222, y: y0 + 16, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    const mark = i.status === 'zur_pruefung' || i.status === 'abgelehnt' ? 'NICHT FREIGEGEBEN' : i.status === 'ersetzt' ? clean(`ERSETZT – aktuell ${i.currentLabel ?? ''}`) : null;
    if (mark) page.drawText(mark, { x: 80, y: height / 2 - 120, size: Math.min(64, width / 12), font: bold, color: rgb(1, 0.23, 0.19), rotate: degrees(25), opacity: 0.25 });
  }
  return doc.save();
}

export async function stampedRevisionPdf(tx: TxSql, revisionId: string): Promise<{ bytes: Uint8Array; name: string }> {
  const [r] = await tx`
    SELECT r.*, p.name AS plan_name, p.plan_index AS current_index, d.name AS decided_by_name
    FROM plan_revision r JOIN plan p ON p.id = r.plan_id LEFT JOIN app_user d ON d.id = r.decided_by WHERE r.id = ${revisionId}`;
  if (!r) throw new HttpError(404, 'Planstand nicht gefunden');
  const bytes = await stampPdf(await readFile(PLAN_DIR + (r.file_key as string).replace(/[^a-z0-9._-]/gi, '')), {
    checkId: revisionId,
    title: r.plan_name as string,
    label: `Index ${r.plan_index}`,
    status: r.status as StampInfo['status'],
    decidedAt: (r.decided_at as Date) ?? null,
    decidedBy: (r.decided_by_name as string) ?? null,
    currentLabel: `Index ${r.current_index}`,
  });
  return { bytes, name: `${r.plan_name}-Index-${r.plan_index}.pdf`.replace(/[^\wäöüÄÖÜß.-]+/g, '_') };
}
