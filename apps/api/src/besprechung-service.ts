/**
 * NU-Besprechung (docs/fachkonzept/09): meeting with Punkte that live across meetings.
 * Rights: Bauleitung and Polier keep the protocol, only Bauleitung sends (ANNAHME); NU sees sent ones only (RLS).
 * Writes come from the web app and from the iPad upload queue (offline), so every write is idempotent
 * or version-checked and rejections are recorded as sync_conflict instead of thrown.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TxSql } from '@bap/db';
import {
  BesprechungCreate,
  besprechungNo,
  carriesOver,
  escalation,
  formatDate,
  PunktCreate,
  PunktPatch,
  PUNKT_STATUS_LABELS,
  type MangelStatus,
  type Priority,
  type PunktStatus,
} from '@bap/domain';
import { renderProtokoll, type ProtokollData } from './besprechung-pdf';
import { sendMail } from './mailer';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const DIR = fileURLToPath(new URL('../../../storage/protokolle/', import.meta.url));

async function audit(tx: TxSql, userId: string, projectId: string, entity: string, entityId: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, ${entity}, ${entityId}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

async function requireInternal(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  if (actor.role !== 'bauleitung' && actor.role !== 'polier') throw new HttpError(403, 'Besprechungen führen Bauleitung und Polier');
  return actor;
}

async function loadBesprechung(tx: TxSql, id: string) {
  const [b] = await tx`SELECT * FROM besprechung WHERE id = ${id}`; // RLS
  if (!b) throw new HttpError(404, 'Besprechung nicht gefunden');
  return b as Record<string, unknown> & { id: string; project_id: string; status: 'entwurf' | 'versendet'; version: number; number: number };
}

export async function createBesprechung(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = BesprechungCreate.parse(input);
  await requireInternal(tx, userId, d.project_id);
  const [existing] = await tx`SELECT id FROM besprechung WHERE id = ${d.id}`;
  if (existing) return loadBesprechung(tx, d.id);
  const [p] = await tx`SELECT tenant_id FROM project WHERE id = ${d.project_id}`;
  const [{ n }] = (await tx`SELECT app.next_counter(${d.project_id}, 'besprechung') AS n`) as unknown as [{ n: number }];

  let companies = d.company_ids;
  let carry: { punkt_id: string }[] = [];
  if (d.previous_id) {
    const prev = await loadBesprechung(tx, d.previous_id);
    if (prev.project_id !== d.project_id) throw new HttpError(422, 'Vorige Besprechung gehört zu einem anderen Projekt');
    if (!companies.length) companies = (await tx`SELECT company_id FROM besprechung_teilnehmer WHERE besprechung_id = ${d.previous_id}`).map((r) => r.company_id as string);
    // Carry over by the CURRENT status of each Punkt (it may have changed between the meetings).
    const rows = await tx`SELECT p.id, p.status FROM besprechung_eintrag e JOIN besprechung_punkt p ON p.id = e.punkt_id WHERE e.besprechung_id = ${d.previous_id}`;
    carry = rows.filter((r) => carriesOver(r.status as PunktStatus)).map((r) => ({ punkt_id: r.id as string }));
  }
  await tx`INSERT INTO besprechung ${tx({
    id: d.id, tenant_id: p!.tenant_id, project_id: d.project_id, number: n, kind: d.kind, title: d.title, held_at: d.held_at,
    place: d.place ?? null, previous_id: d.previous_id ?? null, created_by: userId, created_at: meta.occurredAt,
  } as never)}`;
  if (companies.length) {
    await tx`INSERT INTO besprechung_teilnehmer ${tx(companies.map((company_id) => ({ besprechung_id: d.id, project_id: d.project_id, company_id })))}`;
  }
  if (carry.length) {
    await tx`INSERT INTO besprechung_eintrag ${tx(carry.map((c) => ({ besprechung_id: d.id, punkt_id: c.punkt_id, project_id: d.project_id, carried: true })))}`;
  }
  await audit(tx, userId, d.project_id, 'besprechung', d.id, 'erstellt', meta, { number: n, carried: carry.length, previous: d.previous_id ?? null });
  return loadBesprechung(tx, d.id);
}

export async function listBesprechungen(tx: TxSql, userId: string, projectId: string) {
  await actorFor(tx, userId, projectId);
  return tx`
    SELECT b.id, b.number, b.kind, b.title, b.held_at, b.place, b.status, b.sent_at, b.previous_id, b.version,
      (SELECT count(*)::int FROM besprechung_eintrag e WHERE e.besprechung_id = b.id) AS punkte,
      (SELECT count(*)::int FROM besprechung_eintrag e JOIN besprechung_punkt p ON p.id = e.punkt_id
         WHERE e.besprechung_id = b.id AND p.status IN ('offen', 'in_arbeit')) AS offen,
      EXISTS (SELECT 1 FROM besprechung n WHERE n.previous_id = b.id) AS has_next
    FROM besprechung b WHERE b.project_id = ${projectId} ORDER BY b.held_at DESC`;
}

/** Meeting with participants, Punkte (current state + snapshot when sent) and overdue Mängel of the participating NU. */
export async function besprechungDetails(tx: TxSql, userId: string, id: string) {
  const b = await loadBesprechung(tx, id);
  const actor = await actorFor(tx, userId, b.project_id);
  const internal = actor.role === 'bauleitung' || actor.role === 'polier';
  const teilnehmer = await tx`
    SELECT c.id, c.name, c.kind, c.email FROM besprechung_teilnehmer t JOIN company c ON c.id = t.company_id
    WHERE t.besprechung_id = ${id} ORDER BY c.kind, c.name`;
  const punkte = await tx`
    SELECT p.*, e.carried, e.status_snapshot, e.text_snapshot, l.name AS location_name, l.sort AS location_sort, g.name AS gewerk_name,
           rc.name AS responsible_name,
           (SELECT coalesce(array_agg(c.name ORDER BY c.name), '{}') FROM company c WHERE c.id = ANY (p.support_company_ids)) AS support_names
    FROM besprechung_eintrag e JOIN besprechung_punkt p ON p.id = e.punkt_id
    LEFT JOIN location l ON l.id = p.location_id LEFT JOIN gewerk g ON g.id = p.gewerk_id LEFT JOIN company rc ON rc.id = p.responsible_company_id
    WHERE e.besprechung_id = ${id} ORDER BY l.sort NULLS FIRST, p.number NULLS LAST`;
  const nuIds = teilnehmer.filter((t) => t.kind === 'nu').map((t) => t.id as string);
  const maengelRows = nuIds.length && internal
    ? await tx`
        SELECT m.id, m.number, m.description, m.status, m.priority, m.due_date, m.nachfrist_date, c.name AS company_name
        FROM mangel m JOIN company c ON c.id = m.assigned_company_id
        WHERE m.project_id = ${b.project_id} AND m.deleted_at IS NULL AND m.assignment_confirmed AND m.assigned_company_id IN ${tx(nuIds)}`
    : [];
  const maengel = (maengelRows as Record<string, unknown>[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m): Record<string, any> & { escalation: ReturnType<typeof escalation> } => ({ ...m, escalation: escalation({ status: m.status as MangelStatus, due_date: iso(m.due_date), nachfrist_date: iso(m.nachfrist_date), priority: m.priority as Priority }) }))
    .filter((m) => m.escalation.ampel === 'rot');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = b;
  return { ...row, id: b.id, project_id: b.project_id, number: b.number, status: b.status, version: b.version,
    title: row.title as string, held_at: row.held_at as Date | string, place: row.place as string | null,
    teilnehmer, punkte, maengel, can_edit: internal && b.status === 'entwurf', can_send: actor.role === 'bauleitung' && b.status === 'entwurf' };
}

export async function setTeilnehmer(tx: TxSql, userId: string, id: string, companyIds: string[], meta: WriteMeta) {
  const b = await loadBesprechung(tx, id);
  await requireInternal(tx, userId, b.project_id);
  if (b.status !== 'entwurf') throw new HttpError(409, 'Versendete Besprechungen sind gesperrt');
  await tx`DELETE FROM besprechung_teilnehmer WHERE besprechung_id = ${id}`;
  if (companyIds.length) await tx`INSERT INTO besprechung_teilnehmer ${tx(companyIds.map((company_id) => ({ besprechung_id: id, project_id: b.project_id, company_id })))}`;
  await audit(tx, userId, b.project_id, 'besprechung', id, 'teilnehmer', meta, { companies: companyIds });
}

export type PunktResult = { ok: true; punkt: Record<string, unknown> } | { ok: false; kind: 'conflict' | 'rejected'; reason: string };

async function problem(tx: TxSql, userId: string, projectId: string, entityId: string, kind: 'conflict' | 'rejected', reason: string, base: number | null, change: object, current: Record<string, unknown> | null): Promise<PunktResult> {
  await tx`
    INSERT INTO sync_conflict (project_id, entity, entity_id, actor_id, base_version, server_version, client_change, server_state, kind, reason)
    VALUES (${projectId}, 'besprechung_punkt', ${entityId}, ${userId}, ${base}, ${(current?.version as number) ?? null}, ${tx.json(change as never)},
            ${current ? tx.json(current as never) : null}, ${kind}, ${reason})`;
  return { ok: false, kind, reason };
}

/** New Punkt in a draft meeting. Idempotent (offline retries). Number assigned by the server. */
export async function addPunkt(tx: TxSql, userId: string, input: unknown, meta: WriteMeta): Promise<PunktResult> {
  const d = PunktCreate.parse(input);
  const b = await loadBesprechung(tx, d.besprechung_id);
  await requireInternal(tx, userId, b.project_id);
  const [existing] = await tx`SELECT * FROM besprechung_punkt WHERE id = ${d.id}`;
  if (existing) return { ok: true, punkt: existing };
  if (b.status !== 'entwurf') return problem(tx, userId, b.project_id, d.id, 'rejected', `Besprechung ${besprechungNo(b.number)} ist bereits versendet – Punkt bitte in der Folgesitzung anlegen`, null, d, null);
  const [{ n }] = (await tx`SELECT app.next_counter(${b.project_id}, 'punkt') AS n`) as unknown as [{ n: number }];
  const { besprechung_id, ...fields } = d;
  const [row] = await tx`INSERT INTO besprechung_punkt ${tx({
    ...fields, location_id: fields.location_id ?? null, gewerk_id: fields.gewerk_id ?? null, responsible_company_id: fields.responsible_company_id ?? null,
    due_date: fields.due_date ?? null, project_id: b.project_id, number: n, first_besprechung_id: besprechung_id, created_by: userId, created_at: meta.occurredAt,
  } as never)} RETURNING *`;
  await tx`INSERT INTO besprechung_eintrag (besprechung_id, punkt_id, project_id, carried) VALUES (${besprechung_id}, ${d.id}, ${b.project_id}, false)`;
  await audit(tx, userId, b.project_id, 'besprechung_punkt', d.id, 'erstellt', meta, { number: n, besprechung: besprechung_id });
  return { ok: true, punkt: row! };
}

/** Edit / status change. Version-checked: an offline change based on an old state never overwrites silently. */
export async function patchPunkt(tx: TxSql, userId: string, id: string, baseVersion: number, input: unknown, meta: WriteMeta): Promise<PunktResult> {
  const [current] = await tx`SELECT * FROM besprechung_punkt WHERE id = ${id}`;
  if (!current) throw new HttpError(404, 'Punkt nicht gefunden');
  await requireInternal(tx, userId, current.project_id as string);
  const patch = PunktPatch.parse(input);
  if (current.version !== baseVersion) {
    const what = patch.status ? `Status „${PUNKT_STATUS_LABELS[patch.status]}“` : 'Änderung';
    return problem(tx, userId, current.project_id as string, id, 'conflict',
      `${what} für Punkt P-${String(current.number).padStart(3, '0')} nicht übernommen: inzwischen geändert (jetzt „${PUNKT_STATUS_LABELS[current.status as PunktStatus]}“).`, baseVersion, patch, current);
  }
  const [row] = await tx`
    UPDATE besprechung_punkt SET ${tx(patch as never)}, version = version + 1, updated_at = now()
    WHERE id = ${id} AND version = ${baseVersion} RETURNING *`;
  if (!row) return problem(tx, userId, current.project_id as string, id, 'conflict', 'Gleichzeitige Änderung', baseVersion, patch, current);
  await audit(tx, userId, current.project_id as string, 'besprechung_punkt', id, patch.status && patch.status !== current.status ? 'status' : 'geaendert', meta, {
    from: current.status, ...patch, base_version: baseVersion,
  });
  return { ok: true, punkt: row };
}

async function protokollData(tx: TxSql, userId: string, id: string, draft: boolean, companyId?: string): Promise<ProtokollData> {
  const d = await besprechungDetails(tx, userId, id);
  const [ctx] = await tx`
    SELECT p.name AS project, (SELECT c.name FROM company c WHERE c.tenant_id = p.tenant_id AND c.kind = 'own' LIMIT 1) AS own
    FROM project p WHERE p.id = ${d.project_id}`;
  const company = companyId ? d.teilnehmer.find((t) => t.id === companyId) : null;
  const punkte = d.punkte
    .filter((p) => !p.internal)
    .filter((p) => !companyId || p.responsible_company_id === companyId || (p.support_company_ids as string[]).includes(companyId));
  const held = new Date(d.held_at as string);
  return {
    title: company ? `Aufgabenliste ${company.name}` : `${d.title as string} ${besprechungNo(d.number)}`,
    subtitle: `${ctx!.project} · ${formatDate(held.toISOString())} ${held.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr${d.place ? ` · ${d.place}` : ''}`,
    ownCompany: ctx!.own as string,
    draft,
    teilnehmer: d.teilnehmer.map((t) => t.name as string),
    punkte: punkte.map((p) => ({
      number: p.number as number,
      group: (p.location_name as string) ?? 'Allgemein',
      gewerk: (p.gewerk_name as string) ?? null,
      text: draft ? (p.text as string) : ((p.text_snapshot as string) ?? (p.text as string)),
      responsible: (p.responsible_name as string) ?? null,
      support: (p.support_names as string[]) ?? [],
      due: iso(p.due_date),
      status: (draft ? p.status : (p.status_snapshot ?? p.status)) as PunktStatus,
      carried: !!p.carried,
    })),
    maengel: d.maengel
      .filter((m) => !companyId || m.company_name === company?.name)
      .map((m) => ({ number: m.number as number, description: m.description as string, company: m.company_name as string, due: iso(m.nachfrist_date ?? m.due_date), label: m.escalation.label })),
    footer: `${d.title as string} ${besprechungNo(d.number)} · ${ctx!.project}`,
  };
}

/** Protocol (or a NU's personal list) as PDF. Sent protocols are served from the stored file. */
export async function protokollPdf(tx: TxSql, userId: string, id: string, companyId?: string) {
  const b = await loadBesprechung(tx, id);
  const actor = await actorFor(tx, userId, b.project_id);
  // A NU only ever gets its own list.
  const forCompany = actor.role === 'nu' ? actor.companyId : companyId;
  return renderProtokoll(await protokollData(tx, userId, id, b.status === 'entwurf', forCompany));
}

/**
 * Send: freeze the snapshot, publish non-internal Punkte to the NU, store the PDF, mail every participating
 * company the protocol plus its personal task list. The mails go out last; an error rolls everything back.
 */
export async function sendBesprechung(tx: TxSql, userId: string, id: string, baseVersion: number, meta: WriteMeta) {
  const b = await loadBesprechung(tx, id);
  const actor = await actorFor(tx, userId, b.project_id);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Protokolle versendet nur die Bauleitung');
  if (b.status !== 'entwurf') throw new HttpError(409, 'Dieses Protokoll wurde bereits versendet');
  if (b.version !== baseVersion) throw new HttpError(409, 'Die Besprechung wurde inzwischen geändert');

  await tx`
    UPDATE besprechung_eintrag e SET status_snapshot = p.status, text_snapshot = p.text
    FROM besprechung_punkt p WHERE p.id = e.punkt_id AND e.besprechung_id = ${id}`;
  await tx`
    UPDATE besprechung_punkt p SET published = true
    FROM besprechung_eintrag e WHERE e.punkt_id = p.id AND e.besprechung_id = ${id} AND NOT p.internal AND NOT p.published`;
  const data = await protokollData(tx, userId, id, false);
  const pdf = await renderProtokoll(data);
  await mkdir(DIR, { recursive: true });
  await writeFile(`${DIR}${id}.pdf`, pdf);
  const [sent] = await tx`
    UPDATE besprechung SET status = 'versendet', sent_at = now(), sent_by = ${userId}, file_key = ${`${id}.pdf`}, version = version + 1
    WHERE id = ${id} AND version = ${baseVersion} AND status = 'entwurf' RETURNING *`;
  if (!sent) throw new HttpError(409, 'Gleichzeitige Änderung');

  const details = await besprechungDetails(tx, userId, id);
  const [signer] = await tx`SELECT name FROM app_user WHERE id = ${userId}`;
  const mails: { company: string; to: string; devFile?: string }[] = [];
  const skipped: string[] = [];
  for (const t of details.teilnehmer.filter((x) => x.kind !== 'own')) {
    if (!t.email) {
      skipped.push(t.name as string);
      continue;
    }
    const own = await renderProtokoll(await protokollData(tx, userId, id, false, t.id as string));
    const res = await sendMail({
      from: process.env.MAIL_FROM ?? 'Bau Akte Pro <noreply@bauaktepro.example.test>',
      to: t.email as string,
      subject: `${data.title} – ${data.subtitle}`,
      text:
        `Sehr geehrte Damen und Herren,\n\nanbei das Protokoll der ${data.title} sowie Ihre persönliche Aufgabenliste.\n` +
        `Einwände gegen das Protokoll bitte innerhalb von 7 Tagen (ANNAHME, offene-punkte C2).\n\nMit freundlichen Grüßen\n${signer?.name ?? ''}\n${data.ownCompany}`,
      attachments: [
        { filename: `Protokoll-${besprechungNo(b.number).replace(/\W+/g, '')}.pdf`, content: pdf },
        { filename: `Aufgaben-${(t.name as string).replace(/\W+/g, '_')}.pdf`, content: own },
      ],
    });
    mails.push({ company: t.name as string, to: t.email as string, devFile: res.devFile });
  }
  await audit(tx, userId, b.project_id, 'besprechung', id, 'versendet', meta, { number: b.number, mails: mails.map((m) => m.to), skipped });
  return { ...sent, mails, skipped };
}

function iso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
