/**
 * Mangel photos on the device (docs/fachkonzept/04, 05): taken offline, stored in the app's documents
 * folder, uploaded automatically once online AND the Mangel itself is on the server (has a number).
 * The local file is kept as cache, so the photo stays visible on site.
 */
import { useEffect, useRef } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { usePowerSync, useQuery } from '@powersync/react';
import { API_URL } from './config';
import { freshSession, type Session } from './session';

const dir = new Directory(Paths.document, 'fotos');
export const localFoto = (id: string) => new File(dir, `${id}.jpg`);

export type Picked = { uri: string; takenAt: string };

/** Camera on a real device; the simulator has no camera, so it falls back to the photo library. */
export async function pickFoto(source: 'camera' | 'library'): Promise<Picked | null> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, exif: false };
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
  return { uri: res.assets[0].uri, takenAt: new Date().toISOString() };
}

/** Copy the picked image into app storage and queue it for upload. Works offline. */
export async function queueFoto(db: AbstractPowerSyncDatabase, mangelId: string, picked: Picked, kind: 'mangel' | 'nachweis') {
  const id = Crypto.randomUUID();
  dir.create({ idempotent: true, intermediates: true });
  new File(picked.uri).copy(localFoto(id));
  await db.execute('INSERT INTO foto_upload (id, mangel_id, uri, kind, taken_at) VALUES (?, ?, ?, ?, ?)', [id, mangelId, localFoto(id).uri, kind, picked.takenAt]);
  return id;
}

/** Background uploader: runs whenever online and there are queued photos of Mängel that are already on the server. */
export function useFotoUploader(session: Session, online: boolean) {
  const db = usePowerSync();
  const { data: queue } = useQuery<{ id: string; mangel_id: string; uri: string; kind: string; taken_at: string }>(
    'SELECT f.id, f.mangel_id, f.uri, f.kind, f.taken_at FROM foto_upload f JOIN mangel m ON m.id = f.mangel_id WHERE m.number IS NOT NULL',
  );
  const busy = useRef(false);
  useEffect(() => {
    if (!online || !queue.length || busy.current) return;
    busy.current = true;
    void (async () => {
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
          const okStatus = res.status >= 200 && res.status < 300;
          if (okStatus) await db.execute('DELETE FROM foto_upload WHERE id = ?', [q.id]);
          else if (res.status < 500) await db.execute('UPDATE foto_upload SET error = ? WHERE id = ?', [`${res.status}`, q.id]);
        } catch {
          break; // network gone: try again on the next change
        }
      }
      busy.current = false;
    })();
  }, [online, queue, session, db]);
}

/** Image source: the local copy if this device took it, else the server (needs network). */
export function fotoSource(id: string, token: string) {
  const f = localFoto(id);
  return f.exists ? { uri: f.uri } : { uri: `${API_URL}/fotos/${id}/file`, headers: { authorization: `Bearer ${token}` } };
}

export function clearFotos() {
  if (dir.exists) dir.delete();
}

/** Receipt photo (Einkauf / Tanken): copied into app storage, uploaded once the entry itself is on the server. */
export async function queueBeleg(db: AbstractPowerSyncDatabase, kind: 'einkauf' | 'tankvorgang', entityId: string, picked: Picked) {
  const id = Crypto.randomUUID();
  dir.create({ idempotent: true, intermediates: true });
  new File(picked.uri).copy(localFoto(id));
  await db.execute('INSERT INTO beleg_upload (id, kind, entity_id, uri) VALUES (?, ?, ?, ?)', [id, kind, entityId, localFoto(id).uri]);
}

export function useBelegUploader(session: Session, online: boolean) {
  const db = usePowerSync();
  // Only entries whose own upload is through (nothing left for them in the local write queue).
  const { data: queue } = useQuery<{ id: string; kind: string; entity_id: string; uri: string }>(
    `SELECT b.id, b.kind, b.entity_id, b.uri FROM beleg_upload b WHERE NOT EXISTS (SELECT 1 FROM ps_crud c WHERE c.data LIKE '%' || b.entity_id || '%')`,
  );
  const busy = useRef(false);
  useEffect(() => {
    if (!online || !queue.length || busy.current) return;
    busy.current = true;
    void (async () => {
      const s = await freshSession(session);
      for (const q of queue) {
        try {
          const path = q.kind === 'einkauf' ? 'einkaeufe' : 'tankvorgaenge';
          const res = await uploadAsync(`${API_URL}/${path}/${q.entity_id}/beleg`, q.uri, {
            httpMethod: 'POST', uploadType: FileSystemUploadType.MULTIPART, fieldName: 'file', mimeType: 'image/jpeg',
            headers: { authorization: `Bearer ${s.token}` },
          });
          if (res.status >= 200 && res.status < 300) await db.execute('DELETE FROM beleg_upload WHERE id = ?', [q.id]);
        } catch {
          break;
        }
      }
      busy.current = false;
    })();
  }, [online, queue, session, db]);
}
