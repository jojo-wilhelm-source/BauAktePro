/**
 * Digitale Stundenzettel (docs/fachkonzept/08): NU via portal, Polier for own people/helpers.
 * Entwurf → Eingereicht → Bestätigt | Gekürzt | Abgelehnt. Decided by Bau- or Projektleitung.
 * Visibility via RLS: internal sees all, NU only the own company.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { stundenzettelNo, ZettelInput, ZETTEL_STATUS_LABELS, type ZettelStatus } from '@bap/domain';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const DIR = fileURLToPath(new URL('../../../storage/stunden/', import.meta.url));

async function audit(tx: TxSql, userId: string, projectId: string, id: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'stundenzettel', ${id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

async function load(tx: TxSql, id: string) {
  const [z0] = await tx`SELECT * FROM stundenzettel WHERE id = ${id}`; // RLS
  if (!z0) throw new HttpError(404, 'Stundenzettel nicht gefunden');
  return z0 as Record<string, unknown> & { id: string; project_id: string; company_id: string; status: ZettelStatus; version: number; number: number | null };
}

export async function listZettel(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  const rows = await tx`
    SELECT z.id, z.number, z.company_id, c.name AS company_name, z.period_from, z.period_to, z.status, z.hours_total, z.hours_approved,
           z.submitted_at, z.decided_at, z.version, u.name AS created_by_name, z.attachment_key IS NOT NULL AS has_attachment,
           (SELECT count(*)::int FROM stundenzettel_zeile l WHERE l.zettel_id = z.id) AS zeilen
    FROM stundenzettel z JOIN company c ON c.id = z.company_id JOIN app_user u ON u.id = z.created_by
    WHERE z.project_id = ${projectId} ORDER BY z.period_from DESC, z.number DESC NULLS FIRST`;
  return { role: actor.role, companyId: actor.companyId, zettel: rows };
}

export async function zettelDetails(tx: TxSql, userId: string, id: string) {
  const z0 = await load(tx, id);
  const actor = await actorFor(tx, userId, z0.project_id);
  const zeilen = await tx`
    SELECT l.*, loc.name AS location_name FROM stundenzettel_zeile l LEFT JOIN location loc ON loc.id = l.location_id
    WHERE l.zettel_id = ${id} ORDER BY l.datum, l.sort, l.person`;
  const [c] = await tx`SELECT name FROM company WHERE id = ${z0.company_id}`;
  const [d] = z0.decided_by ? await tx`SELECT name FROM app_user WHERE id = ${z0.decided_by as string}` : [];
  const canEdit = z0.status === 'entwurf' && (actor.role === 'bauleitung' || actor.role === 'polier' || actor.companyId === z0.company_id);
  return { ...z0, company_name: c?.name, decided_by_name: d?.name ?? null, zeilen, can_edit: canEdit, can_decide: actor.role === 'bauleitung' && z0.status === 'eingereicht' };
}

/** Create or update a draft (lines are replaced as a whole). Hours total is recalculated on the server. */
export async function saveZettel(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = ZettelInput.parse(input);
  const actor = await actorFor(tx, userId, d.project_id);
  if (actor.role === 'bauherr' || actor.role === 'einkauf') throw new HttpError(403, 'Keine Berechtigung für Stundenzettel');
  if (actor.role === 'nu' && d.company_id !== actor.companyId) throw new HttpError(403, 'Nachunternehmer reichen nur eigene Stunden ein');
  const [member] = await tx`SELECT 1 FROM project_member WHERE project_id = ${d.project_id} AND company_id = ${d.company_id} LIMIT 1`;
  if (!member) throw new HttpError(422, 'Die Firma ist nicht am Projekt beteiligt');
  if (d.period_from > d.period_to) throw new HttpError(422, 'Zeitraum: „von“ liegt nach „bis“');
  for (const l of d.zeilen) {
    if (l.datum < d.period_from || l.datum > d.period_to) throw new HttpError(422, `Zeile ${l.person} am ${l.datum} liegt außerhalb des Zeitraums`);
  }
  const total = d.zeilen.reduce((s, l) => s + l.stunden, 0);
  const [existing] = await tx`SELECT * FROM stundenzettel WHERE id = ${d.id}`;
  if (existing) {
    if (existing.status !== 'entwurf') throw new HttpError(409, `Stundenzettel ist „${ZETTEL_STATUS_LABELS[existing.status as ZettelStatus]}“ und gesperrt`);
    await tx`UPDATE stundenzettel SET company_id = ${d.company_id}, period_from = ${d.period_from}, period_to = ${d.period_to}, note = ${d.note ?? null},
             hours_total = ${total}, version = version + 1 WHERE id = ${d.id}`;
    await tx`DELETE FROM stundenzettel_zeile WHERE zettel_id = ${d.id}`;
  } else {
    await tx`INSERT INTO stundenzettel (id, project_id, company_id, period_from, period_to, note, hours_total, created_by, created_at)
             VALUES (${d.id}, ${d.project_id}, ${d.company_id}, ${d.period_from}, ${d.period_to}, ${d.note ?? null}, ${total}, ${userId}, ${meta.occurredAt})`;
  }
  if (d.zeilen.length) {
    await tx`INSERT INTO stundenzettel_zeile ${tx(d.zeilen.map((l, i) => ({
      ...l, von: l.von ?? null, bis: l.bis ?? null, location_id: l.location_id ?? null,
      zettel_id: d.id, project_id: d.project_id, company_id: d.company_id, sort: i,
    })) as never)}`;
  }
  await audit(tx, userId, d.project_id, d.id, existing ? 'geaendert' : 'erstellt', meta, { zeilen: d.zeilen.length, stunden: total });
  return zettelDetails(tx, userId, d.id);
}

export async function attachToZettel(tx: TxSql, userId: string, id: string, file: { bytes: Buffer; name: string }, meta: WriteMeta) {
  const z0 = await load(tx, id);
  const d = await zettelDetails(tx, userId, id);
  if (!d.can_edit) throw new HttpError(409, 'Nur Entwürfe können geändert werden');
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) throw new HttpError(422, 'Anhang: PDF oder Foto');
  await mkdir(DIR, { recursive: true });
  const key = `${id}.${ext}`;
  await writeFile(DIR + key, file.bytes);
  await tx`UPDATE stundenzettel SET attachment_key = ${key}, version = version + 1 WHERE id = ${id}`;
  await audit(tx, userId, z0.project_id, id, 'anhang', meta, { file: file.name });
  return { ok: true };
}

export async function zettelAttachment(tx: TxSql, id: string) {
  const z0 = await load(tx, id);
  if (!z0.attachment_key) throw new HttpError(404, 'Kein Anhang');
  const key = (z0.attachment_key as string).replace(/[^a-z0-9._-]/gi, '');
  return { pfad: DIR + key, type: key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

/** Submit: number assigned, locked for the submitter. */
export async function submitZettel(tx: TxSql, userId: string, id: string, baseVersion: number, meta: WriteMeta) {
  const z0 = await load(tx, id);
  const d = await zettelDetails(tx, userId, id);
  if (!d.can_edit) throw new HttpError(409, 'Dieser Stundenzettel kann nicht eingereicht werden');
  if (z0.version !== baseVersion) throw new HttpError(409, 'Der Stundenzettel wurde inzwischen geändert');
  if (!d.zeilen.length && !z0.attachment_key) throw new HttpError(422, 'Bitte Stunden eintragen oder den Papierzettel anhängen');
  const [{ n }] = (await tx`SELECT app.next_counter(${z0.project_id}, 'stundenzettel') AS n`) as unknown as [{ n: number }];
  const [row] = await tx`
    UPDATE stundenzettel SET status = 'eingereicht', number = ${n}, submitted_by = ${userId}, submitted_at = now(), version = version + 1
    WHERE id = ${id} AND version = ${baseVersion} AND status = 'entwurf' RETURNING *`;
  if (!row) throw new HttpError(409, 'Gleichzeitige Änderung');
  await audit(tx, userId, z0.project_id, id, 'eingereicht', meta, { number: n, stunden: z0.hours_total });
  return row;
}

export const DecideInput = z.object({
  decision: z.enum(['bestaetigen', 'kuerzen', 'ablehnen']),
  reason: z.string().max(2000).optional(),
  /** For "kuerzen": recognised hours per line (only the cut lines). */
  zeilen: z.array(z.object({ id: z.string().uuid(), stunden_anerkannt: z.number().min(0).max(24) })).optional(),
  base_version: z.number().int(),
});

/** Leitung decides. Cutting or rejecting needs a reason (the submitter sees it). */
export async function decideZettel(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = DecideInput.parse(input);
  const z0 = await load(tx, id);
  const actor = await actorFor(tx, userId, z0.project_id);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Stunden bestätigen dürfen Bau- und Projektleitung');
  if (z0.status !== 'eingereicht') throw new HttpError(409, `Stundenzettel ist „${ZETTEL_STATUS_LABELS[z0.status]}“`);
  if (z0.version !== d.base_version) throw new HttpError(409, 'Der Stundenzettel wurde inzwischen geändert');
  if (d.decision !== 'bestaetigen' && !d.reason?.trim()) throw new HttpError(422, 'Bitte eine Begründung angeben');
  let approved = Number(z0.hours_total);
  if (d.decision === 'kuerzen') {
    if (!d.zeilen?.length) throw new HttpError(422, 'Welche Zeilen werden gekürzt?');
    for (const l of d.zeilen) {
      const [cur] = await tx`SELECT stunden FROM stundenzettel_zeile WHERE id = ${l.id} AND zettel_id = ${id}`;
      if (!cur) throw new HttpError(422, 'Zeile gehört nicht zu diesem Stundenzettel');
      if (l.stunden_anerkannt > Number(cur.stunden)) throw new HttpError(422, 'Anerkannte Stunden dürfen die eingereichten nicht übersteigen');
      await tx`UPDATE stundenzettel_zeile SET stunden_anerkannt = ${l.stunden_anerkannt} WHERE id = ${l.id}`;
    }
    const [{ s }] = (await tx`SELECT coalesce(sum(coalesce(stunden_anerkannt, stunden)), 0)::float AS s FROM stundenzettel_zeile WHERE zettel_id = ${id}`) as unknown as [{ s: number }];
    approved = s;
  }
  if (d.decision === 'ablehnen') approved = 0;
  const status = d.decision === 'bestaetigen' ? 'bestaetigt' : d.decision === 'kuerzen' ? 'gekuerzt' : 'abgelehnt';
  const [row] = await tx`
    UPDATE stundenzettel SET status = ${status}, hours_approved = ${approved}, decision_reason = ${d.reason ?? null},
      decided_by = ${userId}, decided_at = now(), version = version + 1
    WHERE id = ${id} AND version = ${d.base_version} RETURNING *`;
  if (!row) throw new HttpError(409, 'Gleichzeitige Änderung');
  await audit(tx, userId, z0.project_id, id, status, meta, { stunden: z0.hours_total, anerkannt: approved, reason: d.reason ?? null, number: stundenzettelNo(z0.number) });
  return row;
}
