/**
 * Mangelanzeige (docs/fachkonzept/04-maengel.md): draft → send (PDF + e-mail) → locked.
 * Rights: RLS decides visibility (internal; NU only sent ones to the own company); here: only Bauleitung writes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TxSql } from '@bap/db';
import { AnzeigeDraft, AnzeigePatch, anzeigeNo, canBePosition, formatDate, type MangelStatus } from '@bap/domain';
import { renderAnzeigePdf, type AnzeigePdfData } from './anzeige-pdf';
import { sendMail } from './mailer';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const STORAGE = fileURLToPath(new URL('../../../storage/', import.meta.url));
export const PLAN_DIR = `${STORAGE}plans/`;
const ANZEIGE_DIR = `${STORAGE}anzeigen/`;

type Anzeige = Record<string, unknown> & { id: string; project_id: string; company_id: string; status: 'entwurf' | 'versendet'; version: number; number: number | null };

async function audit(tx: TxSql, userId: string, a: { id: string; project_id: string }, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${a.project_id}, 'mangelanzeige', ${a.id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${a.project_id}`;
}

export async function loadAnzeige(tx: TxSql, id: string): Promise<Anzeige> {
  const [a] = await tx`SELECT * FROM mangelanzeige WHERE id = ${id}`; // RLS
  if (!a) throw new HttpError(404, 'Mangelanzeige nicht gefunden');
  return a as Anzeige;
}

async function requireBauleitung(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Nur die Bauleitung erstellt und versendet Mangelanzeigen');
  return actor;
}

/** Checks that every Mangel belongs to the project and may be a position for this NU. */
async function checkPositions(tx: TxSql, projectId: string, companyId: string, ids: string[]) {
  const rows = await tx`SELECT id, project_id, status, assigned_company_id, assignment_confirmed, deleted_at FROM mangel WHERE id IN ${tx(ids)}`;
  for (const id of ids) {
    const m = rows.find((r) => r.id === id);
    if (!m || m.project_id !== projectId) throw new HttpError(422, 'Mangel nicht gefunden');
    if (!canBePosition(m as never, companyId)) throw new HttpError(422, 'Nur offene Mängel, die diesem Nachunternehmer bestätigt zugewiesen sind, können in die Anzeige');
  }
}

async function writePositions(tx: TxSql, a: { id: string; project_id: string; company_id: string }, ids: string[]) {
  await tx`DELETE FROM mangelanzeige_position WHERE anzeige_id = ${a.id}`;
  await tx`INSERT INTO mangelanzeige_position ${tx(ids.map((mangel_id, i) => ({ anzeige_id: a.id, project_id: a.project_id, company_id: a.company_id, pos: i + 1, mangel_id })))}`;
}

export async function createAnzeige(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = AnzeigeDraft.parse(input);
  await requireBauleitung(tx, userId, d.project_id);
  const [existing] = await tx`SELECT id FROM mangelanzeige WHERE id = ${d.id}`;
  if (existing) return loadAnzeige(tx, d.id); // idempotent (retried upload)
  const [co] = await tx`SELECT c.kind, c.email FROM company c JOIN project_member pm ON pm.company_id = c.id AND pm.project_id = ${d.project_id} WHERE c.id = ${d.company_id} LIMIT 1`;
  if (!co || co.kind !== 'nu') throw new HttpError(422, 'Empfänger muss ein Nachunternehmer des Projekts sein');
  await checkPositions(tx, d.project_id, d.company_id, d.mangel_ids);
  const [p] = await tx`SELECT tenant_id FROM project WHERE id = ${d.project_id}`;
  const row = {
    id: d.id, tenant_id: p!.tenant_id, project_id: d.project_id, company_id: d.company_id, deadline: d.deadline,
    recipient_email: d.recipient_email ?? co.email ?? null, note: d.note ?? null, created_by: userId, created_at: meta.occurredAt,
  };
  await tx`INSERT INTO mangelanzeige ${tx(row as never)}`;
  await writePositions(tx, row, d.mangel_ids);
  await audit(tx, userId, row, 'erstellt', meta, { positions: d.mangel_ids.length });
  return loadAnzeige(tx, d.id);
}

export async function patchAnzeige(tx: TxSql, userId: string, id: string, baseVersion: number, input: unknown, meta: WriteMeta) {
  const a = await loadAnzeige(tx, id);
  await requireBauleitung(tx, userId, a.project_id);
  if (a.status !== 'entwurf') throw new HttpError(409, 'Versendete Mangelanzeigen sind gesperrt. Korrekturen als neue Anzeige.');
  if (a.version !== baseVersion) throw new HttpError(409, 'Die Mangelanzeige wurde inzwischen geändert');
  const { mangel_ids, ...fields } = AnzeigePatch.parse(input);
  if (mangel_ids) {
    await checkPositions(tx, a.project_id, a.company_id, mangel_ids);
    await writePositions(tx, a, mangel_ids);
  }
  const [row] = await tx`
    UPDATE mangelanzeige SET ${tx(fields as never)}, version = version + 1, updated_at = now()
    WHERE id = ${id} AND version = ${baseVersion} AND status = 'entwurf' RETURNING *`;
  if (!row) throw new HttpError(409, 'Gleichzeitige Änderung');
  await audit(tx, userId, a, 'geaendert', meta, { ...fields, positions: mangel_ids?.length });
  return row as Anzeige;
}

/** Anzeige with positions, as shown in the web app and printed in the PDF. */
export async function anzeigeDetails(tx: TxSql, id: string) {
  const a = await loadAnzeige(tx, id);
  const [extra] = await tx`
    SELECT c.name AS company_name, c.email AS company_email, u.name AS created_by_name, s.name AS sent_by_name
    FROM company c JOIN app_user u ON u.id = ${a.created_by as string} LEFT JOIN app_user s ON s.id = ${(a.sent_by as string) ?? null}
    WHERE c.id = ${a.company_id}`;
  const positions = await tx`
    SELECT p.pos, m.id AS mangel_id, m.number, m.description, m.status, m.due_date, m.plan_id, m.pin_page, m.pin_x, m.pin_y,
           l.name AS location_name, g.name AS gewerk_name, pl.name AS plan_name, pl.plan_index, pl.file_key
    FROM mangelanzeige_position p
    JOIN mangel m ON m.id = p.mangel_id
    JOIN location l ON l.id = m.location_id
    JOIN gewerk g ON g.id = m.gewerk_id
    LEFT JOIN plan pl ON pl.id = m.plan_id
    WHERE p.anzeige_id = ${id} ORDER BY p.pos`;
  return { ...a, ...(extra as Record<string, unknown>), anzeige_no: anzeigeNo(a.number), positions } as Anzeige & Record<string, unknown> & { anzeige_no: string; positions: typeof positions };
}

async function pdfData(tx: TxSql, id: string, draft: boolean, number: number | null, signerId: string): Promise<AnzeigePdfData> {
  const d = await anzeigeDetails(tx, id);
  const [ctx] = await tx`
    SELECT p.name AS project, (SELECT c.name FROM company c WHERE c.tenant_id = p.tenant_id AND c.kind = 'own' LIMIT 1) AS own,
           (SELECT name FROM app_user WHERE id = ${signerId}) AS signer
    FROM project p WHERE p.id = ${d.project_id}`;
  return {
    number,
    draft,
    createdAt: new Date(),
    deadline: String(iso(d.deadline)),
    note: (d.note as string | null) ?? null,
    ownCompany: (ctx!.own as string) ?? '',
    project: ctx!.project as string,
    signer: (ctx!.signer as string) ?? '',
    recipient: { name: d.company_name as string, email: (d.recipient_email as string | null) ?? (d.company_email as string | null) },
    positions: d.positions.map((p) => ({
      pos: p.pos as number,
      number: p.number as number,
      description: p.description as string,
      location: p.location_name as string,
      gewerk: p.gewerk_name as string,
      dueDate: iso(p.due_date),
      plan: p.file_key && p.pin_x != null
        ? { file: p.file_key as string, name: p.plan_name as string, index: p.plan_index as string, page: (p.pin_page as number) ?? 1, x: p.pin_x as number, y: p.pin_y as number }
        : null,
    })),
  };
}

/** Draft: rendered on the fly with watermark. Sent: the stored, unchanged file. */
export async function anzeigePdf(tx: TxSql, userId: string, id: string): Promise<{ bytes: Uint8Array | string; name: string }> {
  const a = await loadAnzeige(tx, id);
  if (a.status === 'versendet' && a.file_key) return { bytes: ANZEIGE_DIR + (a.file_key as string), name: `Mangelanzeige-${anzeigeNo(a.number)}.pdf` };
  return { bytes: await renderAnzeigePdf(await pdfData(tx, id, true, null, userId), PLAN_DIR), name: 'Mangelanzeige-Entwurf.pdf' };
}

/**
 * Send: assign number, render the final PDF, store it, update the Mängel deadlines, audit, e-mail.
 * Everything runs in the caller's transaction; the mail goes out last, so a mail error rolls back the send.
 */
export async function sendAnzeige(tx: TxSql, userId: string, id: string, baseVersion: number, meta: WriteMeta) {
  const a = await loadAnzeige(tx, id);
  await requireBauleitung(tx, userId, a.project_id);
  if (a.status !== 'entwurf') throw new HttpError(409, 'Diese Mangelanzeige wurde bereits versendet');
  if (a.version !== baseVersion) throw new HttpError(409, 'Die Mangelanzeige wurde inzwischen geändert');
  const details = await anzeigeDetails(tx, id);
  const to = (a.recipient_email as string | null) ?? (details.company_email as string | null);
  if (!to) throw new HttpError(422, 'Keine E-Mail-Adresse des Nachunternehmers hinterlegt');
  await checkPositions(tx, a.project_id, a.company_id, details.positions.map((p) => p.mangel_id as string));

  const [{ n }] = (await tx`SELECT app.next_anzeige_number(${a.project_id}) AS n`) as unknown as [{ n: number }];
  const data = await pdfData(tx, id, false, n, userId);
  const bytes = await renderAnzeigePdf(data, PLAN_DIR);
  const fileKey = `${id}.pdf`;
  await mkdir(ANZEIGE_DIR, { recursive: true });
  await writeFile(ANZEIGE_DIR + fileKey, bytes);

  const [sent] = await tx`
    UPDATE mangelanzeige SET status = 'versendet', number = ${n}, sent_at = now(), sent_by = ${userId}, file_key = ${fileKey},
      recipient_email = ${to}, version = version + 1, updated_at = now()
    WHERE id = ${id} AND version = ${baseVersion} AND status = 'entwurf' RETURNING *`;
  if (!sent) throw new HttpError(409, 'Gleichzeitige Änderung');

  // The deadline of the Anzeige becomes the deadline of its Mängel (docs/fachkonzept/04).
  const deadline = String(iso(a.deadline));
  for (const p of details.positions) {
    if ((p.status as MangelStatus) === 'abgenommen' || iso(p.due_date) === deadline) continue;
    const [m] = await tx`UPDATE mangel SET due_date = ${deadline}, version = version + 1, updated_at = now() WHERE id = ${p.mangel_id as string} RETURNING id, project_id`;
    if (m) {
      await tx`
        INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
        SELECT tenant_id, ${a.project_id}, 'mangel', ${m.id as string}, 'frist', ${userId}, ${meta.deviceId}, ${meta.occurredAt},
               ${tx.json({ due_date: deadline, from: iso(p.due_date), source: anzeigeNo(n) } as never)}
        FROM project WHERE id = ${a.project_id}`;
    }
  }
  await audit(tx, userId, a, 'versendet', meta, { number: n, to, positions: details.positions.length, file: fileKey });

  const mail = await sendMail({
    from: process.env.MAIL_FROM ?? 'Bau Akte Pro <noreply@bauaktepro.example.test>',
    to,
    subject: `Mangelanzeige ${anzeigeNo(n)} – ${data.project}`,
    text:
      `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die Mangelanzeige ${anzeigeNo(n)} zum Bauvorhaben ${data.project} ` +
      `mit ${details.positions.length} Position(en). Bitte beseitigen Sie die Mängel bis spätestens ${formatDate(deadline)}.\n\n` +
      `Mit freundlichen Grüßen\n${data.signer}\n${data.ownCompany}`,
    attachments: [{ filename: `Mangelanzeige-${anzeigeNo(n)}.pdf`, content: bytes }],
  });
  return { ...(sent as Anzeige), mail };
}

function iso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
