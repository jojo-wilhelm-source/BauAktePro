/**
 * QR-Freimeldung (docs/fachkonzept/04, decided 12.11.2026).
 *
 * Every sent Mangelanzeige gets a link (also as QR code on the PDF and in the e-mail). Whoever has it – e.g. the
 * fitter on site, without an account – sees ONLY this Anzeige and can, per position, report "behoben" (photo
 * required) or raise a query. Name and company are typed in. The link has no expiry; the Leitung can lock,
 * unlock and regenerate it. The Bauleitung decides afterwards with the normal status chain (accept / reject).
 *
 * The public part runs on the admin connection, but every query is bound to the token and to this one Anzeige.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Sql, TxSql } from '@bap/db';
import { anzeigeNo, formatDate, MANGEL_STATUS_LABELS, type MangelStatus } from '@bap/domain';
import { WEB_URL } from './anmeldung';
import { FOTO_DIR } from './foto-service';
import { sendMail } from './mailer';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

export const freimeldeUrl = (token: string) => `${WEB_URL}/freimeldung/${token}`;
const newToken = () => randomBytes(32).toString('base64url');
const MAX_FOTO = 15 * 1024 * 1024;

/** Created when the Anzeige is sent (inside the same transaction). Returns the URL for PDF and e-mail. */
export async function createLink(tx: TxSql, userId: string, anzeigeId: string, projectId: string) {
  const [existing] = await tx`SELECT token FROM anzeige_link WHERE anzeige_id = ${anzeigeId}`;
  if (existing) return freimeldeUrl(existing.token as string);
  const token = newToken();
  await tx`INSERT INTO anzeige_link (anzeige_id, project_id, token, created_by) VALUES (${anzeigeId}, ${projectId}, ${token}, ${userId})`;
  return freimeldeUrl(token);
}

async function requireLeitung(tx: TxSql, userId: string, anzeigeId: string) {
  const [a] = await tx`SELECT id, project_id, status FROM mangelanzeige WHERE id = ${anzeigeId}`; // RLS
  if (!a) throw new HttpError(404, 'Mangelanzeige nicht gefunden');
  const actor = await actorFor(tx, userId, a.project_id as string);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Den Freimelde-Link verwalten Bau- und Projektleitung');
  return a as { id: string; project_id: string; status: string };
}

async function audit(tx: TxSql | Sql, projectId: string, entityId: string, action: string, actor: { userId?: string | null; label?: string }, data: object, deviceId = 'web') {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, actor_label, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'mangelanzeige', ${entityId}, ${action}, ${actor.userId ?? null}, ${actor.label ?? null}, ${deviceId}, now(), ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

/** Link state for the web (Leitung): URL, active, QR as PNG data URL for showing/printing. */
export async function linkInfo(tx: TxSql, userId: string, anzeigeId: string) {
  await requireLeitung(tx, userId, anzeigeId);
  const [l] = await tx`SELECT token, active, updated_at FROM anzeige_link WHERE anzeige_id = ${anzeigeId}`;
  if (!l) return { exists: false as const };
  const url = freimeldeUrl(l.token as string);
  return { exists: true as const, url, active: l.active as boolean, updated_at: l.updated_at, qr: await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }) };
}

export async function changeLink(tx: TxSql, userId: string, anzeigeId: string, input: unknown, meta: WriteMeta) {
  const { action } = z.object({ action: z.enum(['sperren', 'freigeben', 'neu']) }).parse(input);
  const a = await requireLeitung(tx, userId, anzeigeId);
  if (a.status !== 'versendet') throw new HttpError(409, 'Den Link gibt es erst nach dem Versand');
  const [l] = await tx`SELECT id FROM anzeige_link WHERE anzeige_id = ${anzeigeId}`;
  if (!l && action !== 'neu') throw new HttpError(404, 'Noch kein Link vorhanden');
  if (!l) await tx`INSERT INTO anzeige_link (anzeige_id, project_id, token, created_by) VALUES (${anzeigeId}, ${a.project_id}, ${newToken()}, ${userId})`;
  else if (action === 'neu') await tx`UPDATE anzeige_link SET token = ${newToken()}, active = true, updated_at = now() WHERE anzeige_id = ${anzeigeId}`;
  else await tx`UPDATE anzeige_link SET active = ${action === 'freigeben'}, updated_at = now() WHERE anzeige_id = ${anzeigeId}`;
  await audit(tx, a.project_id, anzeigeId, `link_${action}`, { userId }, {}, meta.deviceId ?? 'web');
  return linkInfo(tx, userId, anzeigeId);
}

/** Reports of one Anzeige (web: Bauleitung checks them; NU sees its own via RLS). */
export async function listFreimeldungen(tx: TxSql, userId: string, anzeigeId: string) {
  const [a] = await tx`SELECT project_id FROM mangelanzeige WHERE id = ${anzeigeId}`;
  if (!a) throw new HttpError(404, 'Mangelanzeige nicht gefunden');
  await actorFor(tx, userId, a.project_id as string);
  return tx`
    SELECT f.id, f.kind, f.melder_name, f.melder_firma, f.kommentar, f.foto_id, f.created_at, f.mangel_id,
           p.pos, m.number, m.status, m.version
    FROM freimeldung f JOIN mangelanzeige_position p ON p.id = f.position_id JOIN mangel m ON m.id = f.mangel_id
    WHERE f.anzeige_id = ${anzeigeId} ORDER BY f.created_at DESC`;
}

// --- public (link holder) ----------------------------------------------------------------------------

async function byToken(db: Sql | TxSql, token: string) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) throw new HttpError(404, 'Dieser Link ist ungültig');
  const [l] = await db`
    SELECT l.anzeige_id, l.active, a.project_id, a.number, a.deadline, a.sent_by, a.tenant_id, p.name AS project, c.name AS company,
           (SELECT oc.name FROM company oc WHERE oc.tenant_id = a.tenant_id AND oc.kind = 'own' LIMIT 1) AS own_company
    FROM anzeige_link l JOIN mangelanzeige a ON a.id = l.anzeige_id JOIN project p ON p.id = a.project_id JOIN company c ON c.id = a.company_id
    WHERE l.token = ${token} AND a.status = 'versendet'`;
  if (!l) throw new HttpError(404, 'Dieser Link ist ungültig oder wurde ersetzt. Bitte bei der Bauleitung nachfragen.');
  if (!l.active) throw new HttpError(423, 'Dieser Link ist gesperrt. Bitte bei der Bauleitung nachfragen.');
  return l as Record<string, unknown> & { anzeige_id: string; project_id: string; number: number; sent_by: string; tenant_id: string };
}

/** What the link shows: only this Anzeige, its positions with status, photo ids and earlier reports. No prices. */
export async function publicAnzeige(admin: Sql, token: string) {
  const l = await byToken(admin, token);
  const positions = await admin`
    SELECT p.id, p.pos, m.id AS mangel_id, m.number, m.description, m.status, l.name AS location, g.name AS gewerk,
      coalesce((SELECT json_agg(f.id ORDER BY f.taken_at) FROM mangel_foto f WHERE f.mangel_id = m.id AND f.kind = 'mangel'), '[]') AS fotos,
      coalesce((SELECT json_agg(json_build_object('kind', fm.kind, 'name', fm.melder_name, 'firma', fm.melder_firma, 'kommentar', fm.kommentar,
                 'foto_id', fm.foto_id, 'created_at', fm.created_at) ORDER BY fm.created_at DESC)
                FROM freimeldung fm WHERE fm.position_id = p.id), '[]') AS meldungen
    FROM mangelanzeige_position p JOIN mangel m ON m.id = p.mangel_id JOIN location l ON l.id = m.location_id JOIN gewerk g ON g.id = m.gewerk_id
    WHERE p.anzeige_id = ${l.anzeige_id} ORDER BY p.pos`;
  return {
    anzeige: anzeigeNo(l.number), project: l.project, company: l.company, ownCompany: l.own_company, deadline: l.deadline,
    positions: positions.map((p) => ({ ...p, statusLabel: MANGEL_STATUS_LABELS[p.status as MangelStatus] })),
  };
}

/** Photo of a position in this Anzeige only. */
export async function publicFoto(admin: Sql, token: string, fotoId: string) {
  const l = await byToken(admin, token);
  const [f] = await admin`
    SELECT f.file_key FROM mangel_foto f JOIN mangelanzeige_position p ON p.mangel_id = f.mangel_id
    WHERE f.id = ${fotoId} AND p.anzeige_id = ${l.anzeige_id}`;
  if (!f) throw new HttpError(404, 'Foto nicht gefunden');
  const key = (f.file_key as string).replace(/[^a-z0-9._-]/gi, '');
  return { bytes: await readFile(FOTO_DIR + key), type: key.endsWith('.png') ? 'image/png' : key.endsWith('.heic') ? 'image/heic' : 'image/jpeg' };
}

const MeldungInput = z.object({
  art: z.enum(['behoben', 'rueckfrage']),
  name: z.string().trim().min(2, 'Bitte Ihren Namen eintragen').max(120),
  firma: z.string().trim().min(2, 'Bitte die Firma eintragen').max(160),
  kommentar: z.string().trim().max(2000).optional(),
});
const OPEN: MangelStatus[] = ['zugewiesen', 'in_bearbeitung', 'nicht_behoben'];

/**
 * Report for one position. "behoben" needs a photo and moves the Mangel to "Behoben gemeldet"; "rueckfrage"
 * needs a comment and moves it to "Strittig". Decisions stay with the Bauleitung.
 */
export async function submitFreimeldung(
  admin: Sql, token: string, positionId: string, fields: unknown,
  file: { bytes: Buffer; name: string } | null, ip: string, userId: string | null,
) {
  const d = MeldungInput.parse(fields);
  if (d.art === 'behoben' && !file) throw new HttpError(422, 'Bitte ein Foto als Nachweis aufnehmen');
  if (d.art === 'rueckfrage' && !d.kommentar) throw new HttpError(422, 'Bitte die Rückfrage kurz beschreiben');
  if (file && file.bytes.length > MAX_FOTO) throw new HttpError(413, 'Das Foto ist zu groß (höchstens 15 MB)');
  const ext = file ? ((file.name.split('.').pop() ?? 'jpg').toLowerCase().replace('jpeg', 'jpg')) : null;
  if (ext && !['jpg', 'png', 'heic'].includes(ext)) throw new HttpError(422, 'Bitte ein Foto (JPG, PNG oder HEIC) hochladen');
  const label = `${d.name} (${d.firma}) per QR-Link`;

  const result = await admin.begin(async (tx) => {
    const l = await byToken(tx, token);
    const [p] = await tx`
      SELECT p.id, p.pos, m.id AS mangel_id, m.number, m.status, m.project_id FROM mangelanzeige_position p JOIN mangel m ON m.id = p.mangel_id
      WHERE p.id = ${positionId} AND p.anzeige_id = ${l.anzeige_id} FOR UPDATE OF m`;
    if (!p) throw new HttpError(404, 'Diese Position gehört nicht zu dieser Mangelanzeige');
    const status = p.status as MangelStatus;
    if (status === 'abgenommen') throw new HttpError(409, 'Dieser Mangel ist bereits abgenommen');

    let fotoId: string | null = null;
    if (file) {
      fotoId = randomUUID();
      const key = `${fotoId}.${ext}`;
      await mkdir(FOTO_DIR, { recursive: true });
      await writeFile(FOTO_DIR + key, file.bytes);
      await tx`
        INSERT INTO mangel_foto (id, mangel_id, project_id, kind, file_key, taken_at, created_by, created_by_label)
        VALUES (${fotoId}, ${p.mangel_id}, ${p.project_id}, 'nachweis', ${key}, now(), ${userId}, ${userId ? null : label})`;
    }
    const [f] = await tx`
      INSERT INTO freimeldung (project_id, anzeige_id, position_id, mangel_id, kind, melder_name, melder_firma, kommentar, foto_id, user_id, ip)
      VALUES (${p.project_id}, ${l.anzeige_id}, ${positionId}, ${p.mangel_id}, ${d.art}, ${d.name}, ${d.firma}, ${d.kommentar ?? null}, ${fotoId}, ${userId}, ${ip})
      RETURNING id, created_at`;

    const to: MangelStatus | null = OPEN.includes(status) ? (d.art === 'behoben' ? 'behoben_gemeldet' : 'strittig') : null;
    if (to) {
      await tx`UPDATE mangel SET status = ${to}, version = version + 1, updated_at = now() WHERE id = ${p.mangel_id}`;
      await tx`
        INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, actor_label, device_id, occurred_at, data)
        VALUES (${l.tenant_id}, ${p.project_id}, 'mangel', ${p.mangel_id}, 'status', ${userId}, ${label}, 'qr-link', now(),
                ${tx.json({ from: status, to, freimeldung: f!.id, anzeige: anzeigeNo(l.number), pos: p.pos } as never)})`;
    }
    await audit(tx, p.project_id as string, l.anzeige_id, `freimeldung_${d.art}`, { userId, label }, { pos: p.pos, mangel: p.number, foto: fotoId }, 'qr-link');
    const [lead] = await tx`SELECT email, name FROM app_user WHERE id = ${l.sent_by}`;
    return { id: f!.id as string, to, status, pos: p.pos as number, number: p.number as number, l, lead };
  });

  // Tell the Bauleitung (after commit; a mail problem never loses the report).
  if (result.lead?.email) {
    const what = d.art === 'behoben' ? 'als behoben gemeldet' : 'mit einer Rückfrage versehen';
    await sendMail({
      from: process.env.MAIL_FROM ?? 'Bau Akte Pro <noreply@bauaktepro.example.test>',
      to: result.lead.email as string,
      subject: `${result.l.project as string}: Pos. ${result.pos} der ${anzeigeNo(result.l.number)} ${what}`,
      text:
        `${d.name} (${d.firma}) hat am ${formatDate(new Date().toISOString())} Position ${result.pos} (M-${String(result.number).padStart(3, '0')}) ` +
        `der ${anzeigeNo(result.l.number)} ${what}.${d.kommentar ? `\n\nKommentar: ${d.kommentar}` : ''}\n\n` +
        `Bitte prüfen und abnehmen oder ablehnen: ${WEB_URL}\n`,
      attachments: [],
    }).catch(() => undefined);
  }
  return { ok: true, id: result.id, status: result.to ?? result.status, statusLabel: MANGEL_STATUS_LABELS[(result.to ?? result.status) as MangelStatus] };
}
