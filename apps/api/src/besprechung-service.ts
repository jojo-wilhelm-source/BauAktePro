/**
 * NU-Besprechung (docs/fachkonzept/09): meeting with Punkte that live across meetings.
 * Rights: Bauleitung and Polier keep the protocol, only Bauleitung sends (ANNAHME); NU sees sent ones only (RLS).
 * Writes come from the web app and from the iPad upload queue (offline), so every write is idempotent
 * or version-checked and rejections are recorded as sync_conflict instead of thrown.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import type { TxSql } from '@bap/db';
import {
  anwesendLabel,
  BesprechungCreate,
  BesprechungPatch,
  besprechungIcs,
  besprechungNo,
  carriesOver,
  escalation,
  formatDate,
  isPlausibleSignature,
  PunktCreate,
  Signature,
  PunktPatch,
  PUNKT_STATUS_LABELS,
  type MangelStatus,
  type Priority,
  type PunktStatus,
} from '@bap/domain';
import { renderProtokoll, type ProtokollData } from './besprechung-pdf';
import { sendMail } from './mailer';
import { WEB_URL } from './anmeldung';
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
    SELECT b.id, b.number, b.kind, b.title, b.held_at, b.place, b.status, b.sent_at, b.previous_id, b.version, b.next_at,
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
    SELECT c.id, c.name, c.kind, c.email, t.anwesend FROM besprechung_teilnehmer t JOIN company c ON c.id = t.company_id
    WHERE t.besprechung_id = ${id} ORDER BY c.kind, c.name`;
  const punkte = await tx`
    SELECT p.*, e.carried, e.status_snapshot, e.text_snapshot, l.name AS location_name, l.sort AS location_sort, g.name AS gewerk_name,
           rc.name AS responsible_name,
           (SELECT coalesce(array_agg(c.name ORDER BY c.name), '{}') FROM company c WHERE c.id = ANY (p.support_company_ids)) AS support_names
    FROM besprechung_eintrag e JOIN besprechung_punkt p ON p.id = e.punkt_id
    LEFT JOIN location l ON l.id = p.location_id LEFT JOIN gewerk g ON g.id = p.gewerk_id LEFT JOIN company rc ON rc.id = p.responsible_company_id
    WHERE e.besprechung_id = ${id} ORDER BY l.sort NULLS FIRST, p.number NULLS LAST`;
  const fotos = punkte.length ? await tx`SELECT id, punkt_id, caption FROM besprechung_punkt_foto WHERE punkt_id IN ${tx(punkte.map((p) => p.id as string))} ORDER BY created_at` : [];
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
    bemerkung: row.bemerkung as string | null, next_at: row.next_at as Date | string | null,
    teilnehmer, maengel, can_edit: internal && b.status === 'entwurf', can_send: actor.role === 'bauleitung' && b.status === 'entwurf',
    // NU: own Punkte are highlighted; the others of the meeting are visible too (decided 12.11.2026).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    punkte: (punkte as unknown as Record<string, any>[]).map((p): Record<string, any> => ({ ...p, mine: actor.role === 'nu' && (p.responsible_company_id === actor.companyId || ((p.support_company_ids as string[]) ?? []).includes(actor.companyId)),
      fotos: fotos.filter((f) => f.punkt_id === p.id).map((f) => ({ id: f.id, caption: f.caption })) })),
    can_release: actor.role === 'bauleitung' && b.status === 'versendet',
    can_countersign: actor.role === 'bauherr' && !!row.bauherr_freigabe && !row.bauherr_signed_at };
}

export async function setTeilnehmer(tx: TxSql, userId: string, id: string, companyIds: string[], meta: WriteMeta) {
  const b = await loadBesprechung(tx, id);
  await requireInternal(tx, userId, b.project_id);
  if (b.status !== 'entwurf') throw new HttpError(409, 'Versendete Besprechungen sind gesperrt');
  // Only remove/add the difference so recorded attendance of remaining companies is kept.
  if (companyIds.length) await tx`DELETE FROM besprechung_teilnehmer WHERE besprechung_id = ${id} AND company_id NOT IN ${tx(companyIds)}`;
  else await tx`DELETE FROM besprechung_teilnehmer WHERE besprechung_id = ${id}`;
  const have = new Set((await tx`SELECT company_id FROM besprechung_teilnehmer WHERE besprechung_id = ${id}`).map((r) => r.company_id as string));
  const add = companyIds.filter((c) => !have.has(c));
  if (add.length) await tx`INSERT INTO besprechung_teilnehmer ${tx(add.map((company_id) => ({ besprechung_id: id, project_id: b.project_id, company_id })))}`;
  await audit(tx, userId, b.project_id, 'besprechung', id, 'teilnehmer', meta, { companies: companyIds });
}

/** Attendance of one participating company (draft only, Bauleitung/Polier). */
export async function setAnwesenheit(tx: TxSql, userId: string, id: string, companyId: string, anwesend: boolean | null, meta: WriteMeta) {
  const b = await loadBesprechung(tx, id);
  await requireInternal(tx, userId, b.project_id);
  if (b.status !== 'entwurf') throw new HttpError(409, 'Versendete Besprechungen sind gesperrt');
  const rows = await tx`UPDATE besprechung_teilnehmer SET anwesend = ${anwesend} WHERE besprechung_id = ${id} AND company_id = ${companyId} RETURNING company_id`;
  if (!rows.length) throw new HttpError(404, 'Firma nimmt an dieser Besprechung nicht teil');
  await audit(tx, userId, b.project_id, 'besprechung', id, 'anwesenheit', meta, { company: companyId, anwesend });
}

/** Header of a draft: title, date, place, remarks, next date. Version-checked, sent protocols are locked. */
export async function patchBesprechung(tx: TxSql, userId: string, id: string, baseVersion: number, input: unknown, meta: WriteMeta) {
  const b = await loadBesprechung(tx, id);
  await requireInternal(tx, userId, b.project_id);
  if (b.status !== 'entwurf') throw new HttpError(409, 'Versendete Besprechungen sind gesperrt');
  const patch = BesprechungPatch.parse(input);
  if (!Object.keys(patch).length) return b;
  const [row] = await tx`UPDATE besprechung SET ${tx(patch as never)}, version = version + 1 WHERE id = ${id} AND version = ${baseVersion} AND status = 'entwurf' RETURNING *`;
  if (!row) throw new HttpError(409, 'Die Besprechung wurde inzwischen geändert – bitte neu laden');
  await audit(tx, userId, b.project_id, 'besprechung', id, 'geaendert', meta, { ...patch, base_version: baseVersion });
  return row;
}

/** Calendar file for the next meeting (iPhone / Outlook). */
export async function nextTerminIcs(tx: TxSql, userId: string, id: string) {
  const b = await loadBesprechung(tx, id);
  await actorFor(tx, userId, b.project_id);
  const row = b as Record<string, unknown>;
  if (!row.next_at) throw new HttpError(404, 'Kein nächster Termin festgelegt');
  const [p] = await tx`SELECT name FROM project WHERE id = ${b.project_id}`;
  return besprechungIcs({
    uid: `${id}-next`, title: `${row.title as string} – ${p!.name as string}`, start: new Date(row.next_at as string),
    place: row.place as string | null, description: `Folgetermin zu ${row.title as string} ${besprechungNo(b.number)}`,
  });
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

async function protokollData(tx: TxSql, userId: string, id: string, draft: boolean, companyId?: string, highlight?: string): Promise<ProtokollData> {
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
    teilnehmer: d.teilnehmer.map((t) => (t.anwesend == null ? (t.name as string) : `${t.name as string} (${anwesendLabel(t.anwesend as boolean)})`)),
    bemerkung: (d.bemerkung as string | null) ?? null,
    nextAt: d.next_at ? `${formatDate(new Date(d.next_at as string).toISOString())} ${new Date(d.next_at as string).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr` : null,
    punkte: await Promise.all(punkte.map(async (p) => ({
      mine: !!highlight && (p.responsible_company_id === highlight || ((p.support_company_ids as string[]) ?? []).includes(highlight)),
      fotos: await punktFotos(tx, p.id as string),
      number: p.number as number,
      group: (p.location_name as string) ?? 'Allgemein',
      gewerk: (p.gewerk_name as string) ?? null,
      text: draft ? (p.text as string) : ((p.text_snapshot as string) ?? (p.text as string)),
      responsible: (p.responsible_name as string) ?? null,
      support: (p.support_names as string[]) ?? [],
      due: iso(p.due_date),
      status: (draft ? p.status : (p.status_snapshot ?? p.status)) as PunktStatus,
      carried: !!p.carried,
    }))),
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
  // A NU gets the whole (non-internal) protocol with his own Punkte highlighted, or his list.
  if (actor.role === 'nu') return renderProtokoll(await protokollData(tx, userId, id, false, companyId ? actor.companyId : undefined, actor.companyId));
  return renderProtokoll(await protokollData(tx, userId, id, b.status === 'entwurf', companyId));
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
    const marked = await renderProtokoll(await protokollData(tx, userId, id, false, undefined, t.id as string));
    const res = await sendMail({
      from: process.env.MAIL_FROM ?? 'Bau Akte Pro <noreply@bauaktepro.example.test>',
      to: t.email as string,
      subject: `${data.title} – ${data.subtitle}`,
      text:
        `Sehr geehrte Damen und Herren,\n\nein neues Protokoll ist online: ${data.title}. Anbei das Protokoll – Ihre Punkte sind gelb hervorgehoben – sowie Ihre persönliche Aufgabenliste.\n` +
        `Im Portal: ${WEB_URL}\n` +
        `Einwände gegen das Protokoll bitte innerhalb von 7 Tagen (ANNAHME, offene-punkte C2).\n\nMit freundlichen Grüßen\n${signer?.name ?? ''}\n${data.ownCompany}`,
      attachments: [
        { filename: `Protokoll-${besprechungNo(b.number).replace(/\W+/g, '')}.pdf`, content: t.kind === 'nu' ? marked : pdf },
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

const FOTO_DIR = fileURLToPath(new URL('../../../storage/besprechung/', import.meta.url));

async function punktFotos(tx: TxSql, punktId: string) {
  const rows = await tx`SELECT file_key FROM besprechung_punkt_foto WHERE punkt_id = ${punktId} ORDER BY created_at LIMIT 4`;
  const out: { bytes: Uint8Array; png: boolean }[] = [];
  for (const r of rows) {
    const key = (r.file_key as string).replace(/[^a-z0-9._-]/gi, '');
    try { out.push({ bytes: await readFile(FOTO_DIR + key), png: key.endsWith('.png') }); } catch { /* file missing */ }
  }
  return out;
}

/** Photo on a Punkt (internal roles; also in a follow-up meeting). */
export async function addPunktFoto(tx: TxSql, userId: string, punktId: string, file: { bytes: Buffer; name: string }, caption: string | null, id?: string) {
  const [p] = await tx`SELECT id, project_id FROM besprechung_punkt WHERE id = ${punktId}`;
  if (!p) throw new HttpError(404, 'Punkt nicht gefunden');
  await requireInternal(tx, userId, p.project_id as string);
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  if (!['jpg', 'png'].includes(ext)) throw new HttpError(422, 'Bitte ein Foto (JPG oder PNG)');
  const fid = id ?? randomUUID();
  const [dup] = await tx`SELECT id FROM besprechung_punkt_foto WHERE id = ${fid}`;
  if (dup) return { id: fid };
  await mkdir(FOTO_DIR, { recursive: true });
  await writeFile(`${FOTO_DIR}${fid}.${ext}`, file.bytes);
  await tx`INSERT INTO besprechung_punkt_foto (id, punkt_id, project_id, file_key, caption, created_by) VALUES (${fid}, ${punktId}, ${p.project_id}, ${`${fid}.${ext}`}, ${caption}, ${userId})`;
  return { id: fid };
}

export async function punktFotoFile(tx: TxSql, id: string) {
  const [f] = await tx`SELECT file_key FROM besprechung_punkt_foto WHERE id = ${id}`; // RLS
  if (!f) throw new HttpError(404, 'Foto nicht gefunden');
  const key = (f.file_key as string).replace(/[^a-z0-9._-]/gi, '');
  return { bytes: await readFile(FOTO_DIR + key), type: key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

/** Release the sent protocol to the Bauherr (or take it back); the Bauherr company gets a mail. */
export async function bauherrFreigabe(tx: TxSql, userId: string, id: string, freigabe: boolean, meta: WriteMeta) {
  const b = await loadBesprechung(tx, id);
  const actor = await actorFor(tx, userId, b.project_id);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Freigeben darf die Bau- oder Projektleitung');
  if (b.status !== 'versendet') throw new HttpError(409, 'Erst versenden, dann für den Bauherrn freigeben');
  const [r] = await tx`SELECT app.besprechung_freigabe(${id}, ${freigabe}) AS ok`;
  const row = r?.ok ? await loadBesprechung(tx, id) : null;
  if (!row) throw new HttpError(409, 'Bereits vom Bauherrn gegengezeichnet – Freigabe bleibt');
  await audit(tx, userId, b.project_id, 'besprechung', id, freigabe ? 'bauherr_freigegeben' : 'bauherr_freigabe_zurueck', meta, { number: b.number });
  if (freigabe) {
    const bauherren = await tx`SELECT DISTINCT c.email, c.name FROM company c JOIN project_member pm ON pm.company_id = c.id WHERE pm.project_id = ${b.project_id} AND pm.role = 'bauherr' AND c.email IS NOT NULL`;
    for (const c of bauherren) {
      await sendMail({ from: process.env.MAIL_FROM ?? 'Bau Akte Pro <noreply@bauaktepro.example.test>', to: c.email as string,
        subject: `Protokoll zur Ansicht freigegeben: ${(row.title as string)} ${besprechungNo(b.number)}`,
        text: `Sehr geehrte Damen und Herren,\n\ndas Protokoll „${row.title as string} ${besprechungNo(b.number)}“ ist für Sie freigegeben. Sie können es im Portal ansehen und gegenzeichnen:\n${WEB_URL}\n`, attachments: [] });
    }
  }
  return row;
}

/** Countersignature of the Bauherr on a released protocol (documentation; legal effect see offene-punkte C1). */
export async function bauherrGegenzeichnen(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const { signature } = z.object({ signature: Signature }).parse(input);
  if (!isPlausibleSignature(signature)) throw new HttpError(422, 'Bitte richtig unterschreiben');
  const b = await loadBesprechung(tx, id);
  const [r] = await tx`SELECT app.besprechung_gegenzeichnen(${id}, ${tx.json(signature as never)}) AS ok`;
  if (!r?.ok) throw new HttpError(409, 'Gegenzeichnen nicht möglich (nicht freigegeben oder schon gegengezeichnet)');
  await audit(tx, userId, b.project_id, 'besprechung', id, 'bauherr_gegengezeichnet', meta, { number: b.number });
  return { ok: true };
}
