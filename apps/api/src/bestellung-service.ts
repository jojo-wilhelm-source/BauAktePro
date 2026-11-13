/**
 * Bestellanforderungen (docs/fachkonzept/12, decided 12.11.2026) and notifications (docs/fachkonzept/04).
 * Polier, Bau- and Projektleitung request material or services from the site (also offline in the app); the
 * Einkauf sees all its sites in the Einkaufsportal, makes an LV / request from it, orders and marks the delivery.
 * Everyone affected gets a notification in the app and a mail.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { BANF_LABEL, BANF_STATUS, BanfInput, banfTransition, type BanfStatus } from '@bap/domain';
import { WEB_URL } from './anmeldung';
import { sendMail } from './mailer';
import { ladeEinstellungen } from './system-service';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const FROM = () => process.env.MAIL_FROM ?? 'Bau Akte Pro <noreply@bauaktepro.example.test>';

async function audit(tx: TxSql, userId: string, projectId: string, id: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'bestellanforderung', ${id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

// --- Notifications --------------------------------------------------------------------------------

export interface Nachricht { art: string; titel: string; text?: string | null; entity?: string | null; entityId?: string | null; mailArt?: 'bestellung_mail' | 'status_mail' }

/**
 * Notify users of a project: in-app (always) and by mail (optional). The DB function checks that recipients are
 * members of the project and the sender is one too. The sender himself is never notified.
 */
export async function benachrichtigen(tx: TxSql, userId: string, projectId: string | null, empfaenger: string[], n: Nachricht, mail = true) {
  const ids = [...new Set(empfaenger)].filter((u) => u !== userId);
  if (!ids.length) return 0;
  let count = 0;
  for (const u of ids) {
    const [r] = await tx`SELECT app.benachrichtigen(${u}, ${projectId}, ${n.art}, ${n.titel}, ${n.text ?? null}, ${n.entity ?? null}, ${n.entityId ?? null}) AS ok`;
    if (r?.ok) count++;
  }
  // The administrator can switch mails off per kind (settings); the in-app notification always stays.
  if (mail && n.mailArt && !(await ladeEinstellungen(tx)).benachrichtigung[n.mailArt]) mail = false;
  if (mail) {
    const users = await tx`SELECT email, name FROM app_user WHERE id IN ${tx(ids)} AND active`; // RLS: co-members only
    const [p] = projectId ? await tx`SELECT name FROM project WHERE id = ${projectId}` : [];
    for (const u of users) {
      await sendMail({
        from: FROM(), to: u.email as string, subject: `${p ? `${p.name as string}: ` : ''}${n.titel}`,
        text: `Hallo ${u.name as string},\n\n${n.titel}${n.text ? `\n\n${n.text}` : ''}\n\nIn Bau Akte Pro öffnen: ${WEB_URL}\n\n(Benachrichtigungen lassen sich in der App unter „Mitteilungen“ ansehen.)`,
        attachments: [],
      });
    }
  }
  return count;
}

export async function listNachrichten(tx: TxSql, userId: string) {
  const rows = await tx`
    SELECT b.id, b.project_id, p.name AS project, b.art, b.titel, b.text, b.entity, b.entity_id, b.created_at, b.read_at, u.name AS von
    FROM benachrichtigung b LEFT JOIN project p ON p.id = b.project_id LEFT JOIN app_user u ON u.id = b.von_id
    WHERE b.user_id = ${userId} ORDER BY b.created_at DESC LIMIT 100`;
  const [c] = await tx`SELECT count(*)::int AS n FROM benachrichtigung WHERE user_id = ${userId} AND read_at IS NULL`;
  return { ungelesen: (c?.n as number) ?? 0, nachrichten: rows };
}

export async function anzahlUngelesen(tx: TxSql, userId: string) {
  const [c] = await tx`SELECT count(*)::int AS n FROM benachrichtigung WHERE user_id = ${userId} AND read_at IS NULL`;
  return { n: (c?.n as number) ?? 0 };
}

export async function nachrichtGelesen(tx: TxSql, userId: string, id: string | 'alle') {
  if (id === 'alle') await tx`UPDATE benachrichtigung SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL`;
  else await tx`UPDATE benachrichtigung SET read_at = coalesce(read_at, now()) WHERE id = ${id} AND user_id = ${userId}`;
  return { ok: true };
}

// --- Bestellanforderungen -------------------------------------------------------------------------

const SELECT_BANF = (tx: TxSql) => tx`
  b.id, b.project_id, p.name AS project, b.number, b.titel, b.beschreibung, b.positionen, b.location_id, l.name AS ort, b.gewerk_id, g.name AS gewerk,
  b.benoetigt_am::text AS benoetigt_am, b.dringend, b.status, b.bearbeiter_id, be.name AS bearbeiter, b.lv_id, lv.nummer AS lv_nummer, lv.status AS lv_status,
  b.lieferant, b.bestell_nr, b.liefertermin::text AS liefertermin, b.bemerkung_einkauf, b.version, b.created_by, cu.name AS angefordert_von, b.created_at, b.updated_at`;
const FROM_BANF = (tx: TxSql) => tx`
  bestellanforderung b JOIN project p ON p.id = b.project_id LEFT JOIN location l ON l.id = b.location_id LEFT JOIN gewerk g ON g.id = b.gewerk_id
  LEFT JOIN app_user be ON be.id = b.bearbeiter_id LEFT JOIN app_user cu ON cu.id = b.created_by LEFT JOIN lv ON lv.id = b.lv_id`;

/** Requests of one project (internal roles and Einkauf; RLS filters). */
export async function listBanf(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role === 'nu' || a.role === 'bauherr') throw new HttpError(403, 'Bestellanforderungen sind intern');
  return tx`SELECT ${SELECT_BANF(tx)} FROM ${FROM_BANF(tx)} WHERE b.project_id = ${projectId} ORDER BY (b.status IN ('offen', 'in_bearbeitung', 'angefragt')) DESC, b.dringend DESC, b.created_at DESC LIMIT 500`;
}

/** Einkaufsportal: all requests of every site the user does the Einkauf for (or leads), with a summary per site. */
export async function einkaufsportal(tx: TxSql, input: { status?: string }) {
  const [ok] = await tx`SELECT app.is_einkauf_any() AS ok`;
  if (!ok?.ok) throw new HttpError(403, 'Das Einkaufsportal ist für Einkauf und Leitung');
  const offen = input.status !== 'alle';
  const rows = await tx`
    SELECT ${SELECT_BANF(tx)} FROM ${FROM_BANF(tx)}
    WHERE app.is_einkauf_or_leitung(b.project_id) ${offen ? tx`AND b.status IN ('offen', 'in_bearbeitung', 'angefragt', 'bestellt')` : tx``}
    ORDER BY b.dringend DESC, b.benoetigt_am NULLS LAST, b.created_at DESC LIMIT 1000`;
  const baustellen = await tx`
    SELECT p.id, p.name,
      count(b.id) FILTER (WHERE b.status = 'offen')::int AS neu,
      count(b.id) FILTER (WHERE b.status IN ('in_bearbeitung', 'angefragt'))::int AS in_arbeit,
      count(b.id) FILTER (WHERE b.status = 'bestellt')::int AS bestellt,
      count(b.id) FILTER (WHERE b.dringend AND b.status IN ('offen', 'in_bearbeitung', 'angefragt'))::int AS dringend,
      count(b.id) FILTER (WHERE b.benoetigt_am < current_date AND b.status IN ('offen', 'in_bearbeitung', 'angefragt'))::int AS ueberfaellig,
      min(b.benoetigt_am) FILTER (WHERE b.status IN ('offen', 'in_bearbeitung', 'angefragt'))::text AS naechster_bedarf,
      min(b.created_at) FILTER (WHERE b.status = 'offen') AS aelteste_neue,
      max(b.created_at) AS letzte_anforderung
    FROM project p LEFT JOIN bestellanforderung b ON b.project_id = p.id
    WHERE app.is_einkauf_or_leitung(p.id) GROUP BY p.id, p.name
    ORDER BY count(b.id) FILTER (WHERE b.status = 'offen') > 0 DESC, count(b.id) FILTER (WHERE b.dringend AND b.status IN ('offen', 'in_bearbeitung', 'angefragt')) DESC, p.name`;
  return { baustellen, anforderungen: rows };
}

export async function getBanf(tx: TxSql, id: string) {
  const [b] = await tx`SELECT ${SELECT_BANF(tx)} FROM ${FROM_BANF(tx)} WHERE b.id = ${id}`;
  if (!b) throw new HttpError(404, 'Bestellanforderung nicht gefunden');
  return b;
}

/** Users who get new requests of a project: its Einkauf; without Einkauf the Leitung. */
async function einkaeufer(tx: TxSql, projectId: string) {
  const ek = await tx`SELECT user_id FROM project_member WHERE project_id = ${projectId} AND role = 'einkauf'`;
  return ek.map((r) => r.user_id as string);
}
async function leitung(tx: TxSql, projectId: string) {
  const l = await tx`SELECT user_id FROM project_member WHERE project_id = ${projectId} AND role IN ('bauleitung', 'projektleitung')`;
  return l.map((r) => r.user_id as string);
}

/** Create (idempotent by id – the app uploads it again after a lost connection). */
export async function createBanf(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = BanfInput.parse(input);
  const a = await actorFor(tx, userId, d.project_id);
  if (a.role !== 'bauleitung' && a.role !== 'polier' && a.role !== 'einkauf') throw new HttpError(403, 'Bestellanforderungen stellen Polier, Bau- und Projektleitung');
  const [exists] = await tx`SELECT id FROM bestellanforderung WHERE id = ${d.id}`;
  if (exists) return getBanf(tx, d.id);
  const [{ n }] = (await tx`SELECT app.next_counter(${d.project_id}, 'bestellanforderung') AS n`) as unknown as [{ n: number }];
  await tx`INSERT INTO bestellanforderung (id, tenant_id, project_id, number, titel, beschreibung, positionen, location_id, gewerk_id, benoetigt_am, dringend, created_by, created_at)
           SELECT ${d.id}, tenant_id, ${d.project_id}, ${n}, ${d.titel}, ${d.beschreibung ?? null}, ${tx.json(d.positionen as never)}, ${d.location_id ?? null}, ${d.gewerk_id ?? null},
                  ${d.benoetigt_am ?? null}, ${d.dringend}, ${userId}, ${meta.occurredAt} FROM project WHERE id = ${d.project_id}`;
  await audit(tx, userId, d.project_id, d.id, 'angefordert', meta, { titel: d.titel, dringend: d.dringend });
  const [me] = await tx`SELECT name FROM app_user WHERE id = ${userId}`;
  const text = `${me?.name as string} fordert an: ${d.titel}${d.benoetigt_am ? ` (benötigt am ${d.benoetigt_am.split('-').reverse().join('.')})` : ''}` +
    (d.positionen.length ? `\n${d.positionen.map((p) => `· ${p.menge != null ? `${p.menge} ${p.einheit ?? ''} ` : ''}${p.text}`).join('\n')}` : '');
  const ek = await einkaeufer(tx, d.project_id);
  const nachricht = { art: 'bestellanforderung', titel: `${d.dringend ? 'DRINGEND: ' : ''}Bestellanforderung Nr. ${n}: ${d.titel}`, text, entity: 'bestellanforderung', entityId: d.id, mailArt: 'bestellung_mail' as const };
  // Einkauf by app + mail; the Leitung sees it in the app (mail only if there is no Einkauf on this site).
  await benachrichtigen(tx, userId, d.project_id, ek.length ? ek : await leitung(tx, d.project_id), nachricht, true);
  if (ek.length) await benachrichtigen(tx, userId, d.project_id, await leitung(tx, d.project_id), nachricht, false);
  return getBanf(tx, d.id);
}

const BanfEdit = BanfInput.omit({ id: true, project_id: true }).partial().extend({ base_version: z.number().int() });

/** Edit: the requester while it is open, Einkauf / Leitung always (e.g. complete quantities). */
export async function editBanf(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = BanfEdit.parse(input);
  const b = await getBanf(tx, id);
  const a = await actorFor(tx, userId, b.project_id as string);
  const einkauf = a.role === 'bauleitung' || a.role === 'einkauf';
  if (!einkauf && !(b.created_by === userId && b.status === 'offen')) throw new HttpError(403, 'Nur solange die Anforderung neu ist, kann sie der Anforderer ändern');
  if (b.version !== d.base_version) throw new HttpError(409, 'Die Anforderung wurde inzwischen geändert');
  const { base_version: _v, ...rest } = d;
  const fields: Record<string, unknown> = { ...rest };
  if (rest.positionen) fields.positionen = tx.json(rest.positionen as never);
  if (!Object.keys(fields).length) return b;
  await tx`UPDATE bestellanforderung SET ${tx(fields as never)}, version = version + 1, updated_at = now() WHERE id = ${id}`;
  await audit(tx, userId, b.project_id as string, id, 'geaendert', meta, { felder: Object.keys(rest) });
  return getBanf(tx, id);
}

const StatusInput = z.object({
  status: z.enum(BANF_STATUS),
  base_version: z.number().int(),
  bemerkung: z.string().max(2000).nullish(),
  lieferant: z.string().trim().max(200).nullish(),
  bestell_nr: z.string().trim().max(100).nullish(),
  liefertermin: z.string().date().nullish(),
});

/** Status change; Einkauf / Leitung move it on, the requester withdraws. The requester is notified. */
export async function statusBanf(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = StatusInput.parse(input);
  const b = await getBanf(tx, id);
  const a = await actorFor(tx, userId, b.project_id as string);
  const rolle = a.role === 'bauleitung' || a.role === 'einkauf' ? 'einkauf' : b.created_by === userId ? 'anforderer' : null;
  if (!rolle) throw new HttpError(403, 'Den Status ändern Einkauf und Leitung');
  if (b.version !== d.base_version) throw new HttpError(409, 'Die Anforderung wurde inzwischen geändert');
  const from = b.status as BanfStatus;
  // The requester may also withdraw; Einkauf/Leitung who created it themselves use the Einkauf chain.
  const ok = banfTransition(from, d.status, rolle) || (d.status === 'zurueckgezogen' && b.created_by === userId && banfTransition(from, d.status, 'anforderer'));
  if (!ok) throw new HttpError(409, `Von „${BANF_LABEL[from]}“ nicht nach „${BANF_LABEL[d.status]}“`);
  if (d.status === 'abgelehnt' && !d.bemerkung?.trim()) throw new HttpError(422, 'Bitte einen Grund angeben');
  if (d.status === 'bestellt' && !(d.lieferant ?? b.lieferant)) throw new HttpError(422, 'Bitte den Lieferanten angeben');
  const set: Record<string, unknown> = { status: d.status };
  if (rolle === 'einkauf') set.bearbeiter_id = userId;
  if (d.bemerkung !== undefined) set.bemerkung_einkauf = d.bemerkung ?? null;
  if (d.lieferant !== undefined) set.lieferant = d.lieferant ?? null;
  if (d.bestell_nr !== undefined) set.bestell_nr = d.bestell_nr ?? null;
  if (d.liefertermin !== undefined) set.liefertermin = d.liefertermin ?? null;
  await tx`UPDATE bestellanforderung SET ${tx(set as never)}, version = version + 1, updated_at = now() WHERE id = ${id}`;
  await audit(tx, userId, b.project_id as string, id, `status:${d.status}`, meta, { von: from, nach: d.status, lieferant: d.lieferant ?? undefined, bemerkung: d.bemerkung ?? undefined });
  const txt = d.status === 'bestellt'
    ? `Bestellt bei ${(d.lieferant ?? b.lieferant) as string}${d.bestell_nr ? `, Bestell-Nr. ${d.bestell_nr}` : ''}${d.liefertermin ? `, Liefertermin ${d.liefertermin.split('-').reverse().join('.')}` : ''}.`
    : d.bemerkung ?? null;
  const empf = rolle === 'anforderer' ? [...(await einkaeufer(tx, b.project_id as string))] : [b.created_by as string];
  await benachrichtigen(tx, userId, b.project_id as string, empf,
    { art: 'bestellanforderung', titel: `Bestellanforderung Nr. ${b.number as number} „${b.titel as string}“: ${BANF_LABEL[d.status]}`, text: txt, entity: 'bestellanforderung', entityId: id, mailArt: 'status_mail' },
    d.status !== 'in_bearbeitung');
  return getBanf(tx, id);
}

/** Einkauf makes an LV draft from the request (positions with quantities) and links it; the LV request follows there. */
export async function banfZuLv(tx: TxSql, userId: string, id: string, meta: WriteMeta) {
  const b = await getBanf(tx, id);
  const a = await actorFor(tx, userId, b.project_id as string);
  if (a.role !== 'bauleitung' && a.role !== 'einkauf') throw new HttpError(403, 'LVs legen Einkauf und Leitung an');
  if (b.lv_id) return { lv_id: b.lv_id as string };
  const lvId = randomUUID();
  const [nr] = await tx`SELECT coalesce(max(nummer), 0) + 1 AS n FROM lv WHERE project_id = ${b.project_id}`;
  await tx`INSERT INTO lv (id, tenant_id, project_id, nummer, titel, beschreibung, gewerk_id, angebotsfrist, created_by)
           VALUES (${lvId}, app.user_tenant(), ${b.project_id}, ${nr!.n}, ${b.titel}, ${`Aus Bestellanforderung Nr. ${b.number as number}${b.beschreibung ? `: ${b.beschreibung as string}` : ''}`},
                   ${b.gewerk_id}, null, ${userId})`;
  const pos = (b.positionen as { text: string; menge?: number | null; einheit?: string | null }[]);
  const zeilen = (pos.length ? pos : [{ text: b.titel as string, menge: 1, einheit: 'psch' }]).map((p, i) => ({
    id: randomUUID(), lv_id: lvId, project_id: b.project_id, art: 'position', oz: String((i + 1) * 10).padStart(4, '0'), kurztext: p.text,
    langtext: null, menge: p.menge ?? 1, einheit: p.einheit || 'St', sort: i,
  }));
  await tx`INSERT INTO lv_position ${tx(zeilen as never)}`;
  await tx`UPDATE bestellanforderung SET lv_id = ${lvId}, status = CASE WHEN status = 'offen' THEN 'in_bearbeitung' ELSE status END, bearbeiter_id = ${userId},
           version = version + 1, updated_at = now() WHERE id = ${id}`;
  await audit(tx, userId, b.project_id as string, id, 'lv_angelegt', meta, { lv_id: lvId });
  return { lv_id: lvId };
}

/** When an LV made from requests is sent to bidders, its requests move to "Angebote angefragt". */
export async function banfAngefragt(tx: TxSql, lvId: string) {
  await tx`UPDATE bestellanforderung SET status = 'angefragt', version = version + 1, updated_at = now() WHERE lv_id = ${lvId} AND status IN ('offen', 'in_bearbeitung')`;
}
