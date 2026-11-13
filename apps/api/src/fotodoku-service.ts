/**
 * Fotodokumentation on plans (docs/fachkonzept/16, decided 12.11.2026). The entry (pin, category, room) is created on
 * the device – also offline – and the file follows; 360° photos (Insta360 export, equirectangular) are recognised from
 * the file. Internal roles only (RLS). A photo can become a Mangel at the same spot.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { FotodokuInput, FotodokuPatch, ist360, PRIORITIES } from '@bap/domain';
import { addFoto, FOTO_DIR } from './foto-service';
import { actorFor, createMangel, HttpError, type WriteMeta } from './mangel-service';

async function requireIntern(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung' && a.role !== 'polier') throw new HttpError(403, 'Die Fotodokumentation ist intern (Bauleitung, Polier)');
  return a;
}
async function audit(tx: TxSql, userId: string, projectId: string, id: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'foto_doku', ${id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

/** Width and height from a JPEG (SOF marker) or PNG (IHDR) header, plus the XMP packet if present. */
export function bildInfo(b: Buffer): { type: 'jpg' | 'png'; width: number | null; height: number | null; xmp: string | null } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), xmp: null };
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2, width: number | null = null, height: number | null = null;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = b.readUInt16BE(i + 5);
      width = b.readUInt16BE(i + 7);
      break;
    }
    i += 2 + len;
  }
  const head = b.subarray(0, Math.min(b.length, 256 * 1024)).toString('latin1');
  const x = head.indexOf('<x:xmpmeta');
  return { type: 'jpg', width, height, xmp: x >= 0 ? head.slice(x, head.indexOf('</x:xmpmeta>', x) + 12) : null };
}

const LIST = (tx: TxSql) => tx`
  f.id, f.project_id, f.plan_id, f.pin_page, f.pin_x, f.pin_y, f.location_id, l.name AS ort, f.gewerk_id, f.kategorie, f.titel, f.notiz, f.ist_360,
  f.file_key IS NOT NULL AS hochgeladen, f.width, f.height, f.taken_at, f.mangel_id, m.number AS mangel_number, f.version, f.created_by, u.name AS von, f.created_at`;

export async function listFotodoku(tx: TxSql, userId: string, projectId: string, q: { plan?: string; kategorie?: string; ort?: string }) {
  await requireIntern(tx, userId, projectId);
  return tx`
    SELECT ${LIST(tx)} FROM foto_doku f LEFT JOIN location l ON l.id = f.location_id LEFT JOIN app_user u ON u.id = f.created_by LEFT JOIN mangel m ON m.id = f.mangel_id
    WHERE f.project_id = ${projectId} AND f.deleted_at IS NULL
      ${q.plan ? tx`AND f.plan_id = ${q.plan}` : tx``} ${q.kategorie ? tx`AND f.kategorie = ${q.kategorie}` : tx``} ${q.ort ? tx`AND f.location_id = ${q.ort}` : tx``}
    ORDER BY f.taken_at DESC LIMIT 2000`;
}

async function getOne(tx: TxSql, id: string) {
  const [f] = await tx`SELECT ${LIST(tx)} FROM foto_doku f LEFT JOIN location l ON l.id = f.location_id LEFT JOIN app_user u ON u.id = f.created_by LEFT JOIN mangel m ON m.id = f.mangel_id WHERE f.id = ${id} AND f.deleted_at IS NULL`;
  if (!f) throw new HttpError(404, 'Foto nicht gefunden');
  return f;
}

/** Create the entry (idempotent by id: the app uploads again after a lost connection). Room from the pin if not given. */
export async function createFotodoku(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = FotodokuInput.parse(input);
  await requireIntern(tx, userId, d.project_id);
  const [dup] = await tx`SELECT id FROM foto_doku WHERE id = ${d.id}`;
  if (dup) return getOne(tx, d.id);
  let location = d.location_id ?? null;
  if (!location && d.plan_id && d.pin_x != null && d.pin_y != null) {
    // Room from the pin (room areas on the plan), like for Mängel.
    const [r] = await tx`
      SELECT a.location_id FROM location_area a WHERE a.plan_id = ${d.plan_id} AND a.page = ${d.pin_page ?? 1}
        AND ${d.pin_x} BETWEEN a.x0 AND a.x1 AND ${d.pin_y} BETWEEN a.y0 AND a.y1 ORDER BY (a.x1 - a.x0) * (a.y1 - a.y0) LIMIT 1`;
    location = (r?.location_id as string) ?? null;
    if (!location) {
      const [p] = await tx`SELECT location_id FROM plan WHERE id = ${d.plan_id}`;
      location = (p?.location_id as string) ?? null;
    }
  }
  await tx`
    INSERT INTO foto_doku (id, tenant_id, project_id, plan_id, pin_page, pin_x, pin_y, location_id, gewerk_id, kategorie, titel, notiz, ist_360, taken_at, created_by)
    SELECT ${d.id}, tenant_id, ${d.project_id}, ${d.plan_id ?? null}, ${d.pin_page ?? (d.plan_id ? 1 : null)}, ${d.pin_x ?? null}, ${d.pin_y ?? null}, ${location},
           ${d.gewerk_id ?? null}, ${d.kategorie}, ${d.titel ?? null}, ${d.notiz ?? null}, ${d.ist_360 ?? false}, ${d.taken_at ?? meta.occurredAt.toISOString()}, ${userId}
    FROM project WHERE id = ${d.project_id}`;
  await audit(tx, userId, d.project_id, d.id, 'erfasst', meta, { kategorie: d.kategorie, plan: d.plan_id ?? null });
  return getOne(tx, d.id);
}

/** Attach the file (once); detects size and 360° (2:1 or XMP equirectangular). */
export async function fotodokuDatei(tx: TxSql, userId: string, id: string, bytes: Buffer) {
  const f = await getOne(tx, id);
  await requireIntern(tx, userId, f.project_id as string);
  if (f.hochgeladen) return f;
  const info = bildInfo(bytes);
  if (!info) throw new HttpError(422, 'Nur JPEG oder PNG');
  if (bytes.length > 60 * 1024 * 1024) throw new HttpError(413, 'Foto zu groß (max. 60 MB)');
  const key = `doku-${id}.${info.type}`;
  await mkdir(FOTO_DIR, { recursive: true });
  await writeFile(FOTO_DIR + key, bytes);
  // Small preview for lists and plan pins (a 360° export is 10–30 MB).
  try {
    await writeFile(`${FOTO_DIR}doku-${id}-t.jpg`, await sharp(bytes).rotate().resize(480, 480, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer());
  } catch { /* unreadable for sharp: the list falls back to the original */ }
  const pano = (f.ist_360 as boolean) || ist360(info.width, info.height, info.xmp);
  await tx`UPDATE foto_doku SET file_key = ${key}, width = ${info.width}, height = ${info.height}, ist_360 = ${pano} WHERE id = ${id}`;
  return getOne(tx, id);
}

export async function fotodokuFile(tx: TxSql, id: string, thumb = false) {
  const [f] = await tx`SELECT file_key FROM foto_doku WHERE id = ${id}`; // RLS
  if (!f?.file_key) throw new HttpError(404, 'Foto nicht gefunden');
  if (thumb) {
    try { return { bytes: await readFile(`${FOTO_DIR}doku-${id.replace(/[^a-f0-9-]/gi, '')}-t.jpg`), type: 'image/jpeg' }; } catch { /* no preview: original */ }
  }
  const key = (f.file_key as string).replace(/[^a-z0-9._-]/gi, '');
  return { bytes: await readFile(FOTO_DIR + key), type: key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

export async function editFotodoku(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = FotodokuPatch.parse(input);
  const f = await getOne(tx, id);
  await requireIntern(tx, userId, f.project_id as string);
  if (f.version !== d.base_version) throw new HttpError(409, 'Das Foto wurde inzwischen geändert');
  const { base_version: _v, ...rest } = d;
  if (!Object.keys(rest).length) return f;
  await tx`UPDATE foto_doku SET ${tx(rest as never)}, version = version + 1 WHERE id = ${id}`;
  await audit(tx, userId, f.project_id as string, id, 'geaendert', meta, { felder: Object.keys(rest) });
  return getOne(tx, id);
}

/** Trash (Papierkorb): never deleted for real; the Bauleitung can restore it later. */
export async function removeFotodoku(tx: TxSql, userId: string, id: string, meta: WriteMeta) {
  const f = await getOne(tx, id);
  const a = await requireIntern(tx, userId, f.project_id as string);
  if (a.role !== 'bauleitung' && f.created_by !== userId) throw new HttpError(403, 'Fremde Fotos entfernt die Bauleitung');
  await tx`UPDATE foto_doku SET deleted_at = now(), deleted_by = ${userId}, version = version + 1 WHERE id = ${id}`;
  await audit(tx, userId, f.project_id as string, id, 'papierkorb', meta, {});
  return { ok: true };
}

const MangelAusFoto = z.object({
  description: z.string().trim().min(1, 'Beschreibung ist Pflicht').max(4000),
  gewerk_id: z.string().uuid(),
  location_id: z.string().uuid().nullish(),
  due_date: z.string().date().nullish(),
  priority: z.enum(PRIORITIES).default('normal'),
  assigned_company_id: z.string().uuid().nullish(),
});

/** Make a Mangel from a photo: same plan pin and room, the photo is copied to the Mangel. */
export async function mangelAusFoto(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = MangelAusFoto.parse(input);
  const f = await getOne(tx, id);
  await requireIntern(tx, userId, f.project_id as string);
  if (f.mangel_id) throw new HttpError(409, 'Aus diesem Foto wurde schon ein Mangel erstellt');
  const location = d.location_id ?? (f.location_id as string | null);
  if (!location) throw new HttpError(422, 'Bitte einen Ort wählen');
  const mangelId = randomUUID();
  await createMangel(tx, userId, {
    id: mangelId, project_id: f.project_id, location_id: location, gewerk_id: d.gewerk_id, description: d.description, priority: d.priority,
    due_date: d.due_date ?? null, plan_id: f.plan_id, pin_page: f.pin_page, pin_x: f.pin_x, pin_y: f.pin_y, assigned_company_id: d.assigned_company_id ?? null,
  }, meta);
  if (f.hochgeladen) {
    const file = await fotodokuFile(tx, id);
    await addFoto(tx, userId, mangelId, { id: randomUUID(), kind: 'mangel', taken_at: new Date(f.taken_at as string).toISOString() }, file.bytes, meta);
  }
  await tx`UPDATE foto_doku SET mangel_id = ${mangelId}, version = version + 1 WHERE id = ${id}`;
  await audit(tx, userId, f.project_id as string, id, 'mangel_erstellt', meta, { mangel_id: mangelId });
  return { mangel_id: mangelId };
}
