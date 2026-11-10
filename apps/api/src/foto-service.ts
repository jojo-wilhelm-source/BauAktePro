/**
 * Photos of a Mangel (docs/fachkonzept/04). Uploaded from the device (also later, after offline capture)
 * or the browser. Idempotent on the device-generated id. Visibility via RLS (follows the Mangel).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

export const FOTO_DIR = fileURLToPath(new URL('../../../storage/fotos/', import.meta.url));

const Fields = z.object({
  id: z.string().uuid(),
  kind: z.enum(['mangel', 'nachweis']).optional(),
  taken_at: z.string().datetime({ offset: true }).optional(),
});

function imageType(b: Buffer): 'jpg' | 'png' | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  return null;
}

export async function addFoto(tx: TxSql, userId: string, mangelId: string, fields: unknown, bytes: Buffer, meta: WriteMeta) {
  const f = Fields.parse(fields);
  const [m] = await tx`SELECT id, project_id FROM mangel WHERE id = ${mangelId}`; // RLS: must be visible
  if (!m) throw new HttpError(404, 'Mangel nicht gefunden');
  const actor = await actorFor(tx, userId, m.project_id as string);
  const [existing] = await tx`SELECT * FROM mangel_foto WHERE id = ${f.id}`;
  if (existing) return existing; // retried upload from the device
  const type = imageType(bytes);
  if (!type) throw new HttpError(422, 'Nur JPEG oder PNG');
  if (bytes.length > 25 * 1024 * 1024) throw new HttpError(413, 'Foto zu groß (max. 25 MB)');
  const fileKey = `${f.id}.${type}`;
  await mkdir(FOTO_DIR, { recursive: true });
  await writeFile(FOTO_DIR + fileKey, bytes);
  const [row] = await tx`
    INSERT INTO mangel_foto (id, mangel_id, project_id, kind, file_key, taken_at, created_by)
    VALUES (${f.id}, ${mangelId}, ${m.project_id as string}, ${f.kind ?? (actor.role === 'nu' ? 'nachweis' : 'mangel')}, ${fileKey},
            ${f.taken_at ?? meta.occurredAt.toISOString()}, ${userId})
    RETURNING *`;
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${m.project_id as string}, 'mangel', ${mangelId}, 'foto', ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json({ foto: f.id, kind: row!.kind } as never)}
    FROM project WHERE id = ${m.project_id as string}`;
  return row!;
}

/** Photo file, only if the photo (and therefore the Mangel) is visible to the user. */
export async function fotoFile(tx: TxSql, id: string) {
  const [f] = await tx`SELECT file_key FROM mangel_foto WHERE id = ${id}`;
  if (!f) throw new HttpError(404, 'Foto nicht gefunden');
  const key = (f.file_key as string).replace(/[^a-z0-9._-]/gi, '');
  return { bytes: await readFile(FOTO_DIR + key), type: key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

/** First "mangel" photo per Mangel, for PDFs. */
export async function firstPhotos(tx: TxSql, mangelIds: string[]) {
  if (!mangelIds.length) return new Map<string, { bytes: Uint8Array; takenAt: string }>();
  const rows = await tx`
    SELECT DISTINCT ON (mangel_id) mangel_id, file_key, taken_at FROM mangel_foto
    WHERE mangel_id IN ${tx(mangelIds)} ORDER BY mangel_id, (kind = 'mangel') DESC, taken_at`;
  const out = new Map<string, { bytes: Uint8Array; takenAt: string }>();
  for (const r of rows) {
    try {
      out.set(r.mangel_id as string, { bytes: await readFile(FOTO_DIR + (r.file_key as string)), takenAt: (r.taken_at as Date).toISOString() });
    } catch {
      // file missing: PDF shows "Foto nicht lesbar"
    }
  }
  return out;
}
