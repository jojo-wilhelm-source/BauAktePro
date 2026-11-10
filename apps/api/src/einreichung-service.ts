/**
 * NU-Einreichungen (docs/fachkonzept/11): Nachträge and Rechnungen uploaded by the NU through the portal,
 * seen and decided by Bau- and Projektleitung. Nachträge above the Freigabegrenze go to the Geschäftsführung.
 * No payment is ever triggered (CLAUDE.md, Arbeitsweise 7).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { EINREICHUNG_STATUS_LABELS, needsGeschaeftsfuehrung, type EinreichungStatus } from '@bap/domain';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const DIR = fileURLToPath(new URL('../../../storage/einreichungen/', import.meta.url));

async function audit(tx: TxSql, userId: string, projectId: string, id: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'einreichung', ${id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

export async function listEinreichungen(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  if (actor.role !== 'bauleitung' && actor.role !== 'nu') throw new HttpError(403, 'Nachträge und Rechnungen sehen Leitung und der einreichende NU');
  const rows = await tx`
    SELECT e.id, e.number, e.company_id, c.name AS company_name, e.kind, e.rechnung_art, e.title, e.amount_net::float AS amount_net, e.file_name,
           e.note, e.status, e.decision_reason, e.decided_at, d.name AS decided_by_name, e.submitted_at, s.name AS submitted_by_name, e.version
    FROM einreichung e JOIN company c ON c.id = e.company_id JOIN app_user s ON s.id = e.submitted_by LEFT JOIN app_user d ON d.id = e.decided_by
    WHERE e.project_id = ${projectId} ORDER BY e.submitted_at DESC`;
  return { role: actor.role, companyId: actor.companyId, einreichungen: rows };
}

const SubmitFields = z.object({
  project_id: z.string().uuid(),
  company_id: z.string().uuid().optional(), // Leitung may record one on behalf of a NU
  kind: z.enum(['nachtrag', 'rechnung']),
  rechnung_art: z.enum(['abschlag', 'teil', 'schluss', 'regie']).optional(),
  title: z.string().trim().min(1).max(300),
  amount_net: z.coerce.number().min(0).max(100_000_000),
  note: z.string().max(4000).optional(),
});

export async function submitEinreichung(tx: TxSql, userId: string, fields: unknown, file: { bytes: Buffer; name: string }, meta: WriteMeta) {
  const f = SubmitFields.parse(fields);
  const actor = await actorFor(tx, userId, f.project_id);
  let companyId: string;
  if (actor.role === 'nu') companyId = actor.companyId;
  else if (actor.role === 'bauleitung' && f.company_id) companyId = f.company_id;
  else throw new HttpError(403, 'Nachträge und Rechnungen reicht der Nachunternehmer ein');
  if (f.kind === 'rechnung' && !f.rechnung_art) throw new HttpError(422, 'Art der Rechnung fehlt');
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!['pdf', 'xml', 'jpg', 'jpeg', 'png'].includes(ext)) throw new HttpError(422, 'Bitte als PDF (oder E-Rechnung XML) hochladen');
  const id = randomUUID();
  const key = `${id}.${ext}`;
  await mkdir(DIR, { recursive: true });
  await writeFile(DIR + key, file.bytes);
  // Separate numbering: Nachträge NT-001…, Rechnungen RE-001…
  const [{ n }] = (await tx`SELECT app.next_counter(${f.project_id}, ${f.kind}) AS n`) as unknown as [{ n: number }];
  const [row] = await tx`
    INSERT INTO einreichung (id, project_id, number, company_id, kind, rechnung_art, title, amount_net, file_key, file_name, note, submitted_by, submitted_at)
    VALUES (${id}, ${f.project_id}, ${n}, ${companyId}, ${f.kind}, ${f.kind === 'rechnung' ? f.rechnung_art! : null}, ${f.title}, ${f.amount_net},
            ${key}, ${file.name}, ${f.note ?? null}, ${userId}, ${meta.occurredAt})
    RETURNING *`;
  await audit(tx, userId, f.project_id, id, 'eingereicht', meta, { kind: f.kind, amount_net: f.amount_net, number: n });
  return row!;
}

export const DecideInput = z.object({
  /** zuruecknehmen: Leitung takes a decision back (wrong click) → "In Prüfung" again, reason required.
   *  zurueckziehen: NU withdraws a submission nobody has looked at yet. */
  decision: z.enum(['pruefen', 'freigeben', 'ablehnen', 'zuruecknehmen', 'zurueckziehen']),
  reason: z.string().max(2000).optional(),
  base_version: z.number().int(),
});

export async function decideEinreichung(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = DecideInput.parse(input);
  const [e] = await tx`SELECT * FROM einreichung WHERE id = ${id}`;
  if (!e) throw new HttpError(404, 'Einreichung nicht gefunden');
  const actor = await actorFor(tx, userId, e.project_id as string);
  const st = e.status as EinreichungStatus;
  if (e.version !== d.base_version) throw new HttpError(409, 'Die Einreichung wurde inzwischen geändert');

  let status: EinreichungStatus;
  if (d.decision === 'zurueckziehen') {
    if (actor.role !== 'nu' || actor.companyId !== e.company_id) throw new HttpError(403, 'Zurückziehen kann nur der einreichende Nachunternehmer');
    if (st !== 'eingereicht') throw new HttpError(409, 'Nur solange die Bauleitung noch nicht prüft');
    status = 'zurueckgezogen';
  } else {
    if (actor.role !== 'bauleitung') throw new HttpError(403, 'Entscheiden dürfen Bau- und Projektleitung');
    if (d.decision === 'zuruecknehmen') {
      if (st !== 'freigegeben' && st !== 'abgelehnt' && st !== 'gf_erforderlich') throw new HttpError(409, 'Es gibt keine Entscheidung zum Zurücknehmen');
      if (!d.reason?.trim()) throw new HttpError(422, 'Bitte kurz begründen, warum die Entscheidung zurückgenommen wird');
      status = 'in_pruefung';
    } else {
      if (st !== 'eingereicht' && st !== 'in_pruefung') throw new HttpError(409, `Bereits „${EINREICHUNG_STATUS_LABELS[st]}“ – zuerst die Entscheidung zurücknehmen`);
      if (d.decision === 'ablehnen' && !d.reason?.trim()) throw new HttpError(422, 'Bitte eine Begründung angeben (der NU sieht sie)');
      status = d.decision === 'pruefen' ? 'in_pruefung'
        : d.decision === 'ablehnen' ? 'abgelehnt'
          : needsGeschaeftsfuehrung(e.kind as 'nachtrag' | 'rechnung', Number(e.amount_net)) ? 'gf_erforderlich' : 'freigegeben';
    }
  }
  const decided = status !== 'in_pruefung' && status !== 'zurueckgezogen';
  const [row] = await tx`
    UPDATE einreichung SET status = ${status}, decision_reason = ${d.decision === 'zuruecknehmen' ? null : (d.reason ?? null)},
      decided_by = ${decided ? userId : null}, decided_at = ${decided ? new Date() : null}, version = version + 1
    WHERE id = ${id} AND version = ${d.base_version} RETURNING *`;
  if (!row) throw new HttpError(409, 'Gleichzeitige Änderung');
  // The audit log keeps every step, also the decision that was taken back.
  await audit(tx, userId, e.project_id as string, id, d.decision === 'zuruecknehmen' ? 'entscheidung_zurueckgenommen' : status, meta, {
    from: st, to: status, reason: d.reason ?? null, amount_net: Number(e.amount_net),
  });
  return row;
}

export async function einreichungFile(tx: TxSql, id: string) {
  const [e] = await tx`SELECT file_key, file_name FROM einreichung WHERE id = ${id}`; // RLS
  if (!e) throw new HttpError(404, 'Einreichung nicht gefunden');
  const key = (e.file_key as string).replace(/[^a-z0-9._-]/gi, '');
  const mime = key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.xml') ? 'application/xml' : key.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { bytes: await readFile(DIR + key), mime, name: e.file_name as string };
}
