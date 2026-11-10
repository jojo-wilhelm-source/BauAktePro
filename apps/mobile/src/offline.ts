/**
 * Files on the device (docs/fachkonzept/05-offline-sync.md): the data itself comes via PowerSync, the files
 * (plans, Mangel photos, released documents) are downloaded here. Every file the user may see in ALL of his
 * projects is kept on the device, so everything works on site without network.
 * - Missing files are downloaded after each sync (automatic mode) or on "Jetzt abgleichen".
 * - Files that are no longer visible (new plan index, rights removed, document replaced) are deleted
 *   after a complete sync – never before, so a fresh start without data does not wipe the device.
 * - Photos taken on this device live in "fotos" (upload queue) and are never touched by the cleanup.
 */
import { useSyncExternalStore } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { API_URL } from './config';

export type FileKind = 'plaene' | 'fotos' | 'dokumente';
export const DIRS: Record<FileKind, Directory> = {
  plaene: new Directory(Paths.document, 'plans'),
  fotos: new Directory(Paths.document, 'foto-cache'),
  dokumente: new Directory(Paths.document, 'dokumente'),
};

/** Photos taken on this device (see fotoStore). */
const OWN_FOTOS = new Directory(Paths.document, 'fotos');

export const planFile = (p: { id: string; plan_index: string }) => new File(DIRS.plaene, `${p.id}-${p.plan_index.replace(/[^a-z0-9]/gi, '')}.pdf`);
export const fotoCacheFile = (id: string) => new File(DIRS.fotos, `${id}.jpg`);
export const docFile = (r: { id: string; file_name: string }) => {
  const ext = (r.file_name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? '').toLowerCase();
  return new File(DIRS.dokumente, `${r.id}${ext}`);
};

export interface FileJob { kind: FileKind; file: File; url: string; label: string }

/** Everything the device should hold, from the local (synced) database. */
export async function collectJobs(db: AbstractPowerSyncDatabase): Promise<FileJob[]> {
  const plans = await db.getAll<{ id: string; name: string; plan_index: string }>('SELECT id, name, plan_index FROM plan');
  const fotos = await db.getAll<{ id: string }>('SELECT id FROM mangel_foto');
  const docs = await db.getAll<{ id: string; file_name: string; name: string }>(
    'SELECT r.id, r.file_name, d.name FROM document d JOIN document_revision r ON r.id = d.current_revision_id',
  );
  return [
    ...plans.map((p) => ({ kind: 'plaene' as const, file: planFile(p), url: `${API_URL}/plans/${p.id}/file`, label: `${p.name} · Index ${p.plan_index}` })),
    ...docs.map((d) => ({ kind: 'dokumente' as const, file: docFile(d), url: `${API_URL}/document-revisions/${d.id}/file`, label: d.name })),
    // Photos taken on this device are already here (upload folder): no second copy.
    ...fotos.filter((f) => !new File(OWN_FOTOS, `${f.id}.jpg`).exists).map((f) => ({ kind: 'fotos' as const, file: fotoCacheFile(f.id), url: `${API_URL}/fotos/${f.id}/file`, label: 'Foto' })),
  ];
}

// --- progress store (shared by the sync centre, the plan view and the header pill) ------------------
export interface OfflineState {
  running: boolean;
  done: number;
  total: number;
  failed: number;
  current: string | null;
  lastRun: string | null;
  /** Bumped after every run, so views re-check which files exist. */
  version: number;
}
let state: OfflineState = { running: false, done: 0, total: 0, failed: 0, current: null, lastRun: null, version: 0 };
const listeners = new Set<() => void>();
function set(p: Partial<OfflineState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export const useOfflineState = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

/** Downloads every missing file. Plans first (most important on site), then documents, then photos. */
export async function downloadMissing(jobs: FileJob[], token: string) {
  if (state.running) return;
  const order: FileKind[] = ['plaene', 'dokumente', 'fotos'];
  const missing = jobs.filter((j) => !j.file.exists).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  if (!missing.length) {
    set({ lastRun: new Date().toISOString(), version: state.version + 1 });
    return;
  }
  for (const d of Object.values(DIRS)) d.create({ idempotent: true, intermediates: true });
  set({ running: true, done: 0, total: missing.length, failed: 0, current: null });
  let failed = 0;
  for (const [i, j] of missing.entries()) {
    set({ current: j.label });
    try {
      await File.downloadFileAsync(j.url, j.file, { headers: { authorization: `Bearer ${token}` }, idempotent: true });
    } catch {
      failed++; // next attempt with the next sync
    }
    set({ done: i + 1, failed, version: state.version + 1 });
  }
  set({ running: false, current: null, lastRun: new Date().toISOString(), version: state.version + 1 });
}

/** Deletes files that are no longer part of what the device may hold. Call only after a complete sync. */
export function cleanup(jobs: FileJob[]) {
  const keep = new Set(jobs.map((j) => j.file.uri));
  let removed = 0;
  for (const d of Object.values(DIRS)) {
    if (!d.exists) continue;
    for (const e of d.list()) {
      if (e instanceof File && !keep.has(e.uri)) {
        e.delete();
        removed++;
      }
    }
  }
  if (removed) set({ version: state.version + 1 });
  return removed;
}

/** Files and bytes on the device per kind (for the sync centre). */
export function usage(jobs: FileJob[]) {
  const out: Record<FileKind, { have: number; total: number; bytes: number }> = {
    plaene: { have: 0, total: 0, bytes: 0 },
    dokumente: { have: 0, total: 0, bytes: 0 },
    fotos: { have: 0, total: 0, bytes: 0 },
  };
  for (const j of jobs) {
    const u = out[j.kind];
    u.total++;
    if (j.file.exists) {
      u.have++;
      u.bytes += j.file.size ?? 0;
    }
  }
  return out;
}

export function clearOfflineFiles() {
  for (const d of Object.values(DIRS)) if (d.exists) d.delete();
  set({ version: state.version + 1, lastRun: null });
}

// --- sync mode -----------------------------------------------------------------------------------------
/** auto: connected whenever there is network; manuell: only while "Jetzt abgleichen" runs. */
export type SyncMode = 'auto' | 'manuell';
const MODE_KEY = 'bap.syncMode';
export async function loadSyncMode(): Promise<SyncMode> {
  return (await SecureStore.getItemAsync(MODE_KEY)) === 'manuell' ? 'manuell' : 'auto';
}
export async function saveSyncMode(m: SyncMode) {
  await SecureStore.setItemAsync(MODE_KEY, m);
}
