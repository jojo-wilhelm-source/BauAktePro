/**
 * Mangel photos on the device (docs/fachkonzept/04, 05): taken offline, stored in the app's documents
 * folder, uploaded automatically once online AND the Mangel itself is on the server (has a number).
 * The local file is kept as cache, so the photo stays visible on site.
 */
import { useEffect } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { usePowerSync, useQuery } from '@powersync/react';
import { API_URL } from './config';
import { fotoCacheFile } from './offline';
import { freshSession, type Session } from './session';

const dir = new Directory(Paths.document, 'fotos');
export const localFoto = (id: string) => new File(dir, `${id}.jpg`);

export type Picked = { uri: string; takenAt: string; width?: number; height?: number };

/** Camera on a real device; the simulator has no camera, so it falls back to the photo library. */
export async function pickFoto(source: 'camera' | 'library', voll = false): Promise<Picked | null> {
  // voll: Fotodoku / 360° panoramas keep their full resolution (quality 0.9), Mängel photos are compressed.
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: voll ? 0.9 : 0.6, exif: false };
  let res: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    try {
      res = await ImagePicker.launchCameraAsync(opts);
    } catch {
      res = await ImagePicker.launchImageLibraryAsync(opts);
    }
  } else {
    res = await ImagePicker.launchImageLibraryAsync(opts);
  }
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, takenAt: new Date().toISOString(), width: a.width, height: a.height };
}

/** Copy the picked image into app storage and queue it for upload. Works offline. */
export async function queueFoto(db: AbstractPowerSyncDatabase, mangelId: string, picked: Picked, kind: 'mangel' | 'nachweis') {
  const id = Crypto.randomUUID();
  dir.create({ idempotent: true, intermediates: true });
  new File(picked.uri).copy(localFoto(id));
  await db.execute('INSERT INTO foto_upload (id, mangel_id, uri, kind, taken_at) VALUES (?, ?, ?, ?, ?)', [id, mangelId, localFoto(id).uri, kind, picked.takenAt]);
  return id;
}

/** Uploads queued photos of Mängel that are already on the server. Safe to call often (one run at a time). */
let fotoBusy = false;
export async function uploadQueuedFotos(db: AbstractPowerSyncDatabase, session: Session) {
  if (fotoBusy) return;
  fotoBusy = true;
  try {
    const queue = await db.getAll<{ id: string; mangel_id: string; uri: string; kind: string; taken_at: string }>(
      'SELECT f.id, f.mangel_id, f.uri, f.kind, f.taken_at FROM foto_upload f JOIN mangel m ON m.id = f.mangel_id WHERE m.number IS NOT NULL AND f.error IS NULL',
    );
    if (!queue.length) return;
    const s = await freshSession(session);
    for (const q of queue) {
      try {
        // Native multipart upload straight from the file (fetch + FormData file parts are not supported here).
        const res = await uploadAsync(`${API_URL}/maengel/${q.mangel_id}/fotos`, q.uri, {
          httpMethod: 'POST',
          uploadType: FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType: 'image/jpeg',
          parameters: { id: q.id, kind: q.kind, taken_at: q.taken_at },
          headers: { authorization: `Bearer ${s.token}`, 'x-device-id': `ios-${s.userId.slice(-4)}` },
        });
        if (res.status >= 200 && res.status < 300) await db.execute('DELETE FROM foto_upload WHERE id = ?', [q.id]);
        else if (res.status < 500) await db.execute('UPDATE foto_upload SET error = ? WHERE id = ?', [`${res.status}`, q.id]);
      } catch {
        break; // network gone: try again later
      }
    }
  } finally {
    fotoBusy = false;
  }
}

/** Background uploader: runs whenever online and the queue changes. */
export function useFotoUploader(session: Session, online: boolean) {
  const db = usePowerSync();
  const { data: queue } = useQuery<{ n: number }>('SELECT count(*) AS n FROM foto_upload f JOIN mangel m ON m.id = f.mangel_id WHERE m.number IS NOT NULL AND f.error IS NULL');
  const n = queue[0]?.n ?? 0;
  useEffect(() => {
    if (online && n) void uploadQueuedFotos(db, session);
  }, [online, n, session, db]);
}

/** Image source: the local copy if this device took it, else the server (needs network). */
export function fotoSource(id: string, token: string) {
  const f = localFoto(id);
  if (f.exists) return { uri: f.uri };
  const cached = fotoCacheFile(id);
  return cached.exists ? { uri: cached.uri } : { uri: `${API_URL}/fotos/${id}/file`, headers: { authorization: `Bearer ${token}` } };
}

export function clearFotos() {
  if (dir.exists) dir.delete();
}

/** Receipt photo (Einkauf / Tanken): copied into app storage, uploaded once the entry itself is on the server. */
/** Receipt photos (einkauf/tankvorgang) and photos on Besprechungspunkte ('punkt'): uploaded once the entry is on the server. */
export async function queueBeleg(db: AbstractPowerSyncDatabase, kind: 'einkauf' | 'tankvorgang' | 'punkt', entityId: string, picked: Picked) {
  const id = Crypto.randomUUID();
  dir.create({ idempotent: true, intermediates: true });
  new File(picked.uri).copy(localFoto(id));
  await db.execute('INSERT INTO beleg_upload (id, kind, entity_id, uri) VALUES (?, ?, ?, ?)', [id, kind, entityId, localFoto(id).uri]);
}

/** Fotodoku photo: kept on the device under the entry's id (shown offline), uploaded once the entry is on the server. */
export async function queueDoku(db: AbstractPowerSyncDatabase, fotoId: string, picked: Picked) {
  dir.create({ idempotent: true, intermediates: true });
  new File(picked.uri).copy(localFoto(fotoId));
  await db.execute('INSERT INTO beleg_upload (id, kind, entity_id, uri) VALUES (?, ?, ?, ?)', [Crypto.randomUUID(), 'fotodoku', fotoId, localFoto(fotoId).uri]);
}

/** Uploads receipt photos of entries that are already on the server (nothing left for them in the local write queue). */
let belegBusy = false;
export async function uploadQueuedBelege(db: AbstractPowerSyncDatabase, session: Session) {
  if (belegBusy) return;
  belegBusy = true;
  try {
    const queue = await db.getAll<{ id: string; kind: string; entity_id: string; uri: string }>(
      `SELECT b.id, b.kind, b.entity_id, b.uri FROM beleg_upload b WHERE NOT EXISTS (SELECT 1 FROM ps_crud c WHERE c.data LIKE '%' || b.entity_id || '%')`,
    );
    if (!queue.length) return;
    const s = await freshSession(session);
    for (const q of queue) {
      try {
        const url = q.kind === 'punkt' ? `${API_URL}/besprechung-punkte/${q.entity_id}/fotos`
          : q.kind === 'fotodoku' ? `${API_URL}/fotodoku/${q.entity_id}/datei`
          : `${API_URL}/${q.kind === 'einkauf' ? 'einkaeufe' : 'tankvorgaenge'}/${q.entity_id}/beleg`;
        const res = await uploadAsync(url, q.uri, {
          httpMethod: 'POST', uploadType: FileSystemUploadType.MULTIPART, fieldName: 'file', mimeType: 'image/jpeg',
          headers: { authorization: `Bearer ${s.token}` }, parameters: { id: q.id },
        });
        if (res.status >= 200 && res.status < 300) await db.execute('DELETE FROM beleg_upload WHERE id = ?', [q.id]);
      } catch {
        break;
      }
    }
  } finally {
    belegBusy = false;
  }
}

export function useBelegUploader(session: Session, online: boolean) {
  const db = usePowerSync();
  const { data: queue } = useQuery<{ n: number }>(`SELECT count(*) AS n FROM beleg_upload b WHERE NOT EXISTS (SELECT 1 FROM ps_crud c WHERE c.data LIKE '%' || b.entity_id || '%')`);
  const n = queue[0]?.n ?? 0;
  useEffect(() => {
    if (online && n) void uploadQueuedBelege(db, session);
  }, [online, n, session, db]);
}
